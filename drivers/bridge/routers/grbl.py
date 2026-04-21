"""GRBL beállítások endpointjai ($N=value, $$, batch)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

try:
    from api_models import GrblSettingRequest, GrblSettingsBatchRequest
except ImportError:
    from ...api_models import GrblSettingRequest, GrblSettingsBatchRequest

from ..state import device_manager

router = APIRouter()


@router.get("/devices/{device_id}/grbl-settings")
async def get_grbl_settings(device_id: str):
    """GRBL beállítások lekérdezése ($$)."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if not hasattr(device, "get_grbl_settings"):
        raise HTTPException(status_code=400, detail="Device does not support GRBL settings")

    try:
        settings = await device.get_grbl_settings()
        return {"settings": settings}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/devices/{device_id}/grbl-settings")
async def set_grbl_setting(device_id: str, request: GrblSettingRequest):
    """GRBL beállítás módosítása ($N=value)."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if not hasattr(device, "set_grbl_setting"):
        raise HTTPException(status_code=400, detail="Device does not support GRBL settings")

    try:
        success = await device.set_grbl_setting(request.setting, request.value)
        if success:
            return {"success": True, "message": f"${request.setting}={request.value} beállítva"}
        raise HTTPException(status_code=500, detail="Beállítás sikertelen")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/devices/{device_id}/grbl-settings/batch")
async def set_grbl_settings_batch(device_id: str, request: GrblSettingsBatchRequest):
    """Több GRBL beállítás módosítása egyszerre."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if not hasattr(device, "set_grbl_setting"):
        raise HTTPException(status_code=400, detail="Device does not support GRBL settings")

    results = {}
    try:
        for setting, value in request.settings.items():
            success = await device.set_grbl_setting(int(setting), value)
            results[setting] = {"success": success, "value": value}

        all_success = all(r["success"] for r in results.values())
        return {
            "success": all_success,
            "results": results,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
