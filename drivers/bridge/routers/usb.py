"""USB diagnosztika endpointok."""

from __future__ import annotations

from fastapi import APIRouter

try:
    from usb_port_resolver import list_usb_devices
except ImportError:
    from ..usb_port_resolver import list_usb_devices

router = APIRouter()


@router.get("/usb/devices")
async def get_usb_devices():
    """USB-serial eszközök listázása.

    Diagnosztikai endpoint az USB azonosítók (VID, PID, serial_number,
    location) megjelenítésére a devices.yaml konfigurációhoz.
    """
    devices = list_usb_devices()
    return {
        "devices": devices,
        "count": len(devices),
        "hint": "Használd ezeket az értékeket a devices.yaml 'usb' szekciójában",
    }
