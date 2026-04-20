#!/usr/bin/env python3
"""
Python Bridge Server - FastAPI + WebSocket
Multi-Robot Control System

Ez a szerver közvetít a Node.js backend és a Python device driverek között.
HTTP REST API-t és WebSocket-et biztosít a kommunikációhoz.
"""

import asyncio
import json
import os
import threading
import time
from typing import Dict, Optional, Any, List
from pathlib import Path
from contextlib import asynccontextmanager

import yaml
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from base import DeviceDriver, DeviceState, DeviceStatus, Position, DeviceType
from grbl_driver import GrblDevice
from linuxcnc_driver import LinuxCNCDevice
from robot_arm_driver import RobotArmDevice
from simulated_device import SimulatedDevice, SimulationMode
from control_lock_decorator import ControlLockDecorator
from usb_port_resolver import UsbIdentifier, resolve_port, list_usb_devices

# Machine config path
MACHINE_CONFIG_DIR = Path(__file__).parent.parent / "config" / "machines"
CONNECT_TIMEOUT_SECONDS = float(os.environ.get("DEVICE_CONNECT_TIMEOUT_SECONDS", "8.0"))
STARTUP_CONNECT_TIMEOUT_SECONDS = float(
    os.environ.get("DEVICE_STARTUP_CONNECT_TIMEOUT_SECONDS", "15.0")
)
RT_OWN_CLAIM_HOST = 0x8D
RT_OWN_REQUEST_PANEL = 0x8E
RT_OWN_RELEASE = 0x8F
RT_OWN_QUERY = 0xA5
DEBUG_LOG_PATH = "/web/multi-robot-control/.cursor/debug-e190d9.log"

# Szimulációs mód már csak eszközönként (devices.yaml simulated mezője)


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
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️ Nem sikerült betölteni a machine config-ot: {device_id}: {e}")
        return None


