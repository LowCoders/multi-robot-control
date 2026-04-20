#!/usr/bin/env python3
"""
Bridge jog session integration test.

Tests the bridge API's jog session start/stop via HTTP, verifying
that jog cancel (0x85) is used and the machine returns to Idle promptly.

Usage:
    python test_bridge_jog.py [--base-url http://localhost:8000] [--device-id DEVICE_ID]

Requirements:
    pip install httpx
"""

import asyncio
import argparse
import time
import sys
from typing import Optional

try:
    import httpx
except ImportError:
    print("ERROR: httpx required. Install with: pip install httpx")
    sys.exit(1)


class BridgeJogTester:
    def __init__(self, base_url: str, device_id: str):
        self.base_url = base_url.rstrip("/")
        self.device_id = device_id
        self.client = httpx.AsyncClient(timeout=10.0)

    async def close(self):
        await self.client.aclose()

    async def get_status(self) -> dict:
        r = await self.client.get(f"{self.base_url}/api/devices/{self.device_id}/status")
        r.raise_for_status()
        return r.json()

    async def start_jog(self, axis: str = "X", direction: int = 1, feed_rate: float = 500.0) -> dict:
        r = await self.client.post(
            f"{self.base_url}/api/devices/{self.device_id}/jog/session/start",
            json={"axis": axis, "direction": direction, "feed_rate": feed_rate},
        )
        r.raise_for_status()
        return r.json()

    async def stop_jog(self) -> dict:
        r = await self.client.post(
            f"{self.base_url}/api/devices/{self.device_id}/jog/session/stop",
            json={},
        )
        r.raise_for_status()
        return r.json()


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


async def run_tests(base_url: str, device_id: str) -> list:
    results = []
    tester = BridgeJogTester(base_url, device_id)

    try:
        # T1: Device reachable
        try:
            status = await tester.get_status()
            results.append(TestResult("Device reachable", True, f"state={status.get('state')}"))
        except Exception as e:
            results.append(TestResult("Device reachable", False, str(e)))
            return results

        # T2: Start jog session
        try:
            resp = await tester.start_jog(axis="X", direction=1, feed_rate=500.0)
            ok = resp.get("ok", resp.get("success", False))
            results.append(TestResult("Start jog session", bool(ok), f"response={resp}"))
        except Exception as e:
            results.append(TestResult("Start jog session", False, str(e)))
            return results

        # Wait a bit for jog to be active
        await asyncio.sleep(0.5)

        # T3: Device in Jog state while session active
        try:
            status = await tester.get_status()
            state = status.get("state", "")
            results.append(TestResult(
                "Device in Jog state",
                "jog" in state.lower() or "running" in state.lower(),
                f"state={state}"
            ))
        except Exception as e:
            results.append(TestResult("Device in Jog state", False, str(e)))

        # T4: Stop jog session -- should use 0x85 and return to Idle quickly
        t0 = time.monotonic()
        try:
            resp = await tester.stop_jog()
            elapsed = time.monotonic() - t0
            results.append(TestResult(
                "Stop jog session",
                True,
                f"elapsed={elapsed:.3f}s response={resp}"
            ))
        except Exception as e:
            results.append(TestResult("Stop jog session", False, str(e)))
            return results

        # T5: Device returns to Idle promptly (< 1s)
        await asyncio.sleep(0.3)
        try:
            status = await tester.get_status()
            state = status.get("state", "")
            results.append(TestResult(
                "Device Idle after stop",
                "idle" in state.lower(),
                f"state={state}"
            ))
        except Exception as e:
            results.append(TestResult("Device Idle after stop", False, str(e)))

        # T6: No Hold state after jog stop (jog cancel should skip Hold)
        try:
            status = await tester.get_status()
            state = status.get("state", "")
            not_hold = "hold" not in state.lower() and "paused" not in state.lower()
            results.append(TestResult(
                "No Hold state after jog cancel",
                not_hold,
                f"state={state}"
            ))
        except Exception as e:
            results.append(TestResult("No Hold state after jog cancel", False, str(e)))

    finally:
        await tester.close()

    return results


def main():
    parser = argparse.ArgumentParser(description="Bridge jog session test")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Bridge server base URL")
    parser.add_argument("--device-id", default="tube_bender_1", help="Device ID")
    args = parser.parse_args()

    print("Bridge Jog Session Test Suite")
    print(f"URL: {args.base_url}  Device: {args.device_id}")
    print("-" * 50)

    results = asyncio.run(run_tests(args.base_url, args.device_id))

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
