"""Ownership / control lock endpointok (request/release/state)."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

try:
    from log_config import get_logger
    from api_models import ControlRequest, ControlReleaseRequest
except ImportError:
    from ...log_config import get_logger
    from ...api_models import ControlRequest, ControlReleaseRequest

from ..helpers import (
    RT_OWN_CLAIM_HOST,
    RT_OWN_QUERY,
    RT_OWN_RELEASE,
    RT_OWN_REQUEST_PANEL,
    sync_control_from_firmware,
)
from ..state import device_manager

logger = get_logger(__name__)
router = APIRouter()


@router.get("/devices/{device_id}/control/state")
async def get_device_control_state(device_id: str):
    """Ownership lock állapot lekérdezése.

    Ha az eszköz nem támogat lockot, neutrális default állapotot adunk
    vissza (nem 400-at), hogy a backend periodikus lekérdezése ne zajongjon.
    """
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    if not hasattr(device, "get_control_state"):
        return {
            "owner": "host",
            "lock_state": "granted",
            "reason": None,
            "version": 0,
            "last_changed_by": "default_no_lock_support",
            "requested_owner": None,
            "can_take_control": False,
        }

    return device.get_control_state()


@router.post("/devices/{device_id}/control/request")
async def request_device_control(device_id: str, request: ControlRequest):
    """Ownership kérés (host|panel).

    Ha az eszköz támogat realtime ownership parancsokat (firmware oldali
    lock), akkor azt használjuk forrásként; egyébként a decorator szintű
    request_control()-t hívjuk fallback-ként.
    """
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    if not hasattr(device, "request_control"):
        raise HTTPException(status_code=400, detail="Az eszköz nem támogat ownership lockot")

    requested_owner = (request.requested_owner or "").strip().lower()

    if hasattr(device, "send_realtime_command"):
        try:
            capabilities = await device.get_capabilities()
            supports_panel_controller = bool(
                getattr(capabilities, "supports_panel_controller", False)
            )
            if supports_panel_controller:
                cmd = None
                if requested_owner == "host":
                    cmd = RT_OWN_CLAIM_HOST
                elif requested_owner == "panel":
                    cmd = RT_OWN_REQUEST_PANEL
                else:
                    raise HTTPException(status_code=400, detail="Érvénytelen ownership kérés")

                sent = await device.send_realtime_command(cmd)
                await device.send_realtime_command(RT_OWN_QUERY)
                control = await sync_control_from_firmware(
                    device,
                    changed_by=request.requested_by or "api_request_rt",
                )
                if control is None and hasattr(device, "get_control_state"):
                    control = device.get_control_state()
                if control is None:
                    control = {}

                owner_ok = str(control.get("owner", "")).lower() == requested_owner
                lock_ok = str(control.get("lock_state", "")).lower() == "granted"
                granted = bool(sent and owner_ok and lock_ok)
                reason = str(control.get("reason") or "denied")
                if (
                    reason == "denied"
                    and sent
                    and str(control.get("owner", "none")).lower() == "none"
                ):
                    reason = "firmware_no_ownership_ack"
                result = {
                    "granted": granted,
                    "reason": None if granted else reason,
                    "state": control,
                }
                if granted:
                    await device_manager._broadcast_control_state(device_id, control)
                else:
                    await device_manager._broadcast_control_denied(
                        device_id, reason, control
                    )
                return result
        except HTTPException:
            raise
        except Exception as exc:
            logger.error(f"⚠️ Firmware ownership request hiba ({device_id}): {exc}")

    result = device.request_control(
        requested_owner=request.requested_owner,
        requested_by=request.requested_by or "api_request",
    )
    control = result.get("state", {})
    if result.get("granted"):
        await device_manager._broadcast_control_state(device_id, control)
    else:
        await device_manager._broadcast_control_denied(
            device_id,
            str(result.get("reason") or "denied"),
            control,
        )
    return result


@router.post("/devices/{device_id}/control/release")
async def release_device_control(
    device_id: str, request: Optional[ControlReleaseRequest] = None
):
    """Ownership elengedése."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    if not hasattr(device, "release_control"):
        raise HTTPException(status_code=400, detail="Az eszköz nem támogat ownership lockot")

    if hasattr(device, "send_realtime_command"):
        try:
            capabilities = await device.get_capabilities()
            supports_panel_controller = bool(
                getattr(capabilities, "supports_panel_controller", False)
            )
            if supports_panel_controller:
                sent = await device.send_realtime_command(RT_OWN_RELEASE)
                await device.send_realtime_command(RT_OWN_QUERY)
                control = await sync_control_from_firmware(
                    device,
                    changed_by=(request.requested_by if request else None)
                    or "api_release_rt",
                )
                if control is None and hasattr(device, "get_control_state"):
                    control = device.get_control_state()
                if control is None:
                    control = {}
                granted = bool(
                    sent and str(control.get("owner", "none")).lower() == "none"
                )
                result = {
                    "granted": granted,
                    "reason": None if granted else str(control.get("reason") or "denied"),
                    "state": control,
                }
                await device_manager._broadcast_control_state(device_id, control)
                return result
        except Exception as exc:
            logger.error(f"⚠️ Firmware ownership release hiba ({device_id}): {exc}")

    result = device.release_control(
        requested_by=(request.requested_by if request else None) or "api_release"
    )
    control = result.get("state", {})
    await device_manager._broadcast_control_state(device_id, control)
    return result
