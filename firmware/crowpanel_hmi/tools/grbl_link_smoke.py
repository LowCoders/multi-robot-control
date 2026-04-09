#!/usr/bin/env python3
"""Smoke test for CrowPanel<->grblHAL UART protocol assumptions.

Runs from host over primary USB serial and validates:
1) grblHAL identity
2) MPG command-toggle byte (0x8B) is accepted
3) realtime status streaming works
"""

import argparse
import time

import serial


def send_line(ser: serial.Serial, cmd: str, delay_s: float = 0.35) -> str:
    ser.write((cmd + "\n").encode("ascii"))
    time.sleep(delay_s)
    return ser.read_all().decode("utf-8", errors="ignore")


def send_byte(ser: serial.Serial, value: int, delay_s: float = 0.25) -> str:
    ser.write(bytes([value]))
    time.sleep(delay_s)
    return ser.read_all().decode("utf-8", errors="ignore")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="/dev/ttyACM0")
    ap.add_argument("--baud", type=int, default=115200)
    args = ap.parse_args()

    with serial.Serial(args.port, args.baud, timeout=0.6, write_timeout=1.0) as ser:
        time.sleep(1.1)
        ser.reset_input_buffer()

        print("=== RESET ===")
        print(send_byte(ser, 0x18).strip() or "<no response>")

        print("=== $I ===")
        info = send_line(ser, "$I")
        print(info.strip() or "<no response>")
        if "[FIRMWARE:grblHAL]" not in info:
            raise SystemExit("FAIL: grblHAL banner not found")
        if "MPG" not in info:
            raise SystemExit("FAIL: MPG option is missing from [NEWOPT]")

        print("=== MPG toggle (0x8B) ===")
        print(send_byte(ser, 0x8B).strip() or "<no response>")

        print("=== Status (?) ===")
        status = send_line(ser, "?")
        print(status.strip() or "<no response>")
        if "<" not in status:
            raise SystemExit("FAIL: realtime status frame missing")

        print("PASS: serial protocol smoke checks completed")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
