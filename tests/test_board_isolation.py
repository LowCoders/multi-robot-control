#!/usr/bin/env python3
"""
Board-level UART/USB isolation test.

Monitors both the USB (host) and pendant UART ports simultaneously
to detect cross-talk or interference patterns between the two channels.

Usage:
    python test_board_isolation.py --usb /dev/ttyUSB0 --pendant /dev/ttyUSB1
    python test_board_isolation.py --usb COM3 --pendant COM4

Requirements:
    pip install pyserial
"""

import sys
import time
import threading
import argparse
from typing import Optional
from collections import deque

import serial

BAUD = 115200
TIMEOUT_S = 0.5


class PortMonitor:
    """Monitor a serial port in a background thread, collecting timestamped lines."""

    def __init__(self, port: str, name: str, baud: int = BAUD):
        self.name = name
        self.ser = serial.Serial(port, baud, timeout=TIMEOUT_S)
        self.lines: deque = deque(maxlen=1000)
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        self._running = True
        self.ser.reset_input_buffer()
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)
        self.ser.close()

    def _read_loop(self):
        while self._running:
            try:
                if self.ser.in_waiting:
                    raw = self.ser.readline()
                    if raw:
                        ts = time.perf_counter()
                        line = raw.decode(errors="replace").strip()
                        if line:
                            self.lines.append((ts, line))
                else:
                    time.sleep(0.005)
            except Exception:
                break

    def write(self, data: bytes):
        self.ser.write(data)

    def write_line(self, line: str):
        self.ser.write((line + "\n").encode())

    def get_lines_since(self, since: float) -> list:
        return [(ts, ln) for ts, ln in self.lines if ts >= since]


class TestResult:
    def __init__(self, name: str, passed: bool, detail: str = ""):
        self.name = name
        self.passed = passed
        self.detail = detail

    def __str__(self):
        mark = "PASS" if self.passed else "FAIL"
        s = f"  [{mark}] {self.name}"
        if self.detail:
            s += f"  -- {self.detail}"
        return s


def run_tests(usb_port: str, pendant_port: str) -> list:
    results = []

    usb = PortMonitor(usb_port, "USB")
    pendant = PortMonitor(pendant_port, "Pendant")

    time.sleep(2.0)
    usb.start()
    pendant.start()
    time.sleep(0.5)

    try:
        # T1: USB status query goes to USB only (no MPG mode)
        usb.write(bytes([0x8F]))  # release ownership first
        time.sleep(0.3)
        t0 = time.perf_counter()
        usb.write(b"?")
        time.sleep(0.5)

        usb_lines = usb.get_lines_since(t0)
        pendant_lines = pendant.get_lines_since(t0)
        usb_got_status = any("<" in ln for _, ln in usb_lines)
        pendant_got_status = any("<" in ln for _, ln in pendant_lines)

        results.append(TestResult(
            "USB ? response stays on USB (no MPG)",
            usb_got_status and not pendant_got_status,
            f"usb_status={usb_got_status} pendant_leak={pendant_got_status}"
        ))

        # T2: With panel ownership (MPG on), USB ? response goes to pendant
        usb.write(bytes([0x8E]))  # panel request via USB
        time.sleep(0.5)

        t0 = time.perf_counter()
        usb.write(b"?")
        time.sleep(0.5)

        usb_lines = usb.get_lines_since(t0)
        pendant_lines = pendant.get_lines_since(t0)
        pendant_got_status = any("<" in ln for _, ln in pendant_lines)

        results.append(TestResult(
            "USB ? response routes to pendant (MPG on)",
            pendant_got_status,
            f"pendant_status={pendant_got_status} pendant_count={len(pendant_lines)}"
        ))

        # T3: Pendant $J= command works in panel mode
        t0 = time.perf_counter()
        pendant.write_line("$J=G91 G21 X0.01 F1000")
        time.sleep(0.5)

        pendant_lines = pendant.get_lines_since(t0)
        got_ok = any("ok" in ln.lower() for _, ln in pendant_lines)
        results.append(TestResult(
            "Pendant $J= gets ok response",
            got_ok,
            f"pendant_responses={[ln for _, ln in pendant_lines]}"
        ))

        # T4: Simultaneous traffic -- USB polling doesn't corrupt pendant data
        pendant.write(bytes([0x85]))  # jog cancel
        time.sleep(0.2)

        t0 = time.perf_counter()
        corrupted = False
        for i in range(10):
            usb.write(b"?")  # USB polling
            pendant.write_line(f"$J=G91 G21 X0.001 F1000")
            time.sleep(0.05)

        time.sleep(0.5)
        pendant_lines = pendant.get_lines_since(t0)
        ok_count = sum(1 for _, ln in pendant_lines if ln.strip().lower() == "ok")
        error_count = sum(1 for _, ln in pendant_lines if ln.strip().lower().startswith("error:"))
        garbled = sum(1 for _, ln in pendant_lines
                      if ln.strip() and not ln.startswith("<") and ln.strip().lower() != "ok"
                      and not ln.strip().lower().startswith("error:"))

        results.append(TestResult(
            "No corruption under simultaneous USB+pendant traffic",
            garbled == 0,
            f"ok={ok_count} errors={error_count} garbled={garbled}"
        ))

        # Cleanup
        pendant.write(bytes([0x85]))  # jog cancel
        time.sleep(0.1)
        usb.write(bytes([0x8F]))  # release ownership
        time.sleep(0.3)

    finally:
        usb.stop()
        pendant.stop()

    return results


def main():
    parser = argparse.ArgumentParser(description="Board-level UART/USB isolation test")
    parser.add_argument("--usb", required=True, help="USB host serial port")
    parser.add_argument("--pendant", required=True, help="Pendant UART serial port")
    args = parser.parse_args()

    print("Board Isolation Test Suite")
    print(f"USB: {args.usb}  Pendant: {args.pendant}  Baud: {BAUD}")
    print("-" * 50)

    results = run_tests(args.usb, args.pendant)

    print()
    for r in results:
        print(r)

    passed = sum(1 for r in results if r.passed)
    total = len(results)
    print("-" * 50)
    print(f"Results: {passed}/{total} passed")

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
