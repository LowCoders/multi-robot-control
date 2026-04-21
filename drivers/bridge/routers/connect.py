"""Connect / disconnect / reconnect endpointok."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException

try:
    from log_config import get_logger
    from robot_arm_driver import RobotArmDevice
except ImportError:
    from ...log_config import get_logger
    from ...robot_arm_driver import RobotArmDevice

from ..dependencies import DeviceDriverDep
from ..helpers import auto_claim_host_if_supported
from ..manager import CONNECT_TIMEOUT_SECONDS
from ..state import device_manager

logger = get_logger(__name__)
router = APIRouter()


@router.post("/devices/{device_id}/connect")
async def connect_device(device_id: str, device: DeviceDriverDep):
    """Csatlakozás az eszközhöz."""
    try:
        device_port = getattr(device, "port", "n/a")
        logger.info(f"[CONNECT_API:{device_id}] begin port={device_port}")
        result = await asyncio.wait_for(
            device.connect(),
            timeout=CONNECT_TIMEOUT_SECONDS,
        )
        logger.info(f"[CONNECT_API:{device_id}] result connected={result}")
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail=(
                f"Eszköz csatlakozási timeout: {device_id} "
                f"({CONNECT_TIMEOUT_SECONDS:.1f}s)"
            ),
        ) from exc

    claim_sent = False
    claim_granted = False
    claim_reason = None
    if result and hasattr(device, "send_realtime_command"):
        try:
            claim = await auto_claim_host_if_supported(
                device_id=device_id,
                device=device,
                changed_by="bridge_connect_claim",
                retries=1,
            )
            claim_sent = bool(claim.get("sent"))
            claim_granted = bool(claim.get("granted"))
            claim_reason = claim.get("reason")
            control = claim.get("state") or {}
            if claim.get("attempted") and control:
                if claim_granted:
                    await device_manager._broadcast_control_state(device_id, control)
                else:
                    await device_manager._broadcast_control_denied(
                        device_id,
                        str(claim_reason or "denied"),
                        control,
                    )
        except Exception as exc:
            logger.error(f"⚠️ Ownership claim küldési hiba ({device_id}): {exc}")
    return {
        "success": result,
        "ownership_claim_sent": claim_sent,
        "ownership_claim_granted": claim_granted,
        "ownership_claim_reason": claim_reason,
    }


@router.post("/devices/{device_id}/disconnect")
async def disconnect_device(device: DeviceDriverDep):
    """Lecsatlakozás az eszközről."""
    await device.disconnect()
    return {"success": True}


@router.post("/devices/{device_id}/reconnect")
async def reconnect_device(device_id: str, device: DeviceDriverDep):
    """Újracsatlakozás az eszközhöz (USB disconnect/reconnect után)."""
    if isinstance(device, RobotArmDevice):
        result = await device.reconnect()
    else:
        await device.disconnect()
        try:
            result = await asyncio.wait_for(
                device.connect(),
                timeout=CONNECT_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            raise HTTPException(
                status_code=504,
                detail=(
                    f"Eszköz újracsatlakozási timeout: {device_id} "
                    f"({CONNECT_TIMEOUT_SECONDS:.1f}s)"
                ),
            ) from exc

    claim_sent = False
    claim_granted = False
    claim_reason = None
    if result:
        try:
            claim = await auto_claim_host_if_supported(
                device_id=device_id,
                device=device,
                changed_by="bridge_reconnect_claim",
                retries=1,
            )
            claim_sent = bool(claim.get("sent"))
            claim_granted = bool(claim.get("granted"))
            claim_reason = claim.get("reason")
            control = claim.get("state") or {}
            if claim.get("attempted") and control:
                if claim_granted:
                    await device_manager._broadcast_control_state(device_id, control)
                else:
                    await device_manager._broadcast_control_denied(
                        device_id,
                        str(claim_reason or "denied"),
                        control,
                    )
        except Exception as exc:
            logger.error(f"⚠️ Reconnect ownership claim hiba ({device_id}): {exc}")

    return {
        "success": result,
        "ownership_claim_sent": claim_sent,
        "ownership_claim_granted": claim_granted,
        "ownership_claim_reason": claim_reason,
    }
