"""Diagnosztikai endpointok: board diag, firmware probe, endstop / motion test, progress."""

from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

try:
    from log_config import get_logger
except ImportError:
    from ...log_config import get_logger

from ..dependencies import get_robot_arm_or_400
from ..state import active_test_events, active_test_progress
from ._runner import run_serial_test

logger = get_logger(__name__)
router = APIRouter()


async def _ensure_serial_or_reconnect(device, device_id: str) -> None:
    """Ha nincs élő serial kapcsolat, megkíséreljük az újracsatlakozást."""
    if device._serial and device._serial.is_open:
        return
    logger.info(f"🔄 Serial kapcsolat nem él, újracsatlakozás próba ({device_id})...")
    reconnected = await device.reconnect()
    if not reconnected or not device._serial or not device._serial.is_open:
        raise HTTPException(
            status_code=400,
            detail="Nincs soros kapcsolat. Ellenőrizd, hogy a vezérlő csatlakoztatva van-e.",
        )
    logger.info(f"✅ Újracsatlakozás sikeres ({device_id})")


# ----------------------------------------------------------------------
# Board diagnostics
# ----------------------------------------------------------------------


@router.post("/devices/{device_id}/diagnostics")
async def run_diagnostics(
    device_id: str,
    move_test: bool = False,
    pair=Depends(get_robot_arm_or_400),
):
    """Board diagnosztika futtatása a meglévő serial kapcsolaton."""
    device, metadata = pair

    if metadata and metadata.simulated:
        from board_diagnostics import DiagnosticsReport, TestResult

        report = DiagnosticsReport(
            timestamp=datetime.now().isoformat(),
            port="simulated",
            device_signature="SimulatedDevice",
            firmware_info="Szimulált firmware v1.0",
        )
        report.tests = [
            TestResult(name="Soros kapcsolat", passed=True, message="Szimulált kapcsolat – OK"),
            TestResult(name="Firmware verzió (M115)", passed=True, message="Szimulált firmware v1.0"),
            TestResult(
                name="Endstop állapot (M119)",
                passed=True,
                message="Endstopok: X=0 Y=0 Z=0 (szimulált)",
            ),
            TestResult(name="Kalibrációs parancs (G92)", passed=True, message="Pozíció nullázva (szimulált)"),
            TestResult(name="Gripper szervó", passed=True, message="Szimulált gripper – OK"),
            TestResult(name="Szívópumpa (relé)", passed=True, message="Szimulált szívó – OK"),
            TestResult(name="Motor enable/disable", passed=True, message="Szimulált enable/disable – OK"),
            TestResult(
                name="Kommunikációs latencia",
                passed=True,
                message="Átlag: 1.0 ms (szimulált)",
                details={"avg_ms": 1.0, "min_ms": 1.0, "max_ms": 1.0, "samples": 5},
            ),
            TestResult(name="Hibakezelés (ismeretlen parancs)", passed=True, message="Szimulált hibakezelés – OK"),
        ]
        report.total_tests = len(report.tests)
        report.passed_tests = report.total_tests
        report.failed_tests = 0
        report.skipped_tests = 0
        report.overall_passed = True
        return report.to_dict()

    await _ensure_serial_or_reconnect(device, device_id)

    from board_diagnostics import BoardDiagnostics

    device._diagnostics_running = True
    device._stop_status_polling()
    await asyncio.sleep(1.5)

    diag = BoardDiagnostics(port=device.port, interactive=False)

    try:
        async with device._serial_lock:
            def _run():
                return diag.run_with_serial(device._serial, move_test=move_test)
            report = await asyncio.to_thread(_run)
    finally:
        device._diagnostics_running = False
        device._start_status_polling()

    return report.to_dict()


# ----------------------------------------------------------------------
# Firmware probe
# ----------------------------------------------------------------------


@router.post("/devices/{device_id}/firmware-probe")
async def run_firmware_probe(device_id: str, pair=Depends(get_robot_arm_or_400)):
    """Firmware paraméterek felderítése – különböző parancsok kipróbálása."""
    device, metadata = pair

    if metadata and metadata.simulated:
        return {
            "timestamp": "",
            "port": "simulated",
            "firmware_type": "simulated",
            "recognized_commands": [],
            "unrecognized_commands": [],
            "all_results": [],
            "summary": {
                "total_commands": 0,
                "recognized": 0,
                "unrecognized": 0,
                "firmware_type": "simulated",
                "configurable_params": {},
            },
        }

    await _ensure_serial_or_reconnect(device, device_id)

    from firmware_probe import FirmwareProbe

    return await run_serial_test(
        device=device,
        device_id=device_id,
        runner_factory=lambda: FirmwareProbe(port=device.port),
        blocking_call=lambda probe, stop_event: probe.run_with_serial(
            device._serial, stop_event=stop_event
        ),
    )


