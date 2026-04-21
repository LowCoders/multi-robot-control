"""Robotkar / GRBL eszköz-specifikus endpointok.

Tartalmaz robotkar-only API-kat (gripper, sucker, calibrate, teach,
home-position) és a több driverre is érvényes konfig-műveleteket
(soft-limits, reload-config, save-calibration). Ennek a fájlnak a
"robot" elnevezése a tervből származó konvenciót követi.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

import yaml
from fastapi import APIRouter, HTTPException

try:
    from log_config import get_logger
    from control_lock_decorator import ControlLockDecorator
    from robot_arm_driver import RobotArmDevice
    from api_models import (
        CalibrateLimitsRequest,
        SaveCalibrationRequest,
        SetHomePositionRequest,
    )
except ImportError:
    from ...log_config import get_logger
    from ...control_lock_decorator import ControlLockDecorator
    from ...robot_arm_driver import RobotArmDevice
    from ...api_models import (
        CalibrateLimitsRequest,
        SaveCalibrationRequest,
        SetHomePositionRequest,
    )

from ..helpers import (
    MACHINE_CONFIG_DIR,
    extract_driver_config,
    load_machine_config,
)
from ..state import device_manager

logger = get_logger(__name__)
router = APIRouter()


def _get_device_or_404(device_id: str):
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    return device


def _device_core(device: Any) -> Any:
    """Decorator wrapper kibontása type-check-hez."""
    if isinstance(device, ControlLockDecorator):
        return device._inner
    return device


# ----------------------------------------------------------------------
# Gripper / sucker / enable / calibrate
# ----------------------------------------------------------------------


@router.post("/devices/{device_id}/gripper/on")
async def gripper_on(device_id: str):
    """Megfogó bezárása."""
    device = _get_device_or_404(device_id)
    result = await device.gripper_on()
    return {"success": result}


@router.post("/devices/{device_id}/gripper/off")
async def gripper_off(device_id: str):
    """Megfogó nyitása."""
    device = _get_device_or_404(device_id)
    result = await device.gripper_off()
    return {"success": result}


@router.post("/devices/{device_id}/sucker/on")
async def sucker_on(device_id: str):
    """Szívó bekapcsolása."""
    device = _get_device_or_404(device_id)
    result = await device.sucker_on()
    return {"success": result}


@router.post("/devices/{device_id}/sucker/off")
async def sucker_off(device_id: str):
    """Szívó kikapcsolása."""
    device = _get_device_or_404(device_id)
    result = await device.sucker_off()
    return {"success": result}


@router.post("/devices/{device_id}/enable")
async def robot_enable(device_id: str):
    """Robot engedélyezése."""
    device = _get_device_or_404(device_id)
    result = await device.enable()
    return {"success": result}


@router.post("/devices/{device_id}/disable")
async def robot_disable(device_id: str):
    """Robot letiltása."""
    device = _get_device_or_404(device_id)
    result = await device.disable()
    return {"success": result}


@router.post("/devices/{device_id}/calibrate")
async def robot_calibrate(device_id: str):
    """Robot kalibráció."""
    device = _get_device_or_404(device_id)
    result = await device.calibrate()
    return {"success": result}


@router.post("/devices/{device_id}/calibrate-limits")
async def calibrate_limits(device_id: str, request: CalibrateLimitsRequest = None):
    """Automatikus végállás kalibráció stall detection-nel.

    Csak closed loop (SERVO42C) eszközökkel működik megfelelően.
    """
    device = _get_device_or_404(device_id)

    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")

    if not hasattr(device, "calibrate_limits"):
        raise HTTPException(
            status_code=400,
            detail="Ez az eszköz nem támogatja az automatikus kalibrációt",
        )

    if request is None:
        request = CalibrateLimitsRequest()

    result = await device.calibrate_limits(
        speed=request.speed,
        joints=request.joints,
        stall_timeout=request.stall_timeout,
        stall_tolerance=request.stall_tolerance,
    )
    return result


@router.get("/devices/{device_id}/calibration-status")
async def get_calibration_status(device_id: str):
    """Kalibráció állapot lekérdezése (progress, lépés, eredmények)."""
    device = _get_device_or_404(device_id)

    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")

    if not hasattr(device, "get_calibration_status"):
        return {"running": False, "message": "Nem támogatott"}

    return device.get_calibration_status()


@router.post("/devices/{device_id}/calibration-stop")
async def stop_calibration(device_id: str):
    """Futó kalibráció leállítása."""
    device = _get_device_or_404(device_id)

    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")

    if hasattr(device, "stop_calibration"):
        device.stop_calibration()

    return {"success": True}


@router.post("/devices/{device_id}/save-calibration")
async def save_calibration(device_id: str, request: SaveCalibrationRequest):
    """Kalibrációs eredmények mentése a devices.yaml fájlba."""
    config_path = Path(__file__).parent.parent.parent.parent / "config" / "devices.yaml"

    if not config_path.exists():
        raise HTTPException(status_code=404, detail="devices.yaml nem található")

    try:
        with open(config_path, "r") as f:
            config_data = yaml.safe_load(f)

        device_found = False
        for device_cfg in config_data.get("devices", []):
            if device_cfg.get("id") == device_id:
                device_found = True
                if "config" not in device_cfg:
                    device_cfg["config"] = {}
                if "axis_limits" not in device_cfg["config"]:
                    device_cfg["config"]["axis_limits"] = {}

                axis_limits = device_cfg["config"]["axis_limits"]

                if request.j1_limits and len(request.j1_limits) == 2:
                    axis_limits["Z"] = request.j1_limits
                if request.j2_limits and len(request.j2_limits) == 2:
                    axis_limits["X"] = request.j2_limits
                if request.j3_limits and len(request.j3_limits) == 2:
                    axis_limits["Y"] = request.j3_limits

                break

        if not device_found:
            raise HTTPException(
                status_code=404, detail=f"Eszköz nem található: {device_id}"
            )

        with open(config_path, "w") as f:
            yaml.dump(
                config_data,
                f,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
            )

        return {"success": True, "message": "Kalibráció mentve a devices.yaml-ba"}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Mentés hiba: {str(exc)}")


# ----------------------------------------------------------------------
# Home position
# ----------------------------------------------------------------------


@router.get("/devices/{device_id}/home-position")
async def get_home_position(device_id: str):
    """Home pozíció konfiguráció lekérdezése a machine-config.json-ból."""
    device = _get_device_or_404(device_id)

    if not isinstance(device, RobotArmDevice):
        raise HTTPException(
            status_code=400, detail="Csak robotkar eszközök támogatják a home pozíciót"
        )

    machine_config = load_machine_config(device_id)
    if machine_config and "driverConfig" in machine_config:
        hp = machine_config["driverConfig"].get("homePosition", {})
        positions = hp.get("positions", {})
        return {
            "mode": hp.get("mode", "absolute"),
            "X": positions.get("X", 0.0),
            "Y": positions.get("Y", 0.0),
            "Z": positions.get("Z", 0.0),
        }

    return device.get_home_position_config()


@router.post("/devices/{device_id}/home-position")
async def set_home_position(device_id: str, request: SetHomePositionRequest):
    """Home pozíció beállítása és mentése a machine-config.json fájlba.

    Ha save_current=true, az aktuális pozíciót menti home pozícióként.
    """
    device = _get_device_or_404(device_id)

    if not isinstance(device, RobotArmDevice):
        raise HTTPException(
            status_code=400, detail="Csak robotkar eszközök támogatják a home pozíciót"
        )

    config_path = MACHINE_CONFIG_DIR / f"{device_id}.json"

    if not config_path.exists():
        raise HTTPException(
            status_code=404, detail=f"Machine config nem található: {device_id}"
        )

    try:
        if request.save_current:
            status = await device.get_status()
            pos = status.position
            x_val = pos.x
            y_val = pos.y
            z_val = pos.z
        else:
            x_val = request.X if request.X is not None else 0.0
            y_val = request.Y if request.Y is not None else 0.0
            z_val = request.Z if request.Z is not None else 0.0

        new_config = {
            "mode": request.mode,
            "X": x_val,
            "Y": y_val,
            "Z": z_val,
        }
        device.set_home_position_config(new_config)

        with open(config_path, "r", encoding="utf-8") as f:
            config_data = json.load(f)

        if "driverConfig" not in config_data:
            config_data["driverConfig"] = {}

        config_data["driverConfig"]["homePosition"] = {
            "mode": request.mode,
            "positions": {"X": x_val, "Y": y_val, "Z": z_val},
        }

        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)

        return {
            "success": True,
            "message": "Home pozíció mentve",
            "home_position": new_config,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Mentés hiba: {str(exc)}")


# ----------------------------------------------------------------------
# Soft-limits / reload-config
# ----------------------------------------------------------------------


@router.post("/devices/{device_id}/soft-limits")
async def set_soft_limits(device_id: str, enabled: bool):
    """Szoftveres limitek be/kikapcsolása."""
    device = _get_device_or_404(device_id)
    core = _device_core(device)

    if hasattr(core, "set_soft_limits_enabled") and hasattr(core, "get_soft_limits_enabled"):
        core.set_soft_limits_enabled(enabled)
        return {"success": True, "soft_limits_enabled": enabled}

    if hasattr(device, "get_grbl_settings") and hasattr(device, "set_grbl_setting"):
        settings = await device.get_grbl_settings()
        if enabled and int(round(settings.get(22, 0))) == 0:
            raise HTTPException(
                status_code=400,
                detail="Soft limits csak homing engedélyezése után kapcsolható be ($22=1 szükséges).",
            )

        ok = await device.set_grbl_setting(20, 1 if enabled else 0)
        if not ok:
            raise HTTPException(
                status_code=500,
                detail="GRBL $20 beállítás sikertelen (ellenőrizd Alarm/E-Stop állapotot)",
            )

        settings = await device.get_grbl_settings()
        value = settings.get(20, 1 if enabled else 0)
        return {"success": True, "soft_limits_enabled": bool(int(round(value)))}

    raise HTTPException(status_code=400, detail="Az eszköz nem támogatja a szoftveres limiteket")


@router.get("/devices/{device_id}/soft-limits")
async def get_soft_limits(device_id: str):
    """Szoftveres limitek állapotának lekérdezése."""
    device = _get_device_or_404(device_id)
    core = _device_core(device)

    if hasattr(core, "get_soft_limits_enabled"):
        return {"soft_limits_enabled": core.get_soft_limits_enabled()}

    if hasattr(device, "get_grbl_settings"):
        settings = await device.get_grbl_settings()
        value = settings.get(20)
        if value is None:
            cached = getattr(core, "_grbl_settings", None)
            if cached is not None:
                value = 1.0 if cached.soft_limits else 0.0
        if value is None:
            value = 0.0
        return {"soft_limits_enabled": bool(int(round(value)))}

    raise HTTPException(status_code=400, detail="Az eszköz nem támogatja a szoftveres limiteket")


@router.post("/devices/{device_id}/reload-config")
async def reload_device_config(device_id: str):
    """Konfiguráció újratöltése a machine-config.json fájlból."""
    device = _get_device_or_404(device_id)

    machine_config = load_machine_config(device_id)
    if not machine_config:
        raise HTTPException(
            status_code=404, detail=f"Machine config nem található: {device_id}"
        )

    driver_cfg = extract_driver_config(machine_config)

    reload_info: Dict[str, Any] = {}
    if isinstance(device, RobotArmDevice):
        device.update_driver_config(
            axis_invert=driver_cfg.get("axis_invert"),
            axis_scale=driver_cfg.get("axis_scale"),
            axis_limits=driver_cfg.get("axis_limits"),
            max_feed_rate=driver_cfg.get("max_feed_rate"),
            dynamic_limits=driver_cfg.get("dynamic_limits"),
        )
    elif hasattr(device, "reload_machine_config"):
        reload_info = device.reload_machine_config(driver_cfg)
    else:
        raise HTTPException(
            status_code=400, detail="Ez az eszköz nem támogatja a config reload-ot"
        )

    logger.info(f"🔄 Konfiguráció újratöltve: {device_id}")

    return {
        "success": True,
        "message": "Konfiguráció újratöltve",
        "config": {
            "axis_invert": driver_cfg.get("axis_invert"),
            "axis_scale": driver_cfg.get("axis_scale"),
            "axis_limits": driver_cfg.get("axis_limits"),
            "max_feed_rate": driver_cfg.get("max_feed_rate"),
            "dynamic_limits": driver_cfg.get("dynamic_limits"),
            "supports_panel_controller": driver_cfg.get("supports_panel_controller"),
            "reload_info": reload_info,
        },
    }


# ----------------------------------------------------------------------
# Teach (csak robotkar)
# ----------------------------------------------------------------------


@router.post("/devices/{device_id}/teach/record")
async def teach_record(device_id: str):
    """Pozíció rögzítése teaching módhoz."""
    device = _get_device_or_404(device_id)
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    pos = await device.teach_record_position()
    return {"success": True, "position": pos}


@router.post("/devices/{device_id}/teach/play")
async def teach_play(device_id: str):
    """Tanított pozíciók lejátszása."""
    device = _get_device_or_404(device_id)
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    result = await device.teach_play()
    return {"success": result}


@router.post("/devices/{device_id}/teach/clear")
async def teach_clear(device_id: str):
    """Tanított pozíciók törlése."""
    device = _get_device_or_404(device_id)
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    device.teach_clear()
    return {"success": True}


@router.get("/devices/{device_id}/teach/positions")
async def teach_positions(device_id: str):
    """Tanított pozíciók lekérdezése."""
    device = _get_device_or_404(device_id)
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    positions = device.teach_get_positions()
    return {"positions": positions}
