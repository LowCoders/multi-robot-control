"""Mozgás-vezérlés: home, jog (egyszeri + session), gcode, run/pause/stop, override."""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException

try:
    from control_lock_decorator import ControlLockDecorator
    from api_models import (
        FileRequest,
        GCodeRequest,
        HomeRequest,
        JogRequest,
        JogSessionBeatRequest,
        JogSessionStartRequest,
        JogSessionStopRequest,
        OverrideRequest,
    )
except ImportError:
    from ...control_lock_decorator import ControlLockDecorator
    from ...api_models import (
        FileRequest,
        GCodeRequest,
        HomeRequest,
        JogRequest,
        JogSessionBeatRequest,
        JogSessionStartRequest,
        JogSessionStopRequest,
        OverrideRequest,
    )

from ..state import device_manager

router = APIRouter()


def _get_device_or_404(device_id: str):
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    return device


@router.post("/devices/{device_id}/home")
async def home_device(device_id: str, request: Optional[HomeRequest] = None):
    """Homing végrehajtása."""
    device = _get_device_or_404(device_id)
    axes = request.axes if request else None
    feed_rate = request.feed_rate if request else None
    result = await device.home(axes, feed_rate=feed_rate)
    return {"success": result}


@router.post("/devices/{device_id}/jog")
async def jog_device(device_id: str, request: JogRequest):
    """Jog mozgás.

    Robotkar drivereknél a `mode` mező alapján Cartesian vagy joint jog-ot
    indítunk; CNC/GRBL drivereknél a sima `jog()`-ot. ControlLockDecorator
    közbeiktatása esetén az inner driver interfészét vizsgáljuk, hogy a
    GRBL device-ok ne fussanak végig a jog_joint útvonalon.
    """
    device = _get_device_or_404(device_id)

    if isinstance(device, ControlLockDecorator):
        inner = device._inner
        has_arm_jog = hasattr(inner, "jog_joint") and hasattr(inner, "jog_cartesian")
        if has_arm_jog:
            if request.mode == "cartesian":
                result = await device.jog_cartesian(
                    request.axis, request.distance, request.feed_rate
                )
            else:
                result = await device.jog_joint(
                    request.axis, request.distance, request.feed_rate
                )
        else:
            result = await device.jog(request.axis, request.distance, request.feed_rate)
    elif hasattr(device, "jog_joint") and hasattr(device, "jog_cartesian"):
        if request.mode == "cartesian":
            result = await device.jog_cartesian(
                request.axis, request.distance, request.feed_rate
            )
        else:
            result = await device.jog_joint(request.axis, request.distance, request.feed_rate)
    else:
        result = await device.jog(request.axis, request.distance, request.feed_rate)

    return {"success": result}


@router.post("/devices/{device_id}/jog/stop")
async def jog_stop_device(device_id: str):
    """Jog leállítása."""
    device = _get_device_or_404(device_id)
    result = await device.jog_stop()
    return {"success": result}


@router.post("/devices/{device_id}/jog/session/start")
async def jog_session_start(device_id: str, request: JogSessionStartRequest):
    """Folyamatos jog session indítása."""
    device = _get_device_or_404(device_id)

    if hasattr(device, "start_jog_session"):
        result = await device.start_jog_session(
            axis=request.axis,
            direction=request.direction,
            feed_rate=request.feed_rate,
            heartbeat_timeout=request.heartbeat_timeout,
            tick_ms=request.tick_ms,
            mode=request.mode,
        )
        return {"success": result}

    distance = (request.feed_rate / 60.0) * (max(20, min(200, request.tick_ms)) / 1000.0)
    distance = distance if request.direction >= 0 else -distance
    result = await device.jog(request.axis, distance, request.feed_rate)
    return {"success": result, "fallback": True}


@router.post("/devices/{device_id}/jog/session/beat")
async def jog_session_beat(device_id: str, request: JogSessionBeatRequest):
    """Folyamatos jog session heartbeat / paraméter frissítés."""
    device = _get_device_or_404(device_id)

    if hasattr(device, "update_jog_session"):
        result = await device.update_jog_session(
            axis=request.axis,
            direction=request.direction,
            feed_rate=request.feed_rate,
            mode=request.mode,
        )
        return {"success": result}

    return {"success": False, "fallback": True}


