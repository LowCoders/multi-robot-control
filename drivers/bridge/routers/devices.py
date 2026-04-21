"""Eszközlista, alapinfó, status, capabilities — CRUD szintű devices végpontok."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

try:
    from api_models import DeviceConfig
except ImportError:
    from ...api_models import DeviceConfig

from ..state import device_manager

router = APIRouter()


@router.get("/devices")
async def list_devices():
    """Összes eszköz listázása."""
    devices = []
    for device_id, device in device_manager.devices.items():
        metadata = device_manager.device_metadata.get(device_id)
        control = device_manager.get_control_state(device_id)
        devices.append(
            {
                "id": device_id,
                "name": device.device_name,
                "type": device.device_type.value,
                "connected": device.is_connected,
                "state": device.state.value,
                "simulated": metadata.simulated if metadata else True,
                "connectionInfo": metadata.connection_info if metadata else "",
                "lastError": metadata.last_error if metadata else None,
                "control": control,
            }
        )
    return {"devices": devices}


@router.post("/devices")
async def add_device(config: DeviceConfig):
    """Új eszköz hozzáadása."""
    if device_manager.get_device(config.id):
        raise HTTPException(status_code=400, detail="Eszköz már létezik ezzel az ID-val")

    success = await device_manager.add_device(config)

    if success:
        device = device_manager.get_device(config.id)
        if device:
            await device.connect()

        return {
            "success": True,
            "message": "Eszköz sikeresen hozzáadva és csatlakoztatva",
        }

    raise HTTPException(status_code=500, detail="Nem sikerült hozzáadni az eszközt")


@router.get("/devices/{device_id}")
async def get_device(device_id: str):
    """Eszköz részletek."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")

    return device.get_info()


@router.get("/devices/{device_id}/status")
async def get_device_status(device_id: str):
    """Eszköz állapot lekérdezése."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")

    status = await device.get_status()
    return status.to_dict()


@router.get("/devices/{device_id}/capabilities")
async def get_device_capabilities(device_id: str):
    """Eszköz képességek lekérdezése."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")

    capabilities = await device.get_capabilities()
    return capabilities.to_dict()
