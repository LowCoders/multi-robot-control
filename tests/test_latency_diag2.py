#!/usr/bin/env python3
"""
Detailed grblHAL ownership + MPG latency diagnostic.
Measures step-by-step what happens during ownership transitions,
especially focusing on Panel claim (MPG mode activation).

Usage:
    python test_latency_diag2.py /dev/serial/by-id/usb-1a86_USB_Single_Serial_5B8E071772-if00
"""

import sys
import time
import re
import argparse
import serial


BAUD = 115200


class Diag:
    def __init__(self, port: str):
        self.ser = serial.Serial(port, BAUD, timeout=0.5)
        time.sleep(2.0)
        self.ser.reset_input_buffer()

    def close(self):
        self.ser.close()

    def flush(self):
        self.ser.reset_input_buffer()

    def send(self, data: bytes):
        self.ser.write(data)

    def read_all(self, timeout: float = 1.0):
        """Read all available lines within timeout."""
        self.ser.timeout = timeout
        lines = []
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            raw = self.ser.readline()
            if raw:
                lines.append(raw.decode(errors="replace").strip())
            elif lines:
                break
            else:
                self.ser.timeout = max(0.01, deadline - time.monotonic())
        return lines

    def timed_query(self):
        """Send '?' and measure time to status response. Returns (lines, ms)."""
        self.flush()
        t0 = time.perf_counter()
        self.send(b"?")
        lines = self.read_all(timeout=2.0)
        ms = (time.perf_counter() - t0) * 1000
        return lines, ms

    def parse_status(self, line):
        """Parse <State|...|OWN:...|OWNV:...|MPG:...> into dict."""
        d = {}
        if not line or not line.startswith("<"):
            return d
        m = re.match(r"<(\w+)\|", line)
        if m:
            d["state"] = m.group(1)
        for key in ["OWN", "OWNV", "MPG", "Bf"]:
            m = re.search(rf"{key}:([^|>]+)", line)
            if m:
                d[key] = m.group(1)
        return d

    def ensure_idle(self):
        """Ensure the controller is Idle."""
        lines, ms = self.timed_query()
        for line in lines:
            p = self.parse_status(line)
            if p.get("state") == "Alarm":
                self.flush()
                self.ser.write(b"$X\n")
                time.sleep(0.5)
                self.flush()
                return self.ensure_idle()
            if p.get("state") == "Idle":
                return p
        self.send(b"\x18")
        time.sleep(2)
        self.flush()
        self.ser.write(b"$X\n")
        time.sleep(0.5)
        self.flush()
        return self.ensure_idle()

    def release_ownership(self):
        """Release ownership and wait for confirmation."""
        self.send(bytes([0x8F]))
        time.sleep(0.1)