# ----------------------------------------------------------------------
# Endstop test / endstop state
# ----------------------------------------------------------------------


@router.post("/devices/{device_id}/endstop-test")
async def run_endstop_test(
    device_id: str,
    step_size: float = 5.0,
    speed: int = 15,
    max_angle: float = 200.0,
    pair=Depends(get_robot_arm_or_400),
):
    """Végállás teszt – minden tengely végállásig mozgatása."""
    device, metadata = pair

    if metadata and metadata.simulated:
        return {
            "timestamp": "",
            "port": "simulated",
            "step_size": step_size,
            "speed": speed,
            "max_search_angle": max_angle,
            "axes": [],
            "completed": True,
            "error": None,
            "duration_seconds": 0.0,
        }

    await _ensure_serial_or_reconnect(device, device_id)

    from endstop_test import EndstopTest

    return await run_serial_test(
        device=device,
        device_id=device_id,
        runner_factory=lambda: EndstopTest(
            port=device.port,
            step_size=step_size,
            speed=speed,
            max_search_angle=max_angle,
        ),
        blocking_call=lambda test, stop_event: test.run_with_serial(
            device._serial, stop_event=stop_event
        ),
    )


@router.get("/devices/{device_id}/endstops")
async def get_endstop_states(pair=Depends(get_robot_arm_or_400)):
    """Végállás érzékelők aktuális állapotának lekérdezése (M119)."""
    device, metadata = pair

    if metadata and metadata.simulated:
        return {"endstops": {"X": False, "Y": False, "Z": False}}

    if not device._connected:
        raise HTTPException(status_code=400, detail="Eszköz nincs csatlakozva")

    if device._diagnostics_running:
        raise HTTPException(status_code=409, detail="Diagnosztika fut")

    endstops = await device.check_endstops()
    return {"endstops": endstops}


# ----------------------------------------------------------------------
# Motion test
# ----------------------------------------------------------------------


@router.post("/devices/{device_id}/motion-test")
async def run_motion_test(
    device_id: str,
    test_angle: float = 30.0,
    pair=Depends(get_robot_arm_or_400),
):
    """Mozgásminőség teszt – különböző sebességekkel."""
    device, metadata = pair

    if metadata and metadata.simulated:
        return {
            "timestamp": "",
            "port": "simulated",
            "test_angle": test_angle,
            "speeds_tested": [],
            "results": [],
            "recommended_speed": 50,
            "speed_summary": {},
            "completed": True,
            "error": None,
            "duration_seconds": 0.0,
        }

    await _ensure_serial_or_reconnect(device, device_id)

    from motion_test import MotionTest

    return await run_serial_test(
        device=device,
        device_id=device_id,
        runner_factory=lambda: MotionTest(port=device.port, test_angle=test_angle),
        blocking_call=lambda test, stop_event: test.run_with_serial(
            device._serial, stop_event=stop_event
        ),
    )


# ----------------------------------------------------------------------
# Test cancel / progress
# ----------------------------------------------------------------------


@router.post("/devices/{device_id}/cancel-test")
async def cancel_test(device_id: str):
    """Futó teszt (firmware-probe, endstop-test, motion-test) leállítása."""
    stop_event = active_test_events.get(device_id)
    if stop_event is None:
        return {"success": False, "message": "Nincs futó teszt ezen az eszközön"}

    stop_event.set()
    return {"success": True, "message": "Leállítási jelzés elküldve"}


@router.get("/devices/{device_id}/test-progress")
async def get_test_progress(device_id: str, after: int = 0):
    """Futó teszt napló lekérdezése (polling). after = ennyi bejegyzést ugorjon át."""
    log = active_test_progress.get(device_id)
    if log is None:
        return {"entries": [], "total": 0, "running": False}

    entries = log[after:]
    return {
        "entries": entries,
        "total": len(log),
        "running": device_id in active_test_events,
    }
