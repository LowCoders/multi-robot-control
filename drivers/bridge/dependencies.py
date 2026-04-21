"""FastAPI dependencies a bridge router-ekhez.

Egységesíti a `device = device_manager.get_device(device_id); if not device: 404`
mintát egy `Depends(get_device_or_404)` függvénybe, így a route-handler-ek
közvetlenül megkapják a `DeviceDriver` instance-t.

Használat:

    from fastapi import Depends
    from ..dependencies import get_device_or_404

    @router.get("/devices/{device_id}/status")
    async def status(device = Depends(get_device_or_404)):
        return (await device.get_status()).to_dict()

A path param neve **kötelezően** `device_id`, így minden router ugyanazt a
nevet használja (single source of truth).
"""

from __future__ import annotations

from typing import Annotated, Tuple

from fastapi import Depends, HTTPException, Path

from .state import device_manager

try:
    from base import DeviceDriver
    from robot_arm_driver import RobotArmDevice
except ImportError:
    from ..base import DeviceDriver  # type: ignore[no-redef]
    from ..robot_arm_driver import RobotArmDevice  # type: ignore[no-redef]


def get_device_or_404(
    device_id: str = Path(..., description="Eszköz azonosító"),
) -> DeviceDriver:
    """Visszaadja az adott `device_id`-jú DeviceDriver-t, vagy 404-et dob."""
    device = device_manager.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    return device


DeviceDriverDep = Annotated[DeviceDriver, Depends(get_device_or_404)]


def get_robot_arm_or_400(
    device_id: str = Path(..., description="Eszköz azonosító"),
) -> Tuple[RobotArmDevice, object]:
    """Visszaadja a (RobotArmDevice, metadata) párost, vagy 4xx-et dob.

    A diagnosztika / motion-test / endstop-test endpointok mind ezt a párost
    igénylik. A `kind` szöveges címkét a hibaüzenethez régen a hívó adta meg;
    az új, közös formátum elég egyértelmű, hogy ne legyen szükség paraméterre.
    """
    device = device_manager.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(
            status_code=400,
            detail="Ez a végpont csak robotkar eszközökhöz érhető el.",
        )
    metadata = device_manager.device_metadata.get(device_id)
    return device, metadata


# Re-export, hogy a régi import-mintát ne kelljen mindenhol váltani
__all__ = ["get_device_or_404", "get_robot_arm_or_400", "DeviceDriverDep", "Depends"]