def test_1_status_latency(d: Diag):
    """Measure raw status query round-trip."""
    print("\n=== Test 1: Status Query Latency (20 samples) ===")
    times = []
    for i in range(20):
        lines, ms = d.timed_query()
        status = lines[0] if lines else "TIMEOUT"
        times.append(ms)
        if i < 5 or i >= 18:
            print(f"  [{i+1:2d}] {ms:6.1f}ms  {status[:70]}")
        elif i == 5:
            print(f"  ... (skipping samples 6-19)")
        time.sleep(0.02)

    times.sort()
    p50 = times[len(times)//2]
    p95 = times[int(len(times)*0.95)]
    p99 = times[min(int(len(times)*0.99), len(times)-1)]
    print(f"  >> p50={p50:.1f}ms  p95={p95:.1f}ms  p99={p99:.1f}ms  "
          f"min={times[0]:.1f}ms  max={times[-1]:.1f}ms")


def test_2_ownership_host_claim(d: Diag):
    """Measure Host claim from None."""
    print("\n=== Test 2: Ownership Host Claim (None -> Host) ===")
    d.release_ownership()
    d.flush()

    for i in range(5):
        d.release_ownership()
        time.sleep(0.1)
        d.flush()

        t0 = time.perf_counter()
        d.send(bytes([0x8D]))  # host claim
        d.send(b"?")
        lines = d.read_all(timeout=2.0)
        ms = (time.perf_counter() - t0) * 1000

        owner = "?"
        for line in lines:
            p = d.parse_status(line)
            if "OWN" in p:
                owner = p["OWN"]
        print(f"  [{i+1}] {ms:6.1f}ms  owner={owner}  lines={len(lines)}")

    d.release_ownership()


def test_3_ownership_panel_claim(d: Diag):
    """Measure Panel claim (None -> Panel) -- this activates MPG mode."""
    print("\n=== Test 3: Ownership Panel Claim (None -> Panel) + MPG activation ===")
    d.release_ownership()
    d.flush()

    for i in range(5):
        d.release_ownership()
        time.sleep(0.1)
        d.flush()

        t0 = time.perf_counter()
        d.send(bytes([0x8E]))  # panel request
        d.send(b"?")
        lines = d.read_all(timeout=2.0)
        ms = (time.perf_counter() - t0) * 1000

        owner = "?"
        mpg = "?"
        for line in lines:
            p = d.parse_status(line)
            if "OWN" in p:
                owner = p["OWN"]
            if "MPG" in p:
                mpg = p["MPG"]

        usb_got_response = any("<" in l for l in lines)
        print(f"  [{i+1}] {ms:6.1f}ms  owner={owner}  mpg={mpg}  "
              f"usb_response={usb_got_response}  lines={lines[:2]}")

    d.release_ownership()


def test_4_panel_jog_roundtrip(d: Diag):
    """Measure the full flow: claim panel -> send jog -> get ok."""
    print("\n=== Test 4: Full Panel Jog Flow (claim + jog + release) ===")
    d.release_ownership()
    d.flush()

    # Step-by-step
    for i in range(3):
        d.release_ownership()
        time.sleep(0.2)
        d.flush()

        # Step 1: Claim panel ownership
        t0 = time.perf_counter()
        d.send(bytes([0x8E]))
        t_claim = (time.perf_counter() - t0) * 1000

        # Wait briefly and check
        time.sleep(0.05)
        d.send(b"?")
        lines = d.read_all(timeout=1.0)
        t_check = (time.perf_counter() - t0) * 1000

        owner = "?"
        for line in lines:
            p = d.parse_status(line)
            if "OWN" in p:
                owner = p["OWN"]

        print(f"  [{i+1}] Claim sent: {t_claim:.1f}ms")
        print(f"       Status check: {t_check:.1f}ms  owner={owner}  usb_lines={lines[:1]}")

        if owner == "panel":
            # In MPG mode -- USB won't get 'ok' for $J=, pendant will
            print(f"       MPG mode active: USB cannot send/receive G-code")
        else:
            print(f"       NOT in MPG mode: owner={owner}")

        # Step 2: Try sending $J= over USB (may fail in MPG mode)
        d.flush()
        t0_jog = time.perf_counter()
        d.ser.write(b"$J=G91 G21 X0.001 F1000\n")
        jog_lines = d.read_all(timeout=1.0)
        t_jog = (time.perf_counter() - t0_jog) * 1000
        print(f"       Jog via USB: {t_jog:.1f}ms  response={jog_lines}")

        # Release
        d.send(bytes([0x85]))
        time.sleep(0.1)
        d.release_ownership()
        time.sleep(0.2)

    d.release_ownership()


def test_5_usb_cdc_latency(d: Diag):
    """Measure USB CDC character-level latency."""
    print("\n=== Test 5: USB CDC Latency (byte-level timing) ===")
    d.release_ownership()
    d.ensure_idle()
    d.flush()

    # Ensure host ownership
    d.send(bytes([0x8D]))
    time.sleep(0.1)

    for i in range(5):
        d.flush()
        t0 = time.perf_counter()
        d.send(b"?")
        # Read byte-by-byte
        d.ser.timeout = 2.0
        first_byte = None
        buf = b""
        while (time.perf_counter() - t0) < 2.0:
            b = d.ser.read(1)
            if b:
                if first_byte is None:
                    first_byte = (time.perf_counter() - t0) * 1000
                buf += b
                if b == b"\n":
                    break
        total = (time.perf_counter() - t0) * 1000
        print(f"  [{i+1}] first_byte={first_byte:.1f}ms  total={total:.1f}ms  "
              f"bytes={len(buf)}  content={buf.decode(errors='replace').strip()[:50]}")

    d.release_ownership()


def test_6_host_jog_roundtrip(d: Diag):
    """Measure host jog command round-trip (as bridge server would do)."""
    print("\n=== Test 6: Host Jog Round-trip (10 samples) ===")
    d.release_ownership()
    d.ensure_idle()

    d.send(bytes([0x8D]))
    time.sleep(0.1)
    d.flush()

    times = []
    for i in range(10):
        d.flush()
        t0 = time.perf_counter()
        d.ser.write(b"$J=G91 G21 X0.1 F5000\n")
        response = None
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            raw = d.ser.readline()
            if raw:
                line = raw.decode(errors="replace").strip()
                if line == "ok" or line.startswith("error:"):
                    response = line
                    break
        ms = (time.perf_counter() - t0) * 1000
        times.append(ms)
        print(f"  [{i+1:2d}] {ms:6.1f}ms  {response}")
        time.sleep(0.05)

    if times:
        times_sorted = sorted(times)
        print(f"  >> mean={sum(times)/len(times):.1f}ms  "
              f"min={times_sorted[0]:.1f}ms  max={times_sorted[-1]:.1f}ms")

    # Cancel and release
    d.send(bytes([0x85]))
    time.sleep(0.5)
    d.release_ownership()


def test_7_rapid_status_polling(d: Diag):
    """Simulate aggressive status polling and measure impact."""
    print("\n=== Test 7: Rapid Status Polling (50 queries, no delay) ===")
    d.release_ownership()
    d.ensure_idle()
    d.send(bytes([0x8D]))
    time.sleep(0.1)
    d.flush()

    times = []
    t_total_start = time.perf_counter()
    for i in range(50):
        d.flush()
        t0 = time.perf_counter()
        d.send(b"?")
        d.ser.timeout = 1.0
        raw = d.ser.readline()
        ms = (time.perf_counter() - t0) * 1000
        times.append(ms)

    t_total = (time.perf_counter() - t_total_start) * 1000
    times_sorted = sorted(times)
    print(f"  Total for 50 queries: {t_total:.0f}ms")
    print(f"  mean={sum(times)/len(times):.1f}ms  "
          f"min={times_sorted[0]:.1f}ms  max={times_sorted[-1]:.1f}ms  "
          f"p95={times_sorted[47]:.1f}ms")

    # Now interleave jog + status
    print("\n  Interleaved: jog + status (10 rounds):")
    jog_times = []
    status_times = []
    for i in range(10):
        d.flush()

        # Jog
        t0 = time.perf_counter()
        d.ser.write(b"$J=G91 G21 X0.001 F5000\n")
        d.ser.timeout = 1.0
        raw = d.ser.readline()
        jog_ms = (time.perf_counter() - t0) * 1000
        jog_times.append(jog_ms)

        # Status
        d.flush()
        t0 = time.perf_counter()
        d.send(b"?")
        d.ser.timeout = 1.0
        raw = d.ser.readline()
        status_ms = (time.perf_counter() - t0) * 1000
        status_times.append(status_ms)

        print(f"    [{i+1:2d}] jog={jog_ms:6.1f}ms  status={status_ms:6.1f}ms")

    print(f"  >> jog mean={sum(jog_times)/len(jog_times):.1f}ms  "
          f"status mean={sum(status_times)/len(status_times):.1f}ms")

    d.send(bytes([0x85]))
    time.sleep(0.3)
    d.release_ownership()


def test_8_baud_rate_check(d: Diag):
    """Verify baud rate and check for framing errors."""
    print("\n=== Test 8: Baud Rate & Framing Check ===")
    d.release_ownership()
    d.ensure_idle()
    d.send(bytes([0x8D]))
    time.sleep(0.1)

    # Send $$ and check for clean output
    d.flush()
    d.ser.write(b"$$\n")
    time.sleep(0.5)
    lines = d.read_all(timeout=2.0)

    clean = 0
    garbled = 0
    for line in lines:
        if line.startswith("$") or line == "ok":
            clean += 1
        elif line.strip():
            garbled += 1
            if garbled <= 3:
                print(f"  GARBLED: {repr(line)}")

    print(f"  Clean lines: {clean}  Garbled: {garbled}")
    if garbled == 0:
        print(f"  >> Baud rate OK, no framing errors")

    d.release_ownership()


def run_all(port: str):
    d = Diag(port)

    print("=" * 65)
    print("grblHAL Detailed Latency Diagnostic v2")
    print(f"Port: {port}  Baud: {BAUD}")
    print("=" * 65)

    status = d.ensure_idle()
    print(f"Initial state: {status}")

    test_1_status_latency(d)
    test_2_ownership_host_claim(d)
    test_3_ownership_panel_claim(d)
    test_4_panel_jog_roundtrip(d)
    test_5_usb_cdc_latency(d)
    test_6_host_jog_roundtrip(d)
    test_7_rapid_status_polling(d)
    test_8_baud_rate_check(d)

    d.close()
    print("\n" + "=" * 65)
    print("All diagnostics complete.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("port")
    args = parser.parse_args()
    run_all(args.port)


if __name__ == "__main__":
    main()
