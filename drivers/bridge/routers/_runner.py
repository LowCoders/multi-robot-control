"""Közös runner a thread-alapú diagnosztikai tesztekhez.

A `firmware-probe`, `endstop-test`, `motion-test` (és későbbi diagnosztikai
endpointok) ugyanazt a koreográfiát futtatják:

  1. Polling leállítása (`device._diagnostics_running = True`,
     `device._stop_status_polling()`).
  2. Várás, hogy az utolsó polling kérés befejeződjön (1.5 s).
  3. `stop_event` regisztráció a `active_test_events`-ben (cancel-test
     endpoint ezt találja meg).
  4. A `runner_factory` által létrehozott objektum log-jainak regisztrálása
     a `active_test_progress`-ben (test-progress endpoint olvassa).
  5. A blocking függvény futtatása `asyncio.to_thread`-en, a
     `device._serial_lock` alatt.
  6. Cleanup: log + event eltávolítása, polling újraindítása.

Ezt egy helyen írjuk le, így a router-fájlokban csak a payload és a
runner-konstruktor van.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, Awaitable, Callable, Dict, Optional

from ..state import active_test_events, active_test_progress

_POLLING_QUIESCE_DELAY_SEC = 1.5


async def run_serial_test(
    *,
    device: Any,
    device_id: str,
    runner_factory: Callable[[], Any],
    blocking_call: Callable[[Any, threading.Event], Any],
    log_attr: str = "_log_entries",
) -> Dict[str, Any]:
    """Diagnosztikai teszt futtatása szabványos koreográfiával.

    Args:
        device: Az eszköz driver példánya (RobotArmDevice vagy hasonló).
        device_id: Az eszköz azonosítója (cancel/progress endpointokhoz).
        runner_factory: 0-arg callable, ami visszaadja a teszt-objektumot
            (`FirmwareProbe`, `EndstopTest`, `MotionTest`, ...).
        blocking_call: A tényleges szinkron hívás. Megkapja a runner-t és
            a `stop_event`-et, és vissza kell adnia egy `report` objektumot,
            amelyen `to_dict()` van.
        log_attr: Melyik attribútumon él a runner progress-log listája.
            Alapértelmezetten `_log_entries`.

    Returns:
        A `report.to_dict()` dict-jét.
    """
    device._diagnostics_running = True
    device._stop_status_polling()
    await asyncio.sleep(_POLLING_QUIESCE_DELAY_SEC)

    stop_event = threading.Event()
    active_test_events[device_id] = stop_event

    runner = runner_factory()
    log_list = getattr(runner, log_attr, None)
    if log_list is not None:
        active_test_progress[device_id] = log_list

    try:
        async with device._serial_lock:
            def _run():
                return blocking_call(runner, stop_event)
            report = await asyncio.to_thread(_run)
    finally:
        active_test_events.pop(device_id, None)
        active_test_progress.pop(device_id, None)
        device._diagnostics_running = False
        device._start_status_polling()

    return report.to_dict()


__all__ = ["run_serial_test"]
