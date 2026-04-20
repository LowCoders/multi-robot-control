#!/usr/bin/env python3
"""
Panel UART latency test.

Measures round-trip time for $J= jog commands sent over the pendant UART,
simulating what the CrowPanel HMI does.

Connect to the pendant UART port (the same one CrowPanel uses) and
send $J= commands, measuring time until 'ok' response.

Usage:
    python test_panel_uart_latency.py /dev/ttyUSB1   # pendant UART port
    python test_panel_uart_latency.py COM4            # Windows

Requirements:
    pip install pyserial
"""

import sys
import time
import argparse
import statistics
from typing import Optional

import serial

BAUD = 115200
TIMEOUT_S = 2.0


def send_and_measure(ser: serial.Serial, command: str) -> Optional[float]:
    """Send a command and measure time until 'ok' or 'error' response. Returns ms or None on timeout."""
    ser.reset_input_buffer()
    t0 = time.perf_counter()
    ser.write((command + "\n").encode())

    deadline = time.monotonic() + TIMEOUT_S
    while time.monotonic() < deadline:
        raw = ser.readline()
        if raw:
            line = raw.decode(errors="replace").strip().lower()
            if line == "ok" or line.startswith("error:"):
                return (time.perf_counter() - t0) * 1000.0
    return None


def run_latency_test(port: str, iterations: int = 20) -> list:
    ser = serial.Serial(port, BAUD, timeout=TIMEOUT_S)
    time.sleep(2.0)
    ser.reset_input_buffer()

    results = []

    # Ensure we're in a clean state -- send ownership claim + status query
    ser.write(bytes([0x8E]))  # panel claim
    time.sleep(0.3)
    ser.reset_input_buffer()

    print(f"\nRunning {iterations} $J= round-trip latency measurements...\n")

    for i in range(iterations):
        # Small incremental jog
        cmd = f"$J=G91 G21 X0.01 F1000"
        latency = send_and_measure(ser, cmd)
        if latency is not None:
            results.append(latency)
            print(f"  [{i+1:3d}/{iterations}]  {latency:7.2f} ms")
        else:
            print(f"  [{i+1:3d}/{iterations}]  TIMEOUT")
        time.sleep(0.05)

    # Release ownership
    ser.write(bytes([0x85]))  # jog cancel
    time.sleep(0.1)
    ser.write(bytes([0x8F]))  # release
    time.sleep(0.2)
    ser.close()

    return results


def main():
    parser = argparse.ArgumentParser(description="Panel UART latency test")
    parser.add_argument("port", help="Pendant UART serial port")
    parser.add_argument("-n", "--iterations", type=int, default=20, help="Number of iterations")
    args = parser.parse_args()

    print("Panel UART Latency Test")
    print(f"Port: {args.port}  Baud: {BAUD}")
    print("-" * 50)

    results = run_latency_test(args.port, args.iterations)

    if results:
        print()
        print("-" * 50)
        print(f"Samples:  {len(results)}/{args.iterations}")
        print(f"Min:      {min(results):.2f} ms")
        print(f"Max:      {max(results):.2f} ms")
        print(f"Mean:     {statistics.mean(results):.2f} ms")
        print(f"Median:   {statistics.median(results):.2f} ms")
        if len(results) >= 2:
            print(f"Stdev:    {statistics.stdev(results):.2f} ms")
        target = 30.0
        under_target = sum(1 for r in results if r < target)
        print(f"< {target}ms:   {under_target}/{len(results)} ({100*under_target/len(results):.0f}%)")
    else:
        print("\nNo successful measurements!")

    sys.exit(0 if results else 1)


if __name__ == "__main__":
    main()
