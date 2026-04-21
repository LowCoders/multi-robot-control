"""
Bridge segédfüggvények.

Két csoport:
  - Machine config betöltés / driver-config kinyerés
    (`load_machine_config`, `extract_driver_config`)
  - Firmware ownership szinkron + auto host-claim
    (`_sync_control_from_firmware`, `_auto_claim_host_if_supported`)

Ezeket több router (control, connect, devices) is használja, ezért
külön modulba kerültek a körkörös import elkerülésére.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from log_config import get_logger
except ImportError:
    from ..log_config import get_logger

logger = get_logger(__name__)

# Realtime command bytes (firmware-szintű ownership protokoll). Itt élnek
# (és nem `state.py`-ben), hogy a manager / helpers / routerek tetszőleges
# sorrendben importálhatók legyenek anélkül, hogy körkörös imports lenne.
RT_OWN_CLAIM_HOST = 0x8D
RT_OWN_REQUEST_PANEL = 0x8E
RT_OWN_RELEASE = 0x8F
RT_OWN_QUERY = 0xA5

MACHINE_CONFIG_DIR = Path(__file__).parent.parent.parent / "config" / "machines"


def load_machine_config(device_id: str) -> Optional[Dict[str, Any]]:
    """
    Betölti az eszköz machine-config.json fájlját.
    A driver-specifikus beállítások (axis limits, closed_loop, home_position)
    ebből a fájlból jönnek.
    """
    config_path = MACHINE_CONFIG_DIR / f"{device_id}.json"
    if not config_path.exists():
        return None

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        logger.warning(
            f"⚠️ Nem sikerült betölteni a machine config-ot: {device_id}: {exc}"
        )
        return None


def extract_driver_config(machine_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Kinyeri a driver-specifikus beállításokat a machine config-ból.
    Átalakítja a frontend formátumot a driver formátumra.
    """
    driver_cfg = machine_config.get("driverConfig", {})
    axes = machine_config.get("axes", [])

    axis_limits: Dict[str, Any] = {}
    axis_invert: Dict[str, Any] = {}
    axis_scale: Dict[str, Any] = {}
    dynamic_limits: Dict[str, Any] = {}

    for axis in axes:
        axis_name = axis.get("name", "").upper()

        axis_min = axis.get("min")
        axis_max = axis.get("max")
        if axis_min is not None and axis_max is not None:
            axis_limits[axis_name] = [axis_min, axis_max]

        if axis.get("invert", False):
            axis_invert[axis_name] = True

        if "scale" in axis and axis["scale"] != 1.0:
            axis_scale[axis_name] = axis["scale"]

        dyn_lim = axis.get("dynamicLimits")
        if dyn_lim and dyn_lim.get("dependsOn"):
            dynamic_limits[axis_name] = {
                "dependsOn": dyn_lim.get("dependsOn", "").upper(),
                "formula": dyn_lim.get("formula", "linear_offset"),
                "factor": dyn_lim.get("factor", 0.9),
            }

    home_position: Optional[Dict[str, Any]] = None
    hp = driver_cfg.get("homePosition")
    if hp:
        home_position = {"mode": hp.get("mode", "absolute")}
        positions = hp.get("positions", {})
        for axis_key, value in positions.items():
            home_position[axis_key.upper()] = value

    closed_loop: Optional[Dict[str, Any]] = None
    cl = driver_cfg.get("closedLoop")
    if cl and cl.get("enabled"):
        stall = cl.get("stallDetection", {})
        closed_loop = {
            "enabled": True,
            "driver_type": cl.get("driverType", "servo"),
            "stall_detection": {
                "timeout": stall.get("timeout", 0.3),
                "tolerance": stall.get("tolerance", 0.5),
                "speed": stall.get("speed", 150),
                "max_search_angle": stall.get("maxSearchAngle", 400),
                "calibrate_joints": stall.get("calibrateJoints", ["Y", "Z"]),
            },
        }

    robot_config: Optional[Dict[str, Any]] = None
    ra = machine_config.get("robotArm", {})
    if ra:
        robot_config = {
            "L1": ra.get("baseHeight", 85),
            "L2": ra.get("lowerArmLength", 140),
            "L3": ra.get("upperArmLength", 165),
        }

    return {
        "axis_limits": axis_limits if axis_limits else {},
        "axis_invert": axis_invert,
        "axis_scale": axis_scale,
        "dynamic_limits": dynamic_limits,
        "home_position": home_position,
        "closed_loop": closed_loop,
        "robot_config": robot_config,
        "max_feed_rate": driver_cfg.get("maxFeedRate"),
        "supports_panel_controller": bool(driver_cfg.get("supportsPanelController", False)),
        "protocol": driver_cfg.get("protocol"),
        "grbl_settings": driver_cfg.get("grblSettings"),
    }


async def sync_control_from_firmware(
    device: Any, changed_by: str
) -> Optional[Dict[str, Any]]:
    """
    Refresh decorator control state from firmware ownership fields.
    Returns control dict if sync is possible, otherwise None.
    """
    if not hasattr(device, "sync_firmware_owner"):
        return None

    try:
        await device.get_status()
    except Exception:
        pass

    owner_getter = getattr(device, "get_control_owner", None)
    reason_getter = getattr(device, "get_control_owner_reason", None)
    version_getter = getattr(device, "get_control_owner_version", None)
    if callable(owner_getter):
        owner = owner_getter() or "none"
        reason = reason_getter() if callable(reason_getter) else None
        version = version_getter() if callable(version_getter) else None
        return device.sync_firmware_owner(
            owner=owner,
            reason=reason,
            version=version,
            changed_by=changed_by,
        )

    state_getter = getattr(device, "get_control_state", None)
    if callable(state_getter):
        try:
            control = state_getter() or {}
            if control:
                return control
        except Exception:
            pass

    return None


async def auto_claim_host_if_supported(
    device_id: str,
    device: Any,
    changed_by: str,
    retries: int = 1,
) -> Dict[str, Any]:
    """Attempt host ownership claim with a small retry budget."""
    result: Dict[str, Any] = {
        "attempted": False,
        "supported": False,
        "sent": False,
        "granted": False,
        "reason": None,
        "state": {},
    }

    if not hasattr(device, "send_realtime_command"):
        return result

    capabilities = await device.get_capabilities()
    supports_panel_controller = bool(
        getattr(capabilities, "supports_panel_controller", False)
    )
    result["supported"] = supports_panel_controller
    if not supports_panel_controller:
        return result

    result["attempted"] = True

    current_owner = getattr(device, "_control_owner", "none")
    if current_owner == "panel":
        result["reason"] = "panel_active"
        return result

    for _ in range(max(0, retries) + 1):
        sent = bool(await device.send_realtime_command(RT_OWN_CLAIM_HOST))
        await device.send_realtime_command(RT_OWN_QUERY)
        control = await sync_control_from_firmware(device, changed_by=changed_by) or {}
        owner = str(control.get("owner", "none")).lower()
        lock_state = str(control.get("lock_state", "")).lower()
        reason = str(control.get("reason") or "") or None
        granted = bool(sent and owner == "host" and lock_state == "granted")
        result.update(
            {
                "sent": sent,
                "granted": granted,
                "reason": reason,
                "state": control,
            }
        )
        if sent and not granted and not reason:
            result["reason"] = "firmware_no_ownership_ack"
        if granted or reason == "command_running":
            break
        await asyncio.sleep(0.15)

    return result
