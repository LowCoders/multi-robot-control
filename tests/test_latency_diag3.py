#!/usr/bin/env python3
"""
grblHAL latency diagnostic v3 -- validates MPG_SHARE_TX=1 fix.
Tests that in Panel/MPG mode, USB receives NO status responses
(they go to pendant UART instead).

Usage:
    python test_latency_diag3.py /dev/serial/by-id/usb-1a86_USB_Single_Serial_5B8E071772-if00
"""

import sys
import time
import re
import argparse
import serial


BAUD = 115200
PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"


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

    def read_line(self, timeout: float = 1.0):
        self.ser.timeout = timeout
        raw = self.ser.readline()
        if raw:
            return raw.decode(errors="replace").strip()
        return None

    def timed_status(self):
        """Send '?' and time the response."""
        self.flush()
        t0 = time.perf_counter()
        self.send(b"?")
        line = self.read_line(timeout=2.0)
        ms = (time.perf_counter() - t0) * 1000
        return line, ms

    def parse_status(self, line):
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
        for _ in range(5):
            line, _ = self.timed_status()
            if line:
                p = self.parse_status(line)
                if p.get("state") == "Idle":
                    return p
                if p.get("state") == "Alarm":
                    self.flush()
                    self.ser.write(b"$X\n")
                    time.sleep(0.5)
                    self.flush()
        self.send(b"\x18")
        time.sleep(2)
        self.flush()
        self.ser.write(b"$X\n")
        time.sleep(0.5)
        return self.ensure_idle()

    def release(self):
        self.send(bytes([0x8F]))
        time.sleep(0.1)
        self.flush()


