#!/usr/bin/env python3
"""
grblHAL latency diagnostic -- measures exact round-trip times for each
operation type to identify what is slow and why.

Usage:
    python test_latency_diag.py /dev/serial/by-id/usb-1a86_USB_Single_Serial_5B8E071772-if00
"""

import sys
import time
import re
import argparse
import statistics
from typing import Optional, Tuple

import serial

BAUD = 115200


class DiagClient:
    def __init__(self, port: str):
        self.ser = serial.Serial(port, BAUD, timeout=0.5)
        time.sleep(2.0)
        self.ser.reset_input_buffer()

    def close(self):
        self.ser.close()

    def flush(self):
        self.ser.reset_input_buffer()

    def raw_write(self, data: bytes):
        self.ser.write(data)

    def raw_readline(self, timeout: float = 2.0) -> Tuple[Optional[str], float]:
        """Read one line, return (line, elapsed_ms). Returns (None, elapsed) on timeout."""
        self.ser.timeout = timeout
        t0 = time.perf_counter()
        raw = self.ser.readline()
        elapsed = (time.perf_counter() - t0) * 1000.0
        if raw:
            return (raw.decode(errors="replace").strip(), elapsed)
        return (None, elapsed)

    def timed_status_query(self) -> Tuple[Optional[str], float]:
        """Send '?' and measure time to receive '<...>' status line."""
        self.flush()
        t0 = time.perf_counter()
        self.ser.write(b"?")
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            raw = self.ser.readline()
            if raw:
                line = raw.decode(errors="replace").strip()
                if line.startswith("<"):
                    elapsed = (time.perf_counter() - t0) * 1000.0
                    return (line, elapsed)
        elapsed = (time.perf_counter() - t0) * 1000.0
        return (None, elapsed)

    def timed_realtime_cmd(self, cmd: bytes, expect_owner: str) -> Tuple[bool, float, str]:
        """Send realtime command, then '?' to check result. Returns (success, total_ms, status)."""
        self.flush()
        t0 = time.perf_counter()
        self.ser.write(cmd)
        self.ser.write(b"?")
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            raw = self.ser.readline()
            if raw:
                line = raw.decode(errors="replace").strip()
                if line.startswith("<"):
                    elapsed = (time.perf_counter() - t0) * 1000.0
                    m = re.search(r"\|OWN:(\w+)", line)
                    owner = m.group(1).lower() if m else "?"
                    return (owner == expect_owner, elapsed, line)
        elapsed = (time.perf_counter() - t0) * 1000.0
        return (False, elapsed, "TIMEOUT")

    def timed_gcode(self, cmd: str) -> Tuple[Optional[str], float]:
        """Send G-code line, measure time to 'ok' or 'error:'. Returns (response, elapsed_ms)."""
        self.flush()
        t0 = time.perf_counter()
        self.ser.write((cmd + "\n").encode())
        deadline = time.monotonic() + 3.0
        lines = []
        while time.monotonic() < deadline:
            raw = self.ser.readline()
            if raw:
                line = raw.decode(errors="replace").strip()
                lines.append(line)
                low = line.lower()
                if low == "ok" or low.startswith("error:"):
                    elapsed = (time.perf_counter() - t0) * 1000.0
                    return (line, elapsed)
        elapsed = (time.perf_counter() - t0) * 1000.0
        return (f"TIMEOUT (got: {lines})", elapsed)


