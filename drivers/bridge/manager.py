"""
DeviceManager — eszközök életciklusa, metaadatok és WS broadcast.

A bridge_server.py-ből áthozott osztály. A globális `device_manager`
singleton a `bridge.state` modulban található; körkörös import elkerülésére
ez a fájl semmit sem importál a `state`-ből.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, Dict, List, Optional

import yaml
from fastapi import WebSocket

try:
    from base import DeviceDriver, DeviceState, Position
    from grbl_driver import GrblDevice
    from linuxcnc_driver import LinuxCNCDevice
    from robot_arm_driver import RobotArmDevice
    from simulated_device import SimulatedDevice, SimulationMode
    from control_lock_decorator import ControlLockDecorator
    from usb_port_resolver import UsbIdentifier, resolve_port
    from log_config import get_logger
    from base import DeviceType
except ImportError:
    from ..base import DeviceDriver, DeviceState, Position, DeviceType
    from ..grbl_driver import GrblDevice
    from ..linuxcnc_driver import LinuxCNCDevice
    from ..robot_arm_driver import RobotArmDevice
    from ..simulated_device import SimulatedDevice, SimulationMode
    from ..control_lock_decorator import ControlLockDecorator
    from ..usb_port_resolver import UsbIdentifier, resolve_port
    from ..log_config import get_logger

try:
    from api_models import DeviceConfig
except ImportError:
    from ..api_models import DeviceConfig

from .helpers import (
    auto_claim_host_if_supported,
    extract_driver_config,
    load_machine_config,
)

logger = get_logger(__name__)

CONNECT_TIMEOUT_SECONDS = float(os.environ.get("DEVICE_CONNECT_TIMEOUT_SECONDS", "8.0"))
STARTUP_CONNECT_TIMEOUT_SECONDS = float(
    os.environ.get("DEVICE_STARTUP_CONNECT_TIMEOUT_SECONDS", "15.0")
)


class DeviceMetadata:
    """Eszköz metaadatok tárolása."""

    def __init__(self, simulated: bool, connection_info: str = ""):
        self.simulated = simulated
        self.connection_info = connection_info
        self.last_error: Optional[str] = None


class DeviceManager:
    """Eszközök kezelése: életciklus, WS broadcast, metaadatok."""

    def __init__(self) -> None:
        self.devices: Dict[str, DeviceDriver] = {}
        self.device_metadata: Dict[str, DeviceMetadata] = {}
        self._ws_clients: List[WebSocket] = []

    # ------------------------------------------------------------------
    # Konfig betöltés / eszköz hozzáadás
    # ------------------------------------------------------------------

    async def load_config(self, config_path: str) -> None:
        """Konfiguráció betöltése YAML fájlból."""
        if not os.path.exists(config_path):
            logger.info(f"Konfiguráció nem található: {config_path}")
            return

        with open(config_path, "r") as f:
            config = yaml.safe_load(f)

        devices_config = config.get("devices", [])

        for device_conf in devices_config:
            if not device_conf.get("enabled", True):
                continue
            await self.add_device(DeviceConfig(**device_conf))

    async def add_device(self, config: DeviceConfig) -> bool:
        """Új eszköz hozzáadása."""
        try:
            driver = config.driver.lower()
            device: Optional[DeviceDriver] = None
            connection_info = ""

            use_simulation = driver == "simulated" or config.simulated

            if use_simulation:
                device_type = DeviceType.CNC_MILL
                if config.type == "laser_cutter":
                    device_type = DeviceType.LASER_CUTTER
                elif config.type == "cnc_lathe":
                    device_type = DeviceType.CNC_LATHE
                elif config.type == "3d_printer":
                    device_type = DeviceType.PRINTER_3D
                elif config.type == "robot_arm":
                    device_type = DeviceType.ROBOT_ARM

                device = SimulatedDevice(
                    device_id=config.id,
                    name=config.name,
                    device_type=device_type,
                    simulation_mode=SimulationMode.NORMAL,
                    max_x=config.config.get("max_x", 300.0),
                    max_y=config.config.get("max_y", 200.0),
                    max_z=config.config.get("max_z", 100.0),
                )
                connection_info = "Szimulált"
                logger.info(f"🎮 Szimulált eszköz: {config.name}")
            elif driver == "grbl":
                port = self._resolve_device_port(config)
                if port is None:
                    logger.warning(f"⚠️ Port nem található: {config.name}")
                    return False
                device = GrblDevice(
                    device_id=config.id,
                    device_name=config.name,
                    port=port,
                    baudrate=config.config.get("baudrate", 115200),
                    max_feed_rate=config.config.get("max_feed_rate"),
                )
                connection_info = port
                logger.info(f"🔌 Valós GRBL eszköz: {config.name} ({port})")
            elif driver == "linuxcnc":
                ini_file = config.config.get("ini_file")
                device = LinuxCNCDevice(
                    device_id=config.id,
                    device_name=config.name,
                    ini_file=ini_file,
                )
                connection_info = ini_file or "LinuxCNC"
                logger.info(f"🔌 Valós LinuxCNC eszköz: {config.name}")
            elif driver == "robot_arm":
                port = self._resolve_device_port(config)
                if port is None:
                    logger.warning(f"⚠️ Port nem található: {config.name}")
                    return False

                machine_config = load_machine_config(config.id)
                driver_cfg: Dict[str, Any] = {}

                if machine_config:
                    driver_cfg = extract_driver_config(machine_config)
                    logger.info(f"   📋 Machine config betöltve: {config.id}")
                else:
                    logger.warning(
                        f"   ⚠️ Machine config nem található, devices.yaml használata: {config.id}"
                    )

                axis_limits = (
                    driver_cfg.get("axis_limits")
                    if driver_cfg.get("axis_limits") is not None
                    else config.config.get("axis_limits")
                )
                axis_invert = (
                    driver_cfg.get("axis_invert")
                    if driver_cfg.get("axis_invert") is not None
                    else config.config.get("axis_invert")
                )
                axis_scale = (
                    driver_cfg.get("axis_scale")
                    if driver_cfg.get("axis_scale") is not None
                    else config.config.get("axis_scale")
                )
                robot_config = driver_cfg.get("robot_config") or config.config.get("robot_config")
                max_feed_rate = driver_cfg.get("max_feed_rate") or config.config.get("max_feed_rate")
                closed_loop = driver_cfg.get("closed_loop") or config.config.get("closed_loop")
                home_position = driver_cfg.get("home_position") or config.config.get("home_position")

                device = RobotArmDevice(
                    device_id=config.id,
                    device_name=config.name,
                    port=port,
                    baudrate=config.config.get("baudrate", 115200),
                    robot_config=robot_config,
                    axis_invert=axis_invert,
                    axis_limits=axis_limits,
                    axis_scale=axis_scale,
                    max_feed_rate=max_feed_rate,
                    closed_loop=closed_loop,
                    home_position=home_position,
                )

                dynamic_limits = driver_cfg.get("dynamic_limits")
                if dynamic_limits:
                    device.update_driver_config(dynamic_limits=dynamic_limits)
                    for axis, cfg in dynamic_limits.items():
                        logger.info(
                            f"   📐 Dinamikus limit [{axis}]: függ {cfg.get('dependsOn')}-tól"
                        )

                connection_info = port
                closed_loop_info = " [Closed Loop]" if (closed_loop or {}).get("enabled") else ""
                home_info = (
                    f" [Home: {(home_position or {}).get('mode', 'absolute')}]"
                    if home_position
                    else ""
                )
                logger.info(
                    f"🤖 Valós robotkar eszköz: {config.name} ({port}){closed_loop_info}{home_info}"
                )
            elif driver == "tube_bender":
                port = self._resolve_device_port(config)
                if port is None:
                    logger.warning(f"⚠️ Port nem található: {config.name}")
                    return False

                machine_config = load_machine_config(config.id)
                driver_cfg = {}
                if machine_config:
                    driver_cfg = extract_driver_config(machine_config)
                    logger.info(f"   📋 Machine config betöltve: {config.id}")
                else:
                    logger.warning(
                        f"   ⚠️ Machine config nem található, devices.yaml használata: {config.id}"
                    )

                try:
                    from tube_bender_driver import TubeBenderDriver
                except ImportError:
                    from ..tube_bender_driver import TubeBenderDriver
                startup_grbl_settings = (
                    driver_cfg.get("grbl_settings")
                    or config.config.get("grbl_settings")
                    or {}
                )
                if isinstance(startup_grbl_settings, dict):
                    s1 = startup_grbl_settings.get("1", startup_grbl_settings.get(1))
                    s4 = startup_grbl_settings.get("4", startup_grbl_settings.get(4))
                    if s1 is not None or s4 is not None:
                        logger.info(
                            f"   ⚙️ TubeBender startup hold settings: $1={s1}, $4={s4}"
                        )
                device = TubeBenderDriver(
                    device_id=config.id,
                    device_name=config.name,
                    port=port,
                    baudrate=config.config.get("baudrate", 115200),
                    max_feed_rate=driver_cfg.get("max_feed_rate")
                    or config.config.get("max_feed_rate", 1000.0),
                    axis_limits=driver_cfg.get("axis_limits") or config.config.get("axis_limits"),
                    protocol=driver_cfg.get("protocol") or config.config.get("protocol", "grbl"),
                    grbl_settings=startup_grbl_settings,
                )
                supports_panel_controller = bool(
                    driver_cfg.get("supports_panel_controller")
                    if driver_cfg.get("supports_panel_controller") is not None
                    else config.config.get("supports_panel_controller", False)
                )
                device = ControlLockDecorator(
                    device,
                    supports_panel_controller=supports_panel_controller,
                )
                connection_info = port
                logger.info(
                    f"🔧 Csőhajlító eszköz: {config.name} ({port}) [GRBL adapter]"
                )
            else:
                logger.info(f"Ismeretlen driver: {driver}")
                return False

            if device is None:
                return False

            self.device_metadata[config.id] = DeviceMetadata(
                simulated=use_simulation,
                connection_info=connection_info,
            )

            self._wire_device_callbacks(config.id, device)

            self.devices[config.id] = device
            logger.info(f"Eszköz hozzáadva: {config.id} ({config.name})")
            return True

        except Exception as exc:
            logger.error(f"Eszköz hozzáadási hiba ({config.id}): {str(exc)}")
            return False

    def _wire_device_callbacks(self, device_id: str, device: DeviceDriver) -> None:
        """Közös callback-regisztráció minden driver-típushoz."""
        device.on_state_change = lambda old, new, d_id=device_id: asyncio.create_task(
            self._broadcast_state_change(d_id, old, new)
        )
        device.on_position_update = lambda pos, d_id=device_id: asyncio.create_task(
            self._broadcast_position(d_id, pos)
        )
        device.on_error = lambda msg, d_id=device_id: asyncio.create_task(
            self._broadcast_error(d_id, msg)
        )
        device.on_job_complete = lambda file, d_id=device_id: asyncio.create_task(
            self._broadcast_job_complete(d_id, file)
        )
        device.on_job_progress = lambda progress, line, total, d_id=device_id: asyncio.create_task(
            self._broadcast_job_progress(d_id, progress, line, total)
        )

        if hasattr(device, "on_control_change"):
            device.on_control_change = lambda control, d_id=device_id: asyncio.create_task(
                self._broadcast_control_state(d_id, control)
            )

    def _resolve_device_port(self, config: DeviceConfig) -> Optional[str]:
        """
        Port feloldása USB azonosító vagy statikus port alapján.

        Prioritás: usb.serial_number > usb.vid:pid+location > usb.vid:pid > port
        """
        usb_config = config.config.get("usb")
        fallback_port = config.config.get("port")

        if usb_config:
            usb_id = UsbIdentifier(
                serial_number=usb_config.get("serial_number"),
                vid=usb_config.get("vid"),
                pid=usb_config.get("pid"),
                location=usb_config.get("location"),
            )
            resolved = resolve_port(usb=usb_id, fallback_port=fallback_port)
            logger.info(
                f"[CONNECT_PORT:{config.id}] resolved={resolved}, fallback={fallback_port}, "
                f"usb_serial={usb_id.serial_number}, usb_vid={usb_id.vid}, "
                f"usb_pid={usb_id.pid}, usb_location={usb_id.location}"
            )
            return resolved

        resolved = fallback_port or "/dev/ttyUSB0"
        logger.info(f"[CONNECT_PORT:{config.id}] resolved={resolved}, fallback_only=true")
        return resolved

    def get_device(self, device_id: str) -> Optional[DeviceDriver]:
        return self.devices.get(device_id)

    # ------------------------------------------------------------------
    # Connect / disconnect
    # ------------------------------------------------------------------

    async def connect_all(self) -> Dict[str, bool]:
        """Összes eszköz csatlakoztatása."""
        results: Dict[str, bool] = {}
        for device_id, device in self.devices.items():
            try:
                device_port = getattr(device, "port", "n/a")
                logger.info(f"[CONNECT_ALL:{device_id}] begin port={device_port}")
                connected = await asyncio.wait_for(
                    device.connect(),
                    timeout=STARTUP_CONNECT_TIMEOUT_SECONDS,
                )
                results[device_id] = connected
                logger.info(f"[CONNECT_ALL:{device_id}] result connected={connected}")

                if connected:
                    try:
                        claim = await auto_claim_host_if_supported(
                            device_id=device_id,
                            device=device,
                            changed_by="bridge_startup_connect_claim",
                            retries=1,
                        )
                        if claim.get("attempted"):
                            control = claim.get("state") or {}
                            if control:
                                if claim.get("granted"):
                                    await self._broadcast_control_state(device_id, control)
                                else:
                                    await self._broadcast_control_denied(
                                        device_id,
                                        str(claim.get("reason") or "denied"),
                                        control,
                                    )
                            logger.info(
                                f"🔐 Startup ownership sync ({device_id}): "
                                f"sent={claim.get('sent')}, granted={claim.get('granted')}, "
                                f"owner={(control or {}).get('owner')}, reason={(control or {}).get('reason')}"
                            )
                    except Exception as exc:
                        logger.error(f"⚠️ Startup ownership claim hiba ({device_id}): {exc}")
            except asyncio.TimeoutError:
                logger.info(
                    f"Csatlakozási timeout ({device_id}): {STARTUP_CONNECT_TIMEOUT_SECONDS:.1f}s"
                )
                try:
                    await device.disconnect()
                except Exception:
                    pass
                results[device_id] = False
            except Exception as exc:
                logger.error(f"Csatlakozási hiba ({device_id}): {str(exc)}")
                results[device_id] = False
        return results

    async def disconnect_all(self) -> None:
        """Összes eszköz lecsatlakoztatása."""
        for device in self.devices.values():
            try:
                await device.disconnect()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # WebSocket broadcast
    # ------------------------------------------------------------------

    def register_ws_client(self, websocket: WebSocket) -> None:
        self._ws_clients.append(websocket)

    def unregister_ws_client(self, websocket: WebSocket) -> None:
        if websocket in self._ws_clients:
            self._ws_clients.remove(websocket)

    async def _broadcast(self, message: Dict[str, Any]) -> None:
        disconnected: List[WebSocket] = []
        for client in self._ws_clients:
            try:
                await client.send_json(message)
            except Exception:
                disconnected.append(client)

        for client in disconnected:
            self.unregister_ws_client(client)

    async def _broadcast_state_change(
        self,
        device_id: str,
        old_state: DeviceState,
        new_state: DeviceState,
    ) -> None:
        await self._broadcast(
            {
                "type": "state_change",
                "device_id": device_id,
                "old_state": old_state.value,
                "new_state": new_state.value,
            }
        )

    async def _broadcast_position(self, device_id: str, position: Position) -> None:
        await self._broadcast(
            {
                "type": "position",
                "device_id": device_id,
                "position": position.to_dict(),
            }
        )

    async def _broadcast_error(self, device_id: str, message: str) -> None:
        if device_id in self.device_metadata:
            self.device_metadata[device_id].last_error = message

        await self._broadcast(
            {
                "type": "error",
                "device_id": device_id,
                "message": message,
            }
        )

    async def _broadcast_job_complete(self, device_id: str, file: str) -> None:
        await self._broadcast(
            {
                "type": "job_complete",
                "device_id": device_id,
                "file": file,
            }
        )

    async def _broadcast_job_progress(
        self,
        device_id: str,
        progress: float,
        current_line: int,
        total_lines: int,
    ) -> None:
        await self._broadcast(
            {
                "type": "job_progress",
                "device_id": device_id,
                "progress": progress,
                "current_line": current_line,
                "total_lines": total_lines,
            }
        )

    def get_control_state(self, device_id: str) -> Optional[Dict[str, Any]]:
        device = self.get_device(device_id)
        if not device or not hasattr(device, "get_control_state"):
            return None
        try:
            return device.get_control_state()
        except Exception:
            return None

    async def _broadcast_control_state(
        self, device_id: str, control: Dict[str, Any]
    ) -> None:
        await self._broadcast(
            {
                "type": "control_state",
                "device_id": device_id,
                "control": control,
            }
        )

    async def _broadcast_control_denied(
        self, device_id: str, reason: str, control: Dict[str, Any]
    ) -> None:
        await self._broadcast(
            {
                "type": "control_denied",
                "device_id": device_id,
                "reason": reason,
                "control": control,
            }
        )