@router.post("/devices/{device_id}/jog/session/stop")
async def jog_session_stop(device_id: str, request: JogSessionStopRequest):
    """Folyamatos jog session leállítás (opcionális hard stop)."""
    device = _get_device_or_404(device_id)

    try:
        if hasattr(device, "stop_jog_session"):
            result = await device.stop_jog_session(hard_stop=request.hard_stop)
            try:
                await device.get_status()
            except Exception:
                pass
            return {"success": result}

        if request.hard_stop and hasattr(device, "hard_jog_stop"):
            result = await device.hard_jog_stop()
            try:
                await device.get_status()
            except Exception:
                pass
            return {"success": result, "fallback": True}

        result = await device.jog_stop()
        try:
            await device.get_status()
        except Exception:
            pass
        return {"success": result, "fallback": True}
    except asyncio.CancelledError:
        try:
            if request.hard_stop and hasattr(device, "hard_jog_stop"):
                result = await device.hard_jog_stop()
                try:
                    await device.get_status()
                except Exception:
                    pass
                return {"success": result, "fallback": True, "cancelled": True}
            result = await device.jog_stop()
            try:
                await device.get_status()
            except Exception:
                pass
            return {"success": result, "fallback": True, "cancelled": True}
        except Exception:
            return {"success": False, "fallback": True, "cancelled": True}
    except Exception:
        try:
            if request.hard_stop and hasattr(device, "hard_jog_stop"):
                result = await device.hard_jog_stop()
                try:
                    await device.get_status()
                except Exception:
                    pass
                return {"success": result, "fallback": True}
            result = await device.jog_stop()
            try:
                await device.get_status()
            except Exception:
                pass
            return {"success": result, "fallback": True}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Jog session stop hiba: {exc}")


@router.get("/devices/{device_id}/jog/diagnostics")
async def get_jog_diagnostics(device_id: str):
    """Utolsó jog művelet nyers diagnosztikai adatai."""
    device = _get_device_or_404(device_id)

    if not hasattr(device, "get_jog_diagnostics"):
        raise HTTPException(status_code=400, detail="Az eszköz nem támogat jog diagnosztikát")

    return device.get_jog_diagnostics()


@router.post("/devices/{device_id}/gcode")
async def send_gcode(device_id: str, request: GCodeRequest):
    """G-code parancs küldése."""
    device = _get_device_or_404(device_id)
    response = await device.send_gcode(request.gcode)
    return {"response": response}


@router.post("/devices/{device_id}/load")
async def load_file(device_id: str, request: FileRequest):
    """G-code fájl betöltése."""
    device = _get_device_or_404(device_id)
    result = await device.load_file(request.filepath)
    return {"success": result}


@router.post("/devices/{device_id}/run")
async def run_device(device_id: str, from_line: int = 0):
    """Program futtatás indítása."""
    device = _get_device_or_404(device_id)
    result = await device.run(from_line)
    return {"success": result}


@router.post("/devices/{device_id}/pause")
async def pause_device(device_id: str):
    """Program megállítása."""
    device = _get_device_or_404(device_id)
    result = await device.pause()
    return {"success": result}


@router.post("/devices/{device_id}/resume")
async def resume_device(device_id: str):
    """Program folytatása."""
    device = _get_device_or_404(device_id)
    result = await device.resume()
    return {"success": result}


@router.post("/devices/{device_id}/stop")
async def stop_device(device_id: str):
    """Program leállítása."""
    device = _get_device_or_404(device_id)
    result = await device.stop()
    return {"success": result}


@router.post("/devices/{device_id}/reset")
async def reset_device(device_id: str):
    """Eszköz reset."""
    device = _get_device_or_404(device_id)
    result = await device.reset()
    return {"success": result}


@router.post("/devices/{device_id}/feed-override")
async def set_feed_override(device_id: str, request: OverrideRequest):
    """Feed rate override beállítása."""
    device = _get_device_or_404(device_id)
    result = await device.set_feed_override(request.percent)
    return {"success": result}


@router.post("/devices/{device_id}/spindle-override")
async def set_spindle_override(device_id: str, request: OverrideRequest):
    """Spindle speed override beállítása."""
    device = _get_device_or_404(device_id)
    result = await device.set_spindle_override(request.percent)
    return {"success": result}