def run_diag(port: str):
    c = DiagClient(port)

    print("=" * 60)
    print("grblHAL Latency Diagnostic")
    print(f"Port: {port}  Baud: {BAUD}")
    print("=" * 60)

    # Phase 0: Initial state
    print("\n--- Phase 0: Initial State ---")
    status, ms = c.timed_status_query()
    print(f"  Status: {status}")
    print(f"  Latency: {ms:.1f}ms")

    # If in Alarm, unlock
    if status and "Alarm" in status:
        print("  -> Alarm detected, unlocking...")
        resp, ms2 = c.timed_gcode("$X")
        print(f"  $X response: {resp} ({ms2:.1f}ms)")
        time.sleep(0.5)

    # Phase 1: Raw status query latency (10x)
    print("\n--- Phase 1: Status Query '?' Latency (10 samples) ---")
    status_times = []
    for i in range(10):
        _, ms = c.timed_status_query()
        status_times.append(ms)
        print(f"  [{i+1:2d}] {ms:7.1f}ms")
        time.sleep(0.05)
    print(f"  >> Mean: {statistics.mean(status_times):.1f}ms  "
          f"Median: {statistics.median(status_times):.1f}ms  "
          f"Min: {min(status_times):.1f}ms  Max: {max(status_times):.1f}ms")

    # Phase 2: Ownership claim/release cycle
    print("\n--- Phase 2: Ownership Transitions ---")

    # Release first
    c.raw_write(bytes([0x8F]))
    time.sleep(0.2)
    c.flush()

    # Host claim
    ok, ms, st = c.timed_realtime_cmd(bytes([0x8D]), "host")
    print(f"  None->Host:  {ms:7.1f}ms  ok={ok}  {st[:60]}")

    # Release
    ok, ms, st = c.timed_realtime_cmd(bytes([0x8F]), "none")
    print(f"  Host->None:  {ms:7.1f}ms  ok={ok}  {st[:60]}")

    # Panel claim
    ok, ms, st = c.timed_realtime_cmd(bytes([0x8E]), "panel")
    print(f"  None->Panel: {ms:7.1f}ms  ok={ok}  {st[:60]}")

    # Release
    ok, ms, st = c.timed_realtime_cmd(bytes([0x8F]), "none")
    print(f"  Panel->None: {ms:7.1f}ms  ok={ok}  {st[:60]}")

    # Host claim then Panel takeover
    c.timed_realtime_cmd(bytes([0x8D]), "host")
    ok, ms, st = c.timed_realtime_cmd(bytes([0x8E]), "panel")
    print(f"  Host->Panel: {ms:7.1f}ms  ok={ok}  {st[:60]}")

    # Release
    c.timed_realtime_cmd(bytes([0x8F]), "none")

    # Phase 3: G-code command latency
    print("\n--- Phase 3: G-code Command Latency ---")

    # Ensure host ownership for G-code
    c.timed_realtime_cmd(bytes([0x8D]), "host")
    time.sleep(0.1)

    for cmd in ["G90", "G91", "G90", "G21"]:
        resp, ms = c.timed_gcode(cmd)
        print(f"  {cmd:20s} -> {resp:10s}  {ms:7.1f}ms")

    # Phase 4: $J= jog command latency (the critical path for panel)
    print("\n--- Phase 4: $J= Jog Command Latency ---")
    jog_times = []
    for i in range(10):
        resp, ms = c.timed_gcode(f"$J=G91 G21 X0.001 F1000")
        jog_times.append(ms)
        print(f"  [{i+1:2d}] $J=G91 G21 X0.001 F1000 -> {resp:10s}  {ms:7.1f}ms")
        time.sleep(0.05)
    print(f"  >> Mean: {statistics.mean(jog_times):.1f}ms  "
          f"Median: {statistics.median(jog_times):.1f}ms  "
          f"Min: {min(jog_times):.1f}ms  Max: {max(jog_times):.1f}ms")

    # Phase 5: $J= via panel ownership (MPG mode)
    print("\n--- Phase 5: $J= via Panel Ownership (MPG mode) ---")
    print("  NOTE: In MPG mode, USB responses go to pendant UART, not here.")
    print("  This test verifies that USB still receives status reports.")

    c.timed_realtime_cmd(bytes([0x8F]), "none")
    c.timed_realtime_cmd(bytes([0x8E]), "panel")
    time.sleep(0.2)

    # In MPG mode, '?' response goes to pendant -- USB gets nothing
    c.flush()
    c.raw_write(b"?")
    line, ms = c.raw_readline(timeout=1.0)
    print(f"  USB '?' in MPG mode: line={line}  {ms:.1f}ms")
    if line is None:
        print("  >> CONFIRMED: MPG mode active, '?' response went to pendant UART")
    else:
        print(f"  >> WARNING: Got response on USB -- MPG mode may not be active!")

    # Release and check recovery
    c.raw_write(bytes([0x8F]))
    time.sleep(0.3)
    status, ms = c.timed_status_query()
    print(f"  After release: {status[:60] if status else 'NONE'}  {ms:.1f}ms")

    # Phase 6: Serial buffer behavior
    print("\n--- Phase 6: Serial Read Buffer Timing ---")
    c.flush()
    c.timed_realtime_cmd(bytes([0x8D]), "host")
    time.sleep(0.1)

    # Send multiple commands rapidly
    print("  Rapid-fire 5x $J= commands:")
    t0_total = time.perf_counter()
    for i in range(5):
        resp, ms = c.timed_gcode(f"$J=G91 G21 X0.001 F5000")
        print(f"    [{i+1}] {resp:10s}  {ms:7.1f}ms")
    total_ms = (time.perf_counter() - t0_total) * 1000.0
    print(f"  >> Total for 5 commands: {total_ms:.1f}ms  "
          f"Avg: {total_ms/5:.1f}ms/cmd")

    # Phase 7: Check pyserial low-level timing
    print("\n--- Phase 7: Raw Serial Byte Timing ---")
    c.flush()
    t0 = time.perf_counter()
    c.ser.write(b"?")
    # Read byte-by-byte to see when first byte arrives
    c.ser.timeout = 2.0
    first_byte_time = None
    buf = b""
    while (time.perf_counter() - t0) < 2.0:
        b = c.ser.read(1)
        if b:
            if first_byte_time is None:
                first_byte_time = (time.perf_counter() - t0) * 1000.0
            buf += b
            if b == b"\n":
                break
    total_time = (time.perf_counter() - t0) * 1000.0
    line = buf.decode(errors="replace").strip()
    print(f"  First byte: {first_byte_time:.1f}ms" if first_byte_time else "  First byte: TIMEOUT")
    print(f"  Full line:  {total_time:.1f}ms")
    print(f"  Content:    {line[:60]}")
    if first_byte_time:
        transfer_time = total_time - first_byte_time
        print(f"  Transfer:   {transfer_time:.1f}ms ({len(buf)} bytes @ {BAUD} baud)")
        expected_transfer = len(buf) * 10 * 1000.0 / BAUD  # 10 bits per byte
        print(f"  Expected:   {expected_transfer:.1f}ms (theoretical minimum)")

    # Cleanup
    print("\n--- Cleanup ---")
    c.raw_write(bytes([0x85]))
    time.sleep(0.1)
    c.raw_write(bytes([0x8F]))
    time.sleep(0.2)
    status, ms = c.timed_status_query()
    print(f"  Final state: {status}")

    c.close()
    print("\n" + "=" * 60)
    print("Diagnostic complete.")


def main():
    parser = argparse.ArgumentParser(description="grblHAL latency diagnostic")
    parser.add_argument("port", help="Serial port")
    args = parser.parse_args()
    run_diag(args.port)


if __name__ == "__main__":
    main()