def extract_driver_config(machine_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Kinyeri a driver-specifikus beállításokat a machine config-ból.
    Átalakítja a frontend formátumot a driver formátumra.
    """
    driver_cfg = machine_config.get('driverConfig', {})
    axes = machine_config.get('axes', [])
    
    # Axis limits (frontend: axes[].min/max -> backend: axis_limits)
    axis_limits = {}
    axis_invert = {}
    axis_scale = {}
    dynamic_limits = {}

    for axis in axes:
        axis_name = axis.get('name', '').upper()  # X, Y, Z direkt használat

        # null = nincs limit; csak konkrét numerikus értékeknél adjuk át
        axis_min = axis.get('min')
        axis_max = axis.get('max')
        if axis_min is not None and axis_max is not None:
            axis_limits[axis_name] = [axis_min, axis_max]

        if axis.get('invert', False):
            axis_invert[axis_name] = True

        if 'scale' in axis and axis['scale'] != 1.0:
            axis_scale[axis_name] = axis['scale']
        
        # Dinamikus limitek (ha van dependsOn)
        dyn_lim = axis.get('dynamicLimits')
        if dyn_lim and dyn_lim.get('dependsOn'):
            dynamic_limits[axis_name] = {
                'dependsOn': dyn_lim.get('dependsOn', '').upper(),
                'formula': dyn_lim.get('formula', 'linear_offset'),
                'factor': dyn_lim.get('factor', 0.9),  # inverse_coupled formula factor
            }
    
    # Home position conversion (config már X/Y/Z-t használ)
    home_position = None
    hp = driver_cfg.get('homePosition')
    if hp:
        home_position = {'mode': hp.get('mode', 'absolute')}
        positions = hp.get('positions', {})
        for axis_key, value in positions.items():
            home_position[axis_key.upper()] = value
    
    # Closed loop conversion
    closed_loop = None
    cl = driver_cfg.get('closedLoop')
    if cl and cl.get('enabled'):
        stall = cl.get('stallDetection', {})
        closed_loop = {
            'enabled': True,
            'driver_type': cl.get('driverType', 'servo'),
            'stall_detection': {
                'timeout': stall.get('timeout', 0.3),
                'tolerance': stall.get('tolerance', 0.5),
                'speed': stall.get('speed', 150),
                'max_search_angle': stall.get('maxSearchAngle', 400),
                'calibrate_joints': stall.get('calibrateJoints', ['Y', 'Z']),
            }
        }
    
    # Robot config (L1, L2, L3 from robotArm config)
    robot_config = None
    ra = machine_config.get('robotArm', {})
    if ra:
        robot_config = {
            'L1': ra.get('baseHeight', 85),
            'L2': ra.get('lowerArmLength', 140),
            'L3': ra.get('upperArmLength', 165),
        }
    
    return {
        'axis_limits': axis_limits if axis_limits else {},
        'axis_invert': axis_invert,  # Mindig visszaadjuk (üres dict is OK)
        'axis_scale': axis_scale,    # Mindig visszaadjuk (üres dict is OK)
        'dynamic_limits': dynamic_limits,  # Dinamikus limit konfigurációk
        'home_position': home_position,
        'closed_loop': closed_loop,
        'robot_config': robot_config,
        'max_feed_rate': driver_cfg.get('maxFeedRate'),
        'supports_panel_controller': bool(driver_cfg.get('supportsPanelController', False)),
        'protocol': driver_cfg.get('protocol'),
        'grbl_settings': driver_cfg.get('grblSettings'),
    }


# =========================================
# KONFIGURÁCIÓS MODELLEK
# =========================================

class DeviceConfig(BaseModel):
    """Eszköz konfiguráció"""
    id: str
    name: str
    driver: str  # "grbl" | "linuxcnc"
    type: str
    enabled: bool = True
    simulated: bool = True  # Szimulált eszköz (true) vagy valós (false)
    config: Dict[str, Any] = {}


class JogRequest(BaseModel):
    """Jog kérés"""
    axis: str
    distance: float
    feed_rate: float
    mode: Optional[str] = None  # 'jog', 'joint', 'cartesian' (robot arm only)


class JogSessionStartRequest(BaseModel):
    axis: str
    direction: float
    feed_rate: float
    mode: Optional[str] = None
    heartbeat_timeout: float = 0.5
    tick_ms: int = 40


class JogSessionBeatRequest(BaseModel):
    axis: Optional[str] = None
    direction: Optional[float] = None
    feed_rate: Optional[float] = None
    mode: Optional[str] = None


class JogSessionStopRequest(BaseModel):
    hard_stop: bool = False


class GCodeRequest(BaseModel):
    """G-code kérés"""
    gcode: str


class FileRequest(BaseModel):
    """Fájl betöltés kérés"""
    filepath: str


class OverrideRequest(BaseModel):
    """Override kérés"""
    percent: float


class ControlRequest(BaseModel):
    """Ownership váltási kérés"""
    requested_owner: str
    requested_by: Optional[str] = None


class ControlReleaseRequest(BaseModel):
    """Ownership elengedés"""
    requested_by: Optional[str] = None


# =========================================
# DEVICE MANAGER
# =========================================

class DeviceMetadata:
    """Eszköz metaadatok tárolása"""
    def __init__(self, simulated: bool, connection_info: str = ""):
        self.simulated = simulated
        self.connection_info = connection_info
        self.last_error: Optional[str] = None


class DeviceManager:
    """Eszközök kezelése"""
    
    def __init__(self):
        self.devices: Dict[str, DeviceDriver] = {}
        self.device_metadata: Dict[str, DeviceMetadata] = {}
        self._ws_clients: List[WebSocket] = []
    
    async def load_config(self, config_path: str) -> None:
        """Konfiguráció betöltése YAML fájlból"""
        if not os.path.exists(config_path):
            print(f"Konfiguráció nem található: {config_path}")
            return
        
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
        
        devices_config = config.get('devices', [])
        
        for device_conf in devices_config:
            if not device_conf.get('enabled', True):
                continue
            
            await self.add_device(DeviceConfig(**device_conf))
    
    async def add_device(self, config: DeviceConfig) -> bool:
        """Új eszköz hozzáadása"""
        try:
            driver = config.driver.lower()
            device = None
            connection_info = ""
            
            # Szimuláció döntés: devices.yaml simulated mezője alapján
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
                    max_x=config.config.get('max_x', 300.0),
                    max_y=config.config.get('max_y', 200.0),
                    max_z=config.config.get('max_z', 100.0),
                )
                connection_info = "Szimulált"
                print(f"🎮 Szimulált eszköz: {config.name}")
            elif driver == "grbl":
                port = self._resolve_device_port(config)
                if port is None:
                    print(f"⚠️ Port nem található: {config.name}")
                    return False
                device = GrblDevice(
                    device_id=config.id,
                    device_name=config.name,
                    port=port,
                    baudrate=config.config.get('baudrate', 115200),
                    max_feed_rate=config.config.get('max_feed_rate'),
                )
                connection_info = port
                print(f"🔌 Valós GRBL eszköz: {config.name} ({port})")
            elif driver == "linuxcnc":
                ini_file = config.config.get('ini_file')
                device = LinuxCNCDevice(
                    device_id=config.id,
                    device_name=config.name,
                    ini_file=ini_file,
                )
                connection_info = ini_file or "LinuxCNC"
                print(f"🔌 Valós LinuxCNC eszköz: {config.name}")
            elif driver == "robot_arm":
                port = self._resolve_device_port(config)
                if port is None:
                    print(f"⚠️ Port nem található: {config.name}")
                    return False
                
                # Betöltjük a machine-config.json-ból a driver beállításokat
                machine_config = load_machine_config(config.id)
                driver_cfg = {}
                
                if machine_config:
                    driver_cfg = extract_driver_config(machine_config)
                    print(f"   📋 Machine config betöltve: {config.id}")
                else:
                    # Fallback: devices.yaml-ból (átmeneti, migrálás előtt)
                    print(f"   ⚠️ Machine config nem található, devices.yaml használata: {config.id}")
                
                # Driver paraméterek: machine config JSON elsőbbséggel, devices.yaml fallback
                # Üres dict ({}) is valid érték, ezért None check kell az 'or' helyett
                axis_limits = driver_cfg.get('axis_limits') if driver_cfg.get('axis_limits') is not None else config.config.get('axis_limits')
                axis_invert = driver_cfg.get('axis_invert') if driver_cfg.get('axis_invert') is not None else config.config.get('axis_invert')
                axis_scale = driver_cfg.get('axis_scale') if driver_cfg.get('axis_scale') is not None else config.config.get('axis_scale')
                robot_config = driver_cfg.get('robot_config') or config.config.get('robot_config')
                max_feed_rate = driver_cfg.get('max_feed_rate') or config.config.get('max_feed_rate')
                closed_loop = driver_cfg.get('closed_loop') or config.config.get('closed_loop')
                home_position = driver_cfg.get('home_position') or config.config.get('home_position')
                
                device = RobotArmDevice(
                    device_id=config.id,
                    device_name=config.name,
                    port=port,
                    baudrate=config.config.get('baudrate', 115200),
                    robot_config=robot_config,
                    axis_invert=axis_invert,
                    axis_limits=axis_limits,
                    axis_scale=axis_scale,
                    max_feed_rate=max_feed_rate,
                    closed_loop=closed_loop,
                    home_position=home_position,
                )
                
                # Dinamikus limitek betöltése (ha vannak)
                dynamic_limits = driver_cfg.get('dynamic_limits')
                if dynamic_limits:
                    device.update_driver_config(dynamic_limits=dynamic_limits)
                    for axis, cfg in dynamic_limits.items():
                        print(f"   📐 Dinamikus limit [{axis}]: függ {cfg.get('dependsOn')}-tól")
                
                connection_info = port
                closed_loop_info = " [Closed Loop]" if (closed_loop or {}).get('enabled') else ""
                home_info = f" [Home: {(home_position or {}).get('mode', 'absolute')}]" if home_position else ""
                print(f"🤖 Valós robotkar eszköz: {config.name} ({port}){closed_loop_info}{home_info}")
            elif driver == "tube_bender":
                port = self._resolve_device_port(config)
                if port is None:
                    print(f"⚠️ Port nem található: {config.name}")
                    return False

                machine_config = load_machine_config(config.id)
                driver_cfg = {}
                if machine_config:
                    driver_cfg = extract_driver_config(machine_config)
                    print(f"   📋 Machine config betöltve: {config.id}")
                else:
                    print(f"   ⚠️ Machine config nem található, devices.yaml használata: {config.id}")

                from tube_bender_driver import TubeBenderDriver
                startup_grbl_settings = driver_cfg.get('grbl_settings') or config.config.get('grbl_settings') or {}
                if isinstance(startup_grbl_settings, dict):
                    s1 = startup_grbl_settings.get('1', startup_grbl_settings.get(1))
                    s4 = startup_grbl_settings.get('4', startup_grbl_settings.get(4))
                    if s1 is not None or s4 is not None:
                        print(f"   ⚙️ TubeBender startup hold settings: $1={s1}, $4={s4}")
                device = TubeBenderDriver(
                    device_id=config.id,
                    device_name=config.name,
                    port=port,
                    baudrate=config.config.get('baudrate', 115200),
                    max_feed_rate=driver_cfg.get('max_feed_rate') or config.config.get('max_feed_rate', 1000.0),
                    axis_limits=driver_cfg.get('axis_limits') or config.config.get('axis_limits'),
                    protocol=driver_cfg.get('protocol') or config.config.get('protocol', 'grbl'),
                    grbl_settings=startup_grbl_settings,
                )
                supports_panel_controller = bool(
                    driver_cfg.get('supports_panel_controller')
                    if driver_cfg.get('supports_panel_controller') is not None
                    else config.config.get('supports_panel_controller', False)
                )
                device = ControlLockDecorator(
                    device,
                    supports_panel_controller=supports_panel_controller,
                )
                connection_info = port
                print(f"🔧 Csőhajlító eszköz: {config.name} ({port}) [GRBL adapter]")
            else:
                print(f"Ismeretlen driver: {driver}")
                return False
            
            if device is None:
                return False
            
            # Metaadatok tárolása
            self.device_metadata[config.id] = DeviceMetadata(
                simulated=use_simulation,
                connection_info=connection_info
            )
            
            # Callback-ek beállítása
            device_id = config.id
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
            
            self.devices[config.id] = device
            print(f"Eszköz hozzáadva: {config.id} ({config.name})")
            return True
            
        except Exception as e:
            print(f"Eszköz hozzáadási hiba ({config.id}): {str(e)}")
            return False
    
    def _resolve_device_port(self, config: DeviceConfig) -> Optional[str]:
        """
        Port feloldása USB azonosító vagy statikus port alapján.
        
        Prioritás: usb.serial_number > usb.vid:pid+location > usb.vid:pid > port
        """
        usb_config = config.config.get('usb')
        fallback_port = config.config.get('port')
        
        if usb_config:
            usb_id = UsbIdentifier(
                serial_number=usb_config.get('serial_number'),
                vid=usb_config.get('vid'),
                pid=usb_config.get('pid'),
                location=usb_config.get('location'),
            )
            resolved = resolve_port(usb=usb_id, fallback_port=fallback_port)
            print(
                f"[CONNECT_PORT:{config.id}] resolved={resolved}, fallback={fallback_port}, "
                f"usb_serial={usb_id.serial_number}, usb_vid={usb_id.vid}, usb_pid={usb_id.pid}, usb_location={usb_id.location}"
            )
            return resolved
        
        resolved = fallback_port or '/dev/ttyUSB0'
        print(f"[CONNECT_PORT:{config.id}] resolved={resolved}, fallback_only=true")
        return resolved
    
    def get_device(self, device_id: str) -> Optional[DeviceDriver]:
        """Eszköz lekérdezése ID alapján"""
        return self.devices.get(device_id)
    
    async def connect_all(self) -> Dict[str, bool]:
        """Összes eszköz csatlakoztatása"""
        results = {}
        for device_id, device in self.devices.items():
            try:
                device_port = getattr(device, "port", "n/a")
                print(f"[CONNECT_ALL:{device_id}] begin port={device_port}")
                connected = await asyncio.wait_for(
                    device.connect(),
                    timeout=STARTUP_CONNECT_TIMEOUT_SECONDS,
                )
                results[device_id] = connected
                print(f"[CONNECT_ALL:{device_id}] result connected={connected}")

                if connected:
                    try:
                        claim = await _auto_claim_host_if_supported(
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
                            print(
                                f"🔐 Startup ownership sync ({device_id}): "
                                f"sent={claim.get('sent')}, granted={claim.get('granted')}, "
                                f"owner={(control or {}).get('owner')}, reason={(control or {}).get('reason')}"
                            )
                    except Exception as e:
                        print(f"⚠️ Startup ownership claim hiba ({device_id}): {e}")
            except asyncio.TimeoutError:
                print(
                    f"Csatlakozási timeout ({device_id}): {STARTUP_CONNECT_TIMEOUT_SECONDS:.1f}s"
                )
                try:
                    await device.disconnect()
                except Exception:
                    pass
                results[device_id] = False
            except Exception as e:
                print(f"Csatlakozási hiba ({device_id}): {str(e)}")
                results[device_id] = False
        return results
    
    async def disconnect_all(self) -> None:
        """Összes eszköz lecsatlakoztatása"""
        for device in self.devices.values():
            try:
                await device.disconnect()
            except Exception:
                pass
    
    # =========================================
    # WEBSOCKET BROADCAST
    # =========================================
    
    def register_ws_client(self, websocket: WebSocket) -> None:
        """WebSocket kliens regisztrálása"""
        self._ws_clients.append(websocket)
    
    def unregister_ws_client(self, websocket: WebSocket) -> None:
        """WebSocket kliens eltávolítása"""
        if websocket in self._ws_clients:
            self._ws_clients.remove(websocket)
    
    async def _broadcast(self, message: Dict[str, Any]) -> None:
        """Üzenet küldése minden kliensnek"""
        disconnected = []
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
        await self._broadcast({
            "type": "state_change",
            "device_id": device_id,
            "old_state": old_state.value,
            "new_state": new_state.value,
        })
    
    async def _broadcast_position(self, device_id: str, position: Position) -> None:
        await self._broadcast({
            "type": "position",
            "device_id": device_id,
            "position": position.to_dict(),
        })
    
    async def _broadcast_error(self, device_id: str, message: str) -> None:
        # Hiba tárolása a metaadatokban
        if device_id in self.device_metadata:
            self.device_metadata[device_id].last_error = message
        
        await self._broadcast({
            "type": "error",
            "device_id": device_id,
            "message": message,
        })
    
    async def _broadcast_job_complete(self, device_id: str, file: str) -> None:
        await self._broadcast({
            "type": "job_complete",
            "device_id": device_id,
            "file": file,
        })
    
    async def _broadcast_job_progress(
        self, 
        device_id: str, 
        progress: float, 
        current_line: int, 
        total_lines: int
    ) -> None:
        await self._broadcast({
            "type": "job_progress",
            "device_id": device_id,
            "progress": progress,
            "current_line": current_line,
            "total_lines": total_lines,
        })

    def get_control_state(self, device_id: str) -> Optional[Dict[str, Any]]:
        device = self.get_device(device_id)
        if not device or not hasattr(device, "get_control_state"):
            return None
        try:
            return device.get_control_state()
        except Exception:
            return None

    async def _broadcast_control_state(self, device_id: str, control: Dict[str, Any]) -> None:
        await self._broadcast({
            "type": "control_state",
            "device_id": device_id,
            "control": control,
        })

    async def _broadcast_control_denied(self, device_id: str, reason: str, control: Dict[str, Any]) -> None:
        await self._broadcast({
            "type": "control_denied",
            "device_id": device_id,
            "reason": reason,
            "control": control,
        })


# =========================================
# GLOBAL DEVICE MANAGER
# =========================================

device_manager = DeviceManager()

# Aktív tesztek leállítási jelzői (device_id -> threading.Event)
_active_test_events: Dict[str, threading.Event] = {}

# Aktív tesztek napló bejegyzései (device_id -> list[dict]) - a teszt objektum _log_entries listája
_active_test_progress: Dict[str, list] = {}
_debug_last_status_snapshot: Dict[str, Any] = {}


def _debug_log(run_id: str, hypothesis_id: str, location: str, message: str, data: Dict[str, Any]) -> None:
    # region agent log
    payload = {
        "sessionId": "e190d9",
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    try:
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass
    # endregion


def _debug_log_status_if_changed(device_id: str, status: DeviceStatus, control: Optional[Dict[str, Any]]) -> None:
    if device_id != "tube_bender_1":
        return
    owner = str((control or {}).get("owner", "none"))
    snapshot = (
        status.state.value,
        owner,
        round(status.position.x, 3),
        round(status.position.y, 3),
        round(status.position.z, 3),
        status.error_message or "",
    )
    if _debug_last_status_snapshot.get(device_id) == snapshot:
        return
    _debug_last_status_snapshot[device_id] = snapshot
    _debug_log(
        run_id="panel-step-debug-1",
        hypothesis_id="H2_H3_H4",
        location="bridge_server.py:get_device_status",
        message="Status/control snapshot changed",
        data={
            "device_id": device_id,
            "state": status.state.value,
            "owner": owner,
            "position": {
                "x": round(status.position.x, 3),
                "y": round(status.position.y, 3),
                "z": round(status.position.z, 3),
            },
            "error_message": status.error_message,
        },
    )


async def _sync_control_from_firmware(device: Any, changed_by: str) -> Optional[Dict[str, Any]]:
    """
    Refresh decorator control state from firmware ownership fields.
    Returns control dict if sync is possible, otherwise None.
    """
    if not hasattr(device, "sync_firmware_owner"):
        return None

    # Pull a fresh status first so ownership getters are up to date.
    try:
        await device.get_status()
    except Exception:
        pass

    # Prefer explicit owner getters when available.
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

    # Fallback for wrappers exposing already-synced control state.
    state_getter = getattr(device, "get_control_state", None)
    if callable(state_getter):
        try:
            control = state_getter() or {}
            if control:
                return control
        except Exception:
            pass

    return None


async def _auto_claim_host_if_supported(
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
        control = await _sync_control_from_firmware(
            device,
            changed_by=changed_by,
        ) or {}
        owner = str(control.get("owner", "none")).lower()
        lock_state = str(control.get("lock_state", "")).lower()
        reason = str(control.get("reason") or "") or None
        granted = bool(sent and owner == "host" and lock_state == "granted")
        result.update({
            "sent": sent,
            "granted": granted,
            "reason": reason,
            "state": control,
        })
        if sent and not granted and not reason:
            # Command path appears alive at transport level, but firmware state did not
            # acknowledge ownership change (owner/reason unchanged).
            result["reason"] = "firmware_no_ownership_ack"
        if granted or reason == "command_running":
            break
        await asyncio.sleep(0.15)

    return result


# =========================================
# FASTAPI APP
# =========================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifecycle management"""
    # Startup
    config_path = os.environ.get(
        'DEVICES_CONFIG',
        str(Path(__file__).parent.parent / 'config' / 'devices.yaml')
    )
    await device_manager.load_config(config_path)
    await device_manager.connect_all()
    
    yield
    
    # Shutdown
    await device_manager.disconnect_all()


app = FastAPI(
    title="Multi-Robot Control System - Device Bridge",
    description="Python bridge server for device communication",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================
# REST API ENDPOINTS
# =========================================

@app.get("/")
async def root():
    """Root endpoint"""
    return {"status": "ok", "service": "device-bridge"}


@app.get("/usb/devices")
async def get_usb_devices():
    """
    USB-serial eszközök listázása.
    
    Diagnosztikai endpoint az USB azonosítók (VID, PID, serial_number, location) 
    megjelenítésére a devices.yaml konfigurációhoz.
    """
    devices = list_usb_devices()
    return {
        "devices": devices,
        "count": len(devices),
        "hint": "Használd ezeket az értékeket a devices.yaml 'usb' szekciójában"
    }


@app.get("/devices")
async def list_devices():
    """Összes eszköz listázása"""
    devices = []
    for device_id, device in device_manager.devices.items():
        metadata = device_manager.device_metadata.get(device_id)
        control = device_manager.get_control_state(device_id)
        devices.append({
            "id": device_id,
            "name": device.device_name,
            "type": device.device_type.value,
            "connected": device.is_connected,
            "state": device.state.value,
            "simulated": metadata.simulated if metadata else True,
            "connectionInfo": metadata.connection_info if metadata else "",
            "lastError": metadata.last_error if metadata else None,
            "control": control,
        })
    return {"devices": devices}


@app.post("/devices")
async def add_device(config: DeviceConfig):
    """Új eszköz hozzáadása"""
    # Check if device already exists
    if device_manager.get_device(config.id):
        raise HTTPException(status_code=400, detail="Eszköz már létezik ezzel az ID-val")
    
    # Add device
    success = await device_manager.add_device(config)
    
    if success:
        # Auto-connect the new device
        device = device_manager.get_device(config.id)
        if device:
            await device.connect()
        
        return {"success": True, "message": "Eszköz sikeresen hozzáadva és csatlakoztatva"}
    else:
        raise HTTPException(status_code=500, detail="Nem sikerült hozzáadni az eszközt")


@app.get("/devices/{device_id}")
async def get_device(device_id: str):
    """Eszköz részletek"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    return device.get_info()


@app.get("/devices/{device_id}/status")
async def get_device_status(device_id: str):
    """Eszköz állapot lekérdezése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    status = await device.get_status()
    _debug_log_status_if_changed(
        device_id=device_id,
        status=status,
        control=device_manager.get_control_state(device_id),
    )
    return status.to_dict()


@app.get("/devices/{device_id}/capabilities")
async def get_device_capabilities(device_id: str):
    """Eszköz képességek lekérdezése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    capabilities = await device.get_capabilities()
    return capabilities.to_dict()


@app.get("/devices/{device_id}/control/state")
async def get_device_control_state(device_id: str):
    """Ownership lock állapot lekérdezése.

    Az ownership lock opcionális (csak ControlLockDecorator-ral wrap-elt
    eszközöknél van valódi állapot). A backend 500 ms-onként lekéri ezt
    minden csatlakozott eszközre, ezért a nem-lockable eszközöknél nem
    400-as hibát adunk vissza (ami zajos lenne a logban), hanem egy
    neutrális default állapotot. A `supports_panel_controller=false`
    capabilityből úgyis tudja a backend, hogy az auto-claim flow-t át
    kell ugrania.
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


@app.post("/devices/{device_id}/control/request")
async def request_device_control(device_id: str, request: ControlRequest):
    """Ownership kérés (host|panel)"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    if not hasattr(device, "request_control"):
        raise HTTPException(status_code=400, detail="Az eszköz nem támogat ownership lockot")

    requested_owner = (request.requested_owner or "").strip().lower()

    # Firmware is the source of truth for panel-enabled devices:
    # use realtime ownership commands, then sync decorator state from status.
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
                control = await _sync_control_from_firmware(
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
                if reason == "denied" and sent and str(control.get("owner", "none")).lower() == "none":
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
                        device_id,
                        reason,
                        control,
                    )
                _debug_log(
                    run_id="panel-step-debug-1",
                    hypothesis_id="H1_H2",
                    location="bridge_server.py:request_device_control",
                    message="Ownership request processed",
                    data={
                        "device_id": device_id,
                        "requested_owner": requested_owner,
                        "granted": granted,
                        "reason": result.get("reason"),
                        "state_owner": control.get("owner"),
                        "state_reason": control.get("reason"),
                    },
                )
                return result
        except HTTPException:
            raise
        except Exception as e:
            print(f"⚠️ Firmware ownership request hiba ({device_id}): {e}")

    # Fallback for non-panel devices or drivers without realtime ownership.
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


@app.post("/devices/{device_id}/control/release")
async def release_device_control(device_id: str, request: Optional[ControlReleaseRequest] = None):
    """Ownership elengedése"""
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
                control = await _sync_control_from_firmware(
                    device,
                    changed_by=(request.requested_by if request else None) or "api_release_rt",
                )
                if control is None and hasattr(device, "get_control_state"):
                    control = device.get_control_state()
                if control is None:
                    control = {}
                granted = bool(sent and str(control.get("owner", "none")).lower() == "none")
                result = {
                    "granted": granted,
                    "reason": None if granted else str(control.get("reason") or "denied"),
                    "state": control,
                }
                await device_manager._broadcast_control_state(device_id, control)
                return result
        except Exception as e:
            print(f"⚠️ Firmware ownership release hiba ({device_id}): {e}")

    result = device.release_control(
        requested_by=(request.requested_by if request else None) or "api_release"
    )
    control = result.get("state", {})
    await device_manager._broadcast_control_state(device_id, control)
    return result


@app.post("/devices/{device_id}/connect")
async def connect_device(device_id: str):
    """Csatlakozás az eszközhöz"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")

    try:
        device_port = getattr(device, "port", "n/a")
        print(f"[CONNECT_API:{device_id}] begin port={device_port}")
        # Guard against serial/handshake stalls so callers get a clear HTTP error
        # instead of hanging until upstream client-side timeout.
        result = await asyncio.wait_for(
            device.connect(),
            timeout=CONNECT_TIMEOUT_SECONDS,
        )
        print(f"[CONNECT_API:{device_id}] result connected={result}")
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
            claim = await _auto_claim_host_if_supported(
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
        except Exception as e:
            print(f"⚠️ Ownership claim küldési hiba ({device_id}): {e}")
    return {
        "success": result,
        "ownership_claim_sent": claim_sent,
        "ownership_claim_granted": claim_granted,
        "ownership_claim_reason": claim_reason,
    }


@app.post("/devices/{device_id}/disconnect")
async def disconnect_device(device_id: str):
    """Lecsatlakozás az eszközről"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    await device.disconnect()
    return {"success": True}


@app.post("/devices/{device_id}/reconnect")
async def reconnect_device(device_id: str):
    """Újracsatlakozás az eszközhöz (USB disconnect/reconnect után)"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    if isinstance(device, RobotArmDevice):
        result = await device.reconnect()
    else:
        # Más eszközök: disconnect + connect
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
            claim = await _auto_claim_host_if_supported(
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
        except Exception as e:
            print(f"⚠️ Reconnect ownership claim hiba ({device_id}): {e}")

    return {
        "success": result,
        "ownership_claim_sent": claim_sent,
        "ownership_claim_granted": claim_granted,
        "ownership_claim_reason": claim_reason,
    }


class HomeRequest(BaseModel):
    axes: Optional[List[str]] = None
    feed_rate: Optional[float] = None

@app.post("/devices/{device_id}/home")
async def home_device(device_id: str, request: Optional[HomeRequest] = None):
    """Homing végrehajtása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    axes = request.axes if request else None
    feed_rate = request.feed_rate if request else None
    result = await device.home(axes, feed_rate=feed_rate)
    return {"success": result}


@app.post("/devices/{device_id}/jog")
async def jog_device(device_id: str, request: JogRequest):
    """Jog mozgás"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    # ControlLockDecorator wraps robot-arm jog methods and keeps lock checks active.
    if isinstance(device, ControlLockDecorator):
        if request.mode == 'cartesian':
            result = await device.jog_cartesian(request.axis, request.distance, request.feed_rate)
        else:
            result = await device.jog_joint(request.axis, request.distance, request.feed_rate)
    # Robot arm: jog_joint és jog_cartesian metódusok elérhetők
    elif hasattr(device, 'jog_joint') and hasattr(device, 'jog_cartesian'):
        if request.mode == 'cartesian':
            # Cartesian mód: X/Y/Z mm-ben, IK számítással
            result = await device.jog_cartesian(request.axis, request.distance, request.feed_rate)
        else:
            # Jog mód: X/Y/Z tengely direkt mozgatása
            result = await device.jog_joint(request.axis, request.distance, request.feed_rate)
    else:
        # Nem robot arm (pl. laser, CNC) - standard jog
        result = await device.jog(request.axis, request.distance, request.feed_rate)
    
    return {"success": result}


@app.post("/devices/{device_id}/jog/stop")
async def jog_stop_device(device_id: str):
    """Jog leállítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.jog_stop()
    return {"success": result}


@app.post("/devices/{device_id}/jog/session/start")
async def jog_session_start(device_id: str, request: JogSessionStartRequest):
    """Folyamatos jog session indítása."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")

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

    # Fallback: egyszeri jog, ha nincs session támogatás.
    distance = (request.feed_rate / 60.0) * (max(20, min(200, request.tick_ms)) / 1000.0)
    distance = distance if request.direction >= 0 else -distance
    result = await device.jog(request.axis, distance, request.feed_rate)
    return {"success": result, "fallback": True}


@app.post("/devices/{device_id}/jog/session/beat")
async def jog_session_beat(device_id: str, request: JogSessionBeatRequest):
    """Folyamatos jog session heartbeat/frissítés."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")

    if hasattr(device, "update_jog_session"):
        result = await device.update_jog_session(
            axis=request.axis,
            direction=request.direction,
            feed_rate=request.feed_rate,
            mode=request.mode,
        )
        return {"success": result}

    return {"success": False, "fallback": True}


@app.post("/devices/{device_id}/jog/session/stop")
async def jog_session_stop(device_id: str, request: JogSessionStopRequest):
    """Folyamatos jog session leállítás (opcionális hard stop)."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")

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
        # Session task cancellation esetén se dobjunk 500-at.
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
        # Last-resort safety fallback: explicit jog stop.
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


@app.get("/devices/{device_id}/jog/diagnostics")
async def get_jog_diagnostics(device_id: str):
    """Utolsó jog művelet nyers diagnosztikai adatai."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")

    if not hasattr(device, "get_jog_diagnostics"):
        raise HTTPException(status_code=400, detail="Az eszköz nem támogat jog diagnosztikát")

    return device.get_jog_diagnostics()


@app.post("/devices/{device_id}/gcode")
async def send_gcode(device_id: str, request: GCodeRequest):
    """G-code parancs küldése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    response = await device.send_gcode(request.gcode)
    return {"response": response}


@app.post("/devices/{device_id}/load")
async def load_file(device_id: str, request: FileRequest):
    """G-code fájl betöltése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.load_file(request.filepath)
    return {"success": result}


@app.post("/devices/{device_id}/run")
async def run_device(device_id: str, from_line: int = 0):
    """Program futtatás indítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.run(from_line)
    return {"success": result}


@app.post("/devices/{device_id}/pause")
async def pause_device(device_id: str):
    """Program megállítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.pause()
    return {"success": result}


@app.post("/devices/{device_id}/resume")
async def resume_device(device_id: str):
    """Program folytatása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.resume()
    return {"success": result}


@app.post("/devices/{device_id}/stop")
async def stop_device(device_id: str):
    """Program leállítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.stop()
    return {"success": result}


@app.post("/devices/{device_id}/reset")
async def reset_device(device_id: str):
    """Eszköz reset"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.reset()
    return {"success": result}


@app.post("/devices/{device_id}/feed-override")
async def set_feed_override(device_id: str, request: OverrideRequest):
    """Feed rate override beállítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.set_feed_override(request.percent)
    return {"success": result}


@app.post("/devices/{device_id}/spindle-override")
async def set_spindle_override(device_id: str, request: OverrideRequest):
    """Spindle speed override beállítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.set_spindle_override(request.percent)
    return {"success": result}


# =========================================
# ROBOT ARM SPECIFIKUS VÉGPONTOK
# =========================================

@app.post("/devices/{device_id}/gripper/on")
async def gripper_on(device_id: str):
    """Megfogó bezárása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    result = await device.gripper_on()
    return {"success": result}


@app.post("/devices/{device_id}/gripper/off")
async def gripper_off(device_id: str):
    """Megfogó nyitása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    result = await device.gripper_off()
    return {"success": result}


@app.post("/devices/{device_id}/sucker/on")
async def sucker_on(device_id: str):
    """Szívó bekapcsolása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    result = await device.sucker_on()
    return {"success": result}


@app.post("/devices/{device_id}/sucker/off")
async def sucker_off(device_id: str):
    """Szívó kikapcsolása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    result = await device.sucker_off()
    return {"success": result}


@app.post("/devices/{device_id}/enable")
async def robot_enable(device_id: str):
    """Robot engedélyezése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    result = await device.enable()
    return {"success": result}


@app.post("/devices/{device_id}/disable")
async def robot_disable(device_id: str):
    """Robot letiltása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    result = await device.disable()
    return {"success": result}


@app.post("/devices/{device_id}/calibrate")
async def robot_calibrate(device_id: str):
    """Robot kalibráció"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    result = await device.calibrate()
    return {"success": result}


class CalibrateLimitsRequest(BaseModel):
    """Végállás kalibráció kérés"""
    speed: float = 300.0
    joints: Optional[List[str]] = None
    stall_timeout: float = 0.3
    stall_tolerance: float = 0.5


@app.post("/devices/{device_id}/calibrate-limits")
async def calibrate_limits(device_id: str, request: CalibrateLimitsRequest = None):
    """
    Automatikus végállás kalibráció stall detection-nel.
    
    Csak closed loop (SERVO42C) eszközökkel működik megfelelően.
    A driverek automatikusan érzékelik az elakadást.
    """
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    
    if not hasattr(device, 'calibrate_limits'):
        raise HTTPException(status_code=400, detail="Ez az eszköz nem támogatja az automatikus kalibrációt")
    
    if request is None:
        request = CalibrateLimitsRequest()
    
    result = await device.calibrate_limits(
        speed=request.speed,
        joints=request.joints,
        stall_timeout=request.stall_timeout,
        stall_tolerance=request.stall_tolerance,
    )
    return result


@app.get("/devices/{device_id}/calibration-status")
async def get_calibration_status(device_id: str):
    """
    Kalibráció állapot lekérdezése (progress, lépés, eredmények).
    """
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    
    if not hasattr(device, 'get_calibration_status'):
        return {"running": False, "message": "Nem támogatott"}
    
    return device.get_calibration_status()


@app.post("/devices/{device_id}/calibration-stop")
async def stop_calibration(device_id: str):
    """
    Futó kalibráció leállítása.
    """
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    
    if hasattr(device, 'stop_calibration'):
        device.stop_calibration()
    
    return {"success": True}


class SaveCalibrationRequest(BaseModel):
    """Kalibráció mentés kérés"""
    j1_limits: Optional[List[float]] = None
    j2_limits: Optional[List[float]] = None
    j3_limits: Optional[List[float]] = None


@app.post("/devices/{device_id}/save-calibration")
async def save_calibration(device_id: str, request: SaveCalibrationRequest):
    """
    Kalibrációs eredmények mentése a devices.yaml fájlba.
    """
    config_path = Path(__file__).parent.parent / "config" / "devices.yaml"
    
    if not config_path.exists():
        raise HTTPException(status_code=404, detail="devices.yaml nem található")
    
    try:
        with open(config_path, 'r') as f:
            config_data = yaml.safe_load(f)
        
        device_found = False
        for device_cfg in config_data.get('devices', []):
            if device_cfg.get('id') == device_id:
                device_found = True
                if 'config' not in device_cfg:
                    device_cfg['config'] = {}
                if 'axis_limits' not in device_cfg['config']:
                    device_cfg['config']['axis_limits'] = {}
                
                axis_limits = device_cfg['config']['axis_limits']
                
                if request.j1_limits and len(request.j1_limits) == 2:
                    axis_limits['Z'] = request.j1_limits
                if request.j2_limits and len(request.j2_limits) == 2:
                    axis_limits['X'] = request.j2_limits
                if request.j3_limits and len(request.j3_limits) == 2:
                    axis_limits['Y'] = request.j3_limits
                
                break
        
        if not device_found:
            raise HTTPException(status_code=404, detail=f"Eszköz nem található: {device_id}")
        
        with open(config_path, 'w') as f:
            yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
        
        return {"success": True, "message": "Kalibráció mentve a devices.yaml-ba"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mentés hiba: {str(e)}")


class SetHomePositionRequest(BaseModel):
    """Home pozíció beállítás kérés"""
    mode: str = "absolute"  # "absolute" | "query"
    X: Optional[float] = None
    Y: Optional[float] = None
    Z: Optional[float] = None
    save_current: bool = False  # Ha true, az aktuális pozíciót menti


@app.get("/devices/{device_id}/home-position")
async def get_home_position(device_id: str):
    """
    Home pozíció konfiguráció lekérdezése a machine-config.json-ból.
    """
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Csak robotkar eszközök támogatják a home pozíciót")
    
    # Machine config-ból olvasás
    machine_config = load_machine_config(device_id)
    if machine_config and 'driverConfig' in machine_config:
        hp = machine_config['driverConfig'].get('homePosition', {})
        positions = hp.get('positions', {})
        return {
            'mode': hp.get('mode', 'absolute'),
            'X': positions.get('X', 0.0),
            'Y': positions.get('Y', 0.0),
            'Z': positions.get('Z', 0.0),
        }
    
    # Fallback: device internal state
    return device.get_home_position_config()


@app.post("/devices/{device_id}/home-position")
async def set_home_position(device_id: str, request: SetHomePositionRequest):
    """
    Home pozíció beállítása és mentése a machine-config.json fájlba.
    
    Ha save_current=true, az aktuális pozíciót menti home pozícióként.
    """
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Csak robotkar eszközök támogatják a home pozíciót")
    
    config_path = MACHINE_CONFIG_DIR / f"{device_id}.json"
    
    if not config_path.exists():
        raise HTTPException(status_code=404, detail=f"Machine config nem található: {device_id}")
    
    try:
        # Ha save_current, az aktuális pozíciót használjuk
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
        
        # Driver konfiguráció frissítése (internal state)
        new_config = {
            'mode': request.mode,
            'X': x_val,
            'Y': y_val,
            'Z': z_val,
        }
        device.set_home_position_config(new_config)
        
        # machine-config.json frissítése
        with open(config_path, 'r', encoding='utf-8') as f:
            config_data = json.load(f)
        
        # Config frissítés X/Y/Z formátumban
        if 'driverConfig' not in config_data:
            config_data['driverConfig'] = {}
        
        config_data['driverConfig']['homePosition'] = {
            'mode': request.mode,
            'positions': {
                'X': x_val,
                'Y': y_val,
                'Z': z_val,
            }
        }
        
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)
        
        return {
            "success": True,
            "message": "Home pozíció mentve",
            "home_position": new_config,
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mentés hiba: {str(e)}")


def _device_core(device: Any) -> Any:
    """Return inner driver for wrappers when type checks are needed."""
    if isinstance(device, ControlLockDecorator):
        return device._inner
    return device


@app.post("/devices/{device_id}/soft-limits")
async def set_soft_limits(device_id: str, enabled: bool):
    """
    Szoftveres limitek be/kikapcsolása.
    
    Ha kikapcsoljuk, a szoftver nem ellenőrzi a tengely limiteket mozgás közben.
    """
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    core = _device_core(device)

    if hasattr(core, "set_soft_limits_enabled") and hasattr(core, "get_soft_limits_enabled"):
        core.set_soft_limits_enabled(enabled)
        return {
            "success": True,
            "soft_limits_enabled": enabled,
        }

    if hasattr(device, "get_grbl_settings") and hasattr(device, "set_grbl_setting"):
        settings = await device.get_grbl_settings()
        if enabled and int(round(settings.get(22, 0))) == 0:
            raise HTTPException(
                status_code=400,
                detail="Soft limits csak homing engedélyezése után kapcsolható be ($22=1 szükséges).",
            )

        # GRBL/grblHAL soft limits: $20 (0/1)
        ok = await device.set_grbl_setting(20, 1 if enabled else 0)
        if not ok:
            raise HTTPException(status_code=500, detail="GRBL $20 beállítás sikertelen (ellenőrizd Alarm/E-Stop állapotot)")

        # Verify effective state from controller settings if available.
        settings = await device.get_grbl_settings()
        value = settings.get(20, 1 if enabled else 0)
        return {
            "success": True,
            "soft_limits_enabled": bool(int(round(value))),
        }

    raise HTTPException(status_code=400, detail="Az eszköz nem támogatja a szoftveres limiteket")


@app.get("/devices/{device_id}/soft-limits")
async def get_soft_limits(device_id: str):
    """Szoftveres limitek állapotának lekérdezése."""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    core = _device_core(device)

    if hasattr(core, "get_soft_limits_enabled"):
        return {
            "soft_limits_enabled": core.get_soft_limits_enabled(),
        }

    if hasattr(device, "get_grbl_settings"):
        # Read GRBL settings and expose $20 as generic soft-limits state.
        settings = await device.get_grbl_settings()
        value = settings.get(20)
        if value is None:
            # Fallback to cached settings when controller readback is unavailable.
            cached = getattr(core, "_grbl_settings", None)
            if cached is not None:
                value = 1.0 if cached.soft_limits else 0.0
        if value is None:
            value = 0.0
        return {
            "soft_limits_enabled": bool(int(round(value))),
        }

    raise HTTPException(status_code=400, detail="Az eszköz nem támogatja a szoftveres limiteket")


@app.post("/devices/{device_id}/reload-config")
async def reload_device_config(device_id: str):
    """
    Konfiguráció újratöltése a machine-config.json fájlból.
    A MachineConfigTab mentése után hívandó, hogy az új beállítások
    (pl. tengely invertálás, scale, limitek) azonnal életbe lépjenek.
    """
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    machine_config = load_machine_config(device_id)
    if not machine_config:
        raise HTTPException(
            status_code=404,
            detail=f"Machine config nem található: {device_id}"
        )
    
    driver_cfg = extract_driver_config(machine_config)

    reload_info: Dict[str, Any] = {}
    if isinstance(device, RobotArmDevice):
        device.update_driver_config(
            axis_invert=driver_cfg.get('axis_invert'),
            axis_scale=driver_cfg.get('axis_scale'),
            axis_limits=driver_cfg.get('axis_limits'),
            max_feed_rate=driver_cfg.get('max_feed_rate'),
            dynamic_limits=driver_cfg.get('dynamic_limits'),
        )
    elif hasattr(device, "reload_machine_config"):
        reload_info = device.reload_machine_config(driver_cfg)
    else:
        raise HTTPException(
            status_code=400,
            detail="Ez az eszköz nem támogatja a config reload-ot"
        )

    print(f"🔄 Konfiguráció újratöltve: {device_id}")

    return {
        "success": True,
        "message": "Konfiguráció újratöltve",
        "config": {
            "axis_invert": driver_cfg.get('axis_invert'),
            "axis_scale": driver_cfg.get('axis_scale'),
            "axis_limits": driver_cfg.get('axis_limits'),
            "max_feed_rate": driver_cfg.get('max_feed_rate'),
            "dynamic_limits": driver_cfg.get('dynamic_limits'),
            "supports_panel_controller": driver_cfg.get('supports_panel_controller'),
            "reload_info": reload_info,
        }
    }


@app.post("/devices/{device_id}/teach/record")
async def teach_record(device_id: str):
    """Pozíció rögzítése teaching módhoz"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    pos = await device.teach_record_position()
    return {"success": True, "position": pos}


@app.post("/devices/{device_id}/teach/play")
async def teach_play(device_id: str):
    """Tanított pozíciók lejátszása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    result = await device.teach_play()
    return {"success": result}


@app.post("/devices/{device_id}/teach/clear")
async def teach_clear(device_id: str):
    """Tanított pozíciók törlése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    device.teach_clear()
    return {"success": True}


@app.get("/devices/{device_id}/teach/positions")
async def teach_positions(device_id: str):
    """Tanított pozíciók lekérdezése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(status_code=400, detail="Nem robotkar eszköz")
    positions = device.teach_get_positions()
    return {"positions": positions}


# =========================================
# BOARD DIAGNOSZTIKA
# =========================================

@app.post("/devices/{device_id}/diagnostics")
async def run_diagnostics(device_id: str, move_test: bool = False):
    """Board diagnosztika futtatása a meglévő serial kapcsolaton"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    metadata = device_manager.device_metadata.get(device_id)
    
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(
            status_code=400,
            detail="A diagnosztika jelenleg csak robotkar eszközökhöz érhető el."
        )

    # Szimulált robotkar esetén szimulált diagnosztikai riportot adunk
    if metadata and metadata.simulated:
        from board_diagnostics import DiagnosticsReport, TestResult
        from datetime import datetime
        report = DiagnosticsReport(
            timestamp=datetime.now().isoformat(),
            port="simulated",
            device_signature="SimulatedDevice",
            firmware_info="Szimulált firmware v1.0",
        )
        report.tests = [
            TestResult(name="Soros kapcsolat", passed=True, message="Szimulált kapcsolat – OK"),
            TestResult(name="Firmware verzió (M115)", passed=True, message="Szimulált firmware v1.0"),
            TestResult(name="Endstop állapot (M119)", passed=True, message="Endstopok: X=0 Y=0 Z=0 (szimulált)"),
            TestResult(name="Kalibrációs parancs (G92)", passed=True, message="Pozíció nullázva (szimulált)"),
            TestResult(name="Gripper szervó", passed=True, message="Szimulált gripper – OK"),
            TestResult(name="Szívópumpa (relé)", passed=True, message="Szimulált szívó – OK"),
            TestResult(name="Motor enable/disable", passed=True, message="Szimulált enable/disable – OK"),
            TestResult(name="Kommunikációs latencia", passed=True, message="Átlag: 1.0 ms (szimulált)", details={"avg_ms": 1.0, "min_ms": 1.0, "max_ms": 1.0, "samples": 5}),
            TestResult(name="Hibakezelés (ismeretlen parancs)", passed=True, message="Szimulált hibakezelés – OK"),
        ]
        report.total_tests = len(report.tests)
        report.passed_tests = report.total_tests
        report.failed_tests = 0
        report.skipped_tests = 0
        report.overall_passed = True
        return report.to_dict()
    
    # Valós eszköz – soros kapcsolat szükséges
    # Ha a serial halott (USB disconnect/reconnect után), megpróbáljuk újracsatlakoztatni
    if not device._serial or not device._serial.is_open:
        print(f"🔄 Serial kapcsolat nem él, újracsatlakozás próba ({device_id})...")
        reconnected = await device.reconnect()
        if not reconnected or not device._serial or not device._serial.is_open:
            raise HTTPException(
                status_code=400,
                detail="Nincs soros kapcsolat. Ellenőrizd, hogy a vezérlő csatlakoztatva van-e."
            )
        print(f"✅ Újracsatlakozás sikeres ({device_id})")
    
    from board_diagnostics import BoardDiagnostics
    
    # Jelezzük, hogy diagnosztika fut – get_status() ne próbáljon serial-on kommunikálni
    device._diagnostics_running = True
    
    # Állapot polling szüneteltetése a diagnosztika idejére
    device._stop_status_polling()
    # Várjunk, hogy az utolsó polling kérés befejeződjön
    await asyncio.sleep(1.5)
    
    diag = BoardDiagnostics(port=device.port, interactive=False)
    
    try:
        # Futtatás a meglévő serial kapcsolaton (szinkron, thread-ben)
        # A serial lock-ot is lefoglaljuk
        async with device._serial_lock:
            def _run():
                return diag.run_with_serial(device._serial, move_test=move_test)
            report = await asyncio.to_thread(_run)
    finally:
        # Diagnosztika flag törlése és polling újraindítása
        device._diagnostics_running = False
        device._start_status_polling()
    
    return report.to_dict()


# =========================================
# FIRMWARE PROBE
# =========================================

@app.post("/devices/{device_id}/firmware-probe")
async def run_firmware_probe(device_id: str):
    """Firmware paraméterek felderítése - különböző parancsok kipróbálása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    metadata = device_manager.device_metadata.get(device_id)
    
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(
            status_code=400,
            detail="A firmware felderítés jelenleg csak robotkar eszközökhöz érhető el."
        )

    if metadata and metadata.simulated:
        return {
            "timestamp": "",
            "port": "simulated",
            "firmware_type": "simulated",
            "recognized_commands": [],
            "unrecognized_commands": [],
            "all_results": [],
            "summary": {
                "total_commands": 0,
                "recognized": 0,
                "unrecognized": 0,
                "firmware_type": "simulated",
                "configurable_params": {},
            },
        }
    
    if not device._serial or not device._serial.is_open:
        reconnected = await device.reconnect()
        if not reconnected or not device._serial or not device._serial.is_open:
            raise HTTPException(
                status_code=400,
                detail="Nincs soros kapcsolat."
            )
    
    from firmware_probe import FirmwareProbe
    
    device._diagnostics_running = True
    device._stop_status_polling()
    await asyncio.sleep(1.5)
    
    stop_event = threading.Event()
    _active_test_events[device_id] = stop_event
    
    probe = FirmwareProbe(port=device.port)
    _active_test_progress[device_id] = probe._log_entries
    
    try:
        async with device._serial_lock:
            def _run():
                return probe.run_with_serial(device._serial, stop_event=stop_event)
            report = await asyncio.to_thread(_run)
    finally:
        _active_test_events.pop(device_id, None)
        _active_test_progress.pop(device_id, None)
        device._diagnostics_running = False
        device._start_status_polling()
    
    return report.to_dict()


# =========================================
# ENDSTOP TESZT
# =========================================

@app.post("/devices/{device_id}/endstop-test")
async def run_endstop_test(
    device_id: str,
    step_size: float = 5.0,
    speed: int = 15,
    max_angle: float = 200.0,
):
    """Végállás teszt - minden tengely végállásig mozgatása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    metadata = device_manager.device_metadata.get(device_id)
    
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(
            status_code=400,
            detail="A végállás teszt jelenleg csak robotkar eszközökhöz érhető el."
        )

    if metadata and metadata.simulated:
        return {
            "timestamp": "",
            "port": "simulated",
            "step_size": step_size,
            "speed": speed,
            "max_search_angle": max_angle,
            "axes": [],
            "completed": True,
            "error": None,
            "duration_seconds": 0.0,
        }
    
    if not device._serial or not device._serial.is_open:
        reconnected = await device.reconnect()
        if not reconnected or not device._serial or not device._serial.is_open:
            raise HTTPException(
                status_code=400,
                detail="Nincs soros kapcsolat."
            )
    
    from endstop_test import EndstopTest
    
    device._diagnostics_running = True
    device._stop_status_polling()
    await asyncio.sleep(1.5)
    
    stop_event = threading.Event()
    _active_test_events[device_id] = stop_event
    
    test = EndstopTest(
        port=device.port,
        step_size=step_size,
        speed=speed,
        max_search_angle=max_angle,
    )
    _active_test_progress[device_id] = test._log_entries
    
    try:
        async with device._serial_lock:
            def _run():
                return test.run_with_serial(device._serial, stop_event=stop_event)
            report = await asyncio.to_thread(_run)
    finally:
        _active_test_events.pop(device_id, None)
        _active_test_progress.pop(device_id, None)
        device._diagnostics_running = False
        device._start_status_polling()
    
    return report.to_dict()


# =========================================
# ENDSTOP ÁLLAPOT LEKÉRDEZÉS
# =========================================

@app.get("/devices/{device_id}/endstops")
async def get_endstop_states(device_id: str):
    """Végállás érzékelők aktuális állapotának lekérdezése (M119)"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    metadata = device_manager.device_metadata.get(device_id)
    
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(
            status_code=400,
            detail="A végállás állapot jelenleg csak robotkar eszközökhöz érhető el."
        )

    if metadata and metadata.simulated:
        return {"endstops": {"X": False, "Y": False, "Z": False}}
    
    if not device._connected:
        raise HTTPException(status_code=400, detail="Eszköz nincs csatlakozva")
    
    if device._diagnostics_running:
        raise HTTPException(status_code=409, detail="Diagnosztika fut")
    
    endstops = await device.check_endstops()
    return {"endstops": endstops}


# =========================================
# MOZGÁSTESZT
# =========================================

@app.post("/devices/{device_id}/motion-test")
async def run_motion_test(
    device_id: str,
    test_angle: float = 30.0,
):
    """Mozgásminőség teszt - különböző sebességekkel"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    metadata = device_manager.device_metadata.get(device_id)
    
    if not isinstance(device, RobotArmDevice):
        raise HTTPException(
            status_code=400,
            detail="A mozgásteszt jelenleg csak robotkar eszközökhöz érhető el."
        )

    if metadata and metadata.simulated:
        return {
            "timestamp": "",
            "port": "simulated",
            "test_angle": test_angle,
            "speeds_tested": [],
            "results": [],
            "recommended_speed": 50,
            "speed_summary": {},
            "completed": True,
            "error": None,
            "duration_seconds": 0.0,
        }
    
    if not device._serial or not device._serial.is_open:
        reconnected = await device.reconnect()
        if not reconnected or not device._serial or not device._serial.is_open:
            raise HTTPException(
                status_code=400,
                detail="Nincs soros kapcsolat."
            )
    
    from motion_test import MotionTest
    
    device._diagnostics_running = True
    device._stop_status_polling()
    await asyncio.sleep(1.5)
    
    stop_event = threading.Event()
    _active_test_events[device_id] = stop_event
    
    test = MotionTest(
        port=device.port,
        test_angle=test_angle,
    )
    _active_test_progress[device_id] = test._log_entries
    
    try:
        async with device._serial_lock:
            def _run():
                return test.run_with_serial(device._serial, stop_event=stop_event)
            report = await asyncio.to_thread(_run)
    finally:
        _active_test_events.pop(device_id, None)
        _active_test_progress.pop(device_id, None)
        device._diagnostics_running = False
        device._start_status_polling()
    
    return report.to_dict()


# =========================================
# TESZT LEÁLLÍTÁS
# =========================================

@app.post("/devices/{device_id}/cancel-test")
async def cancel_test(device_id: str):
    """Futó teszt (firmware-probe, endstop-test, motion-test) leállítása"""
    stop_event = _active_test_events.get(device_id)
    if stop_event is None:
        return {"success": False, "message": "Nincs futó teszt ezen az eszközön"}
    
    stop_event.set()
    return {"success": True, "message": "Leállítási jelzés elküldve"}


@app.get("/devices/{device_id}/test-progress")
async def get_test_progress(device_id: str, after: int = 0):
    """Futó teszt napló lekérdezése (polling). after = ennyi bejegyzést ugorjon át (incremental)"""
    log = _active_test_progress.get(device_id)
    if log is None:
        return {"entries": [], "total": 0, "running": False}
    
    entries = log[after:]  # Csak az új bejegyzések
    return {
        "entries": entries,
        "total": len(log),
        "running": device_id in _active_test_events,
    }


# =========================================
# GRBL SETTINGS
# =========================================

@app.get("/devices/{device_id}/grbl-settings")
async def get_grbl_settings(device_id: str):
    """GRBL beállítások lekérdezése ($$)"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    if not hasattr(device, 'get_grbl_settings'):
        raise HTTPException(status_code=400, detail="Device does not support GRBL settings")
    
    try:
        settings = await device.get_grbl_settings()
        return {"settings": settings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class GrblSettingRequest(BaseModel):
    setting: int
    value: float


@app.post("/devices/{device_id}/grbl-settings")
async def set_grbl_setting(device_id: str, request: GrblSettingRequest):
    """GRBL beállítás módosítása ($N=value)"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    if not hasattr(device, 'set_grbl_setting'):
        raise HTTPException(status_code=400, detail="Device does not support GRBL settings")
    
    try:
        success = await device.set_grbl_setting(request.setting, request.value)
        if success:
            return {"success": True, "message": f"${request.setting}={request.value} beállítva"}
        else:
            raise HTTPException(status_code=500, detail="Beállítás sikertelen")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class GrblSettingsBatchRequest(BaseModel):
    settings: Dict[int, float]


@app.post("/devices/{device_id}/grbl-settings/batch")
async def set_grbl_settings_batch(device_id: str, request: GrblSettingsBatchRequest):
    """Több GRBL beállítás módosítása egyszerre"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    if not hasattr(device, 'set_grbl_setting'):
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =========================================
# WEBSOCKET
# =========================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint valós idejű kommunikációhoz"""
    await websocket.accept()
    device_manager.register_ws_client(websocket)
    
    try:
        # Kezdeti állapot küldése
        for device_id, device in device_manager.devices.items():
            status = await device.get_status()
            await websocket.send_json({
                "type": "status",
                "device_id": device_id,
                "status": status.to_dict(),
            })
            control = device_manager.get_control_state(device_id)
            if control is not None:
                await websocket.send_json({
                    "type": "control_state",
                    "device_id": device_id,
                    "control": control,
                })
        
        # Üzenetek fogadása
        while True:
            try:
                data = await websocket.receive_json()
            except json.JSONDecodeError as e:
                # Handle invalid JSON - send error response but continue
                await websocket.send_json({
                    "type": "error",
                    "message": f"Invalid JSON: {str(e)}",
                })
                continue
            except ValueError as e:
                # Handle other value errors in JSON parsing
                await websocket.send_json({
                    "type": "error", 
                    "message": f"Parse error: {str(e)}",
                })
                continue
            
            # Parancs feldolgozás
            msg_type = data.get("type")
            device_id = data.get("device_id")
            
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
            
            elif msg_type == "get_status" and device_id:
                device = device_manager.get_device(device_id)
                if device:
                    status = await device.get_status()
                    await websocket.send_json({
                        "type": "status",
                        "device_id": device_id,
                        "status": status.to_dict(),
                    })
            
            elif msg_type == "jog" and device_id:
                device = device_manager.get_device(device_id)
                if device:
                    await device.jog(
                        data.get("axis", "X"),
                        data.get("distance", 1.0),
                        data.get("feed_rate", 1000),
                    )
            
            elif msg_type == "command" and device_id:
                device = device_manager.get_device(device_id)
                if device:
                    cmd = data.get("command")
                    if cmd == "run":
                        await device.run()
                    elif cmd == "pause":
                        await device.pause()
                    elif cmd == "resume":
                        await device.resume()
                    elif cmd == "stop":
                        await device.stop()
                    elif cmd == "home":
                        await device.home()
                    elif cmd == "reset":
                        await device.reset()
    
    except WebSocketDisconnect:
        device_manager.unregister_ws_client(websocket)
    except Exception as e:
        print(f"WebSocket hiba: {str(e)}")
        device_manager.unregister_ws_client(websocket)


# =========================================
# MAIN
# =========================================

def main():
    """Bridge szerver indítása"""
    import uvicorn
    
    host = os.environ.get('BRIDGE_HOST', '0.0.0.0')
    port = int(os.environ.get('BRIDGE_PORT', '4002'))
    
    print(f"Bridge szerver indítása: http://{host}:{port}")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