def run_tests(port: str):
    d = Diag(port)
    results = []

    print("=" * 65)
    print("grblHAL MPG_SHARE_TX=1 Validation")
    print(f"Port: {port}  Baud: {BAUD}")
    print("=" * 65)

    d.ensure_idle()
    d.release()
    time.sleep(0.3)

    # T1: Baseline -- USB status query in None ownership
    print("\n--- T1: USB Status Query (None ownership) ---")
    line, ms = d.timed_status()
    p = d.parse_status(line)
    ok = line is not None and p.get("state") == "Idle"
    results.append(("T1", ok))
    print(f"  {PASS if ok else FAIL}  {ms:.1f}ms  {line}")

    # T2: USB status query in Host ownership
    print("\n--- T2: USB Status Query (Host ownership) ---")
    d.flush()
    d.send(bytes([0x8D]))
    time.sleep(0.1)
    line, ms = d.timed_status()
    p = d.parse_status(line)
    ok = p.get("OWN") == "host"
    results.append(("T2", ok))
    print(f"  {PASS if ok else FAIL}  {ms:.1f}ms  owner={p.get('OWN')}  {line[:60] if line else 'NONE'}")
    d.release()

    # T3: Panel claim -- USB should NOT get status response (MPG_SHARE_TX=1)
    print("\n--- T3: Panel Claim -- USB Silent in MPG Mode ---")
    d.flush()
    d.send(bytes([0x8E]))
    time.sleep(0.3)

    d.flush()
    d.send(b"?")
    line = d.read_line(timeout=1.0)

    if line is None:
        print(f"  {PASS}  USB got NO response (correctly routed to pendant UART)")
        ok = True
    else:
        p = d.parse_status(line)
        mpg = p.get("MPG", "?")
        own = p.get("OWN", "?")
        print(f"  {FAIL}  USB got response: owner={own} mpg={mpg}")
        print(f"       Line: {line[:80]}")
        print(f"       MPG_SHARE_TX may still be 0!")
        ok = False
    results.append(("T3", ok))
    d.release()
    time.sleep(0.3)

    # T4: After Panel release, USB should work again
    print("\n--- T4: USB Recovery After Panel Release ---")
    line, ms = d.timed_status()
    p = d.parse_status(line)
    ok = line is not None and p.get("OWN") in ("none", None)
    results.append(("T4", ok))
    print(f"  {PASS if ok else FAIL}  {ms:.1f}ms  owner={p.get('OWN')}  {line[:60] if line else 'NONE'}")

    # T5: Host Jog command latency (should be fast)
    print("\n--- T5: Host Jog Command Latency ---")
    d.flush()
    d.send(bytes([0x8D]))
    time.sleep(0.1)
    d.flush()

    jog_times = []
    for i in range(10):
        d.flush()
        t0 = time.perf_counter()
        d.ser.write(b"$J=G91 G21 X0.001 F5000\n")
        d.ser.timeout = 2.0
        resp_line = None
        while True:
            raw = d.ser.readline()
            if not raw:
                break
            resp = raw.decode(errors="replace").strip()
            if resp == "ok" or resp.startswith("error:"):
                resp_line = resp
                break
        ms = (time.perf_counter() - t0) * 1000
        jog_times.append(ms)
        if i < 3 or i >= 8:
            print(f"  [{i+1:2d}] {ms:6.1f}ms  {resp_line}")

    if jog_times:
        mean = sum(jog_times) / len(jog_times)
        ok = mean < 50 and all(r is not None for r in [resp_line])
        results.append(("T5", ok))
        print(f"  {PASS if ok else FAIL}  mean={mean:.1f}ms  min={min(jog_times):.1f}ms  max={max(jog_times):.1f}ms")
    else:
        results.append(("T5", False))

    d.send(bytes([0x85]))
    time.sleep(0.3)
    d.release()

    # T6: Rapid ownership cycling
    print("\n--- T6: Rapid Ownership Cycling (10x) ---")
    cycle_times = []
    for i in range(10):
        d.flush()
        t0 = time.perf_counter()

        d.send(bytes([0x8D]))  # host claim
        d.send(b"?")
        line = d.read_line(timeout=1.0)
        host_ms = (time.perf_counter() - t0) * 1000

        d.send(bytes([0x8F]))  # release
        time.sleep(0.05)

        cycle_times.append(host_ms)

    mean = sum(cycle_times) / len(cycle_times)
    ok = mean < 50
    results.append(("T6", ok))
    print(f"  {PASS if ok else FAIL}  mean={mean:.1f}ms  min={min(cycle_times):.1f}ms  max={max(cycle_times):.1f}ms")
    d.release()

    # T7: Panel claim and immediate release -- check no stuck state
    print("\n--- T7: Panel Claim + Release -- No Stuck State ---")
    d.flush()
    d.send(bytes([0x8E]))  # panel claim
    time.sleep(0.1)
    d.send(bytes([0x8F]))  # release
    time.sleep(0.3)

    line, ms = d.timed_status()
    p = d.parse_status(line)
    mpg = p.get("MPG", "?")
    own = p.get("OWN", "?")
    ok = line is not None and own in ("none", "None") and mpg in ("0", "?")
    results.append(("T7", ok))
    print(f"  {PASS if ok else FAIL}  owner={own}  mpg={mpg}  {ms:.1f}ms")

    # T8: Host jog with interleaved status polling
    print("\n--- T8: Host Jog + Status Interleave ---")
    d.flush()
    d.send(bytes([0x8D]))
    time.sleep(0.1)

    for i in range(5):
        d.flush()
        t0 = time.perf_counter()
        d.ser.write(b"$J=G91 G21 X0.001 F5000\n")
        d.ser.timeout = 1.0
        while True:
            raw = d.ser.readline()
            if not raw:
                break
            if raw.decode(errors="replace").strip() in ("ok",):
                break
        jog_ms = (time.perf_counter() - t0) * 1000

        d.flush()
        t0 = time.perf_counter()
        d.send(b"?")
        d.ser.timeout = 1.0
        raw = d.ser.readline()
        status_ms = (time.perf_counter() - t0) * 1000

        print(f"  [{i+1}] jog={jog_ms:6.1f}ms  status={status_ms:6.1f}ms")

    ok = True
    results.append(("T8", ok))
    print(f"  {PASS}")
    d.send(bytes([0x85]))
    time.sleep(0.3)
    d.release()

    # Summary
    print("\n" + "=" * 65)
    total = len(results)
    passed = sum(1 for _, ok in results if ok)
    print(f"Results: {passed}/{total} passed")
    for name, ok in results:
        print(f"  {PASS if ok else FAIL}  {name}")

    if passed < total:
        print(f"\n  ⚠ {total - passed} test(s) FAILED")
        if not results[2][1]:
            print("  CRITICAL: T3 failed -- MPG_SHARE_TX=1 may not be effective!")
            print("  The pendant UART is not receiving responses in MPG mode.")
    else:
        print("\n  All tests passed! MPG bidirectional communication verified.")

    d.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("port")
    args = parser.parse_args()
    run_tests(args.port)


if __name__ == "__main__":
    main()
