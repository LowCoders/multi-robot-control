"""
Robot Arm Device Driver - 3 tengelyes robotkar GRBL firmware-rel
Multi-Robot Control System

Refaktorált verzió - GrblDeviceBase és capability mixinek használata.

Támogatott firmware-ek:
  - GRBL 0.9j (grbl4axis fork)
  - Eredeti AXIS4UI firmware (legacy mód)

GRBL protokoll:
  - Serial: 115200 baud, 8N1
  - Welcome: "Grbl 0.9j ['$' for help]"
  - Mozgás: "$J=G91 X{dist} F{speed}" (jog parancs)
  - Válasz: "ok" vagy "error:N"
  - Státusz: "?" -> "<Idle,MPos:0.000,0.000,0.000,WPos:0.000,0.000,0.000>"

Joint-GRBL tengely mapping:
  - J1 (bázis) -> Z tengely
  - J2 (váll)  -> X tengely
  - J3 (könyök) -> Y tengely
"""

import asyncio
import re
from typing import Optional, List, Dict, Any
from enum import Enum

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False

try:
    from grbl_base import GrblDeviceBase
    from capabilities import ClosedLoopCapability, TeachingCapability
    from base import (
        DeviceType,
        DeviceState,
        DeviceStatus,
        DeviceCapabilities,
        Position,
    )
except ImportError:
    from .grbl_base import GrblDeviceBase
    from .capabilities import ClosedLoopCapability, TeachingCapability
    from .base import (
        DeviceType,
        DeviceState,
        DeviceStatus,
        DeviceCapabilities,
        Position,
    )

# Kinematika modul importálása
try:
    from kinematics import (
        inverse_kinematics,
        forward_kinematics,
        RobotConfig,
        JointAngles,
        CartesianPosition,
        grbl_to_joints,
        joints_to_grbl,
    )
    KINEMATICS_AVAILABLE = True
except ImportError:
    KINEMATICS_AVAILABLE = False
    
    # Dummy classes for type hints when kinematics not available
    class RobotConfig:
        def __init__(self, L1=85.0, L2=140.0, L3=165.0):
            self.L1 = L1
            self.L2 = L2
            self.L3 = L3
    
    class JointAngles:
        def __init__(self, j1=0.0, j2=0.0, j3=0.0):
            self.j1 = j1
            self.j2 = j2
            self.j3 = j3
    
    class CartesianPosition:
        def __init__(self, x=0.0, y=0.0, z=0.0):
            self.x = x
            self.y = y
            self.z = z
    
    def forward_kinematics(j1, j2, j3, config):
        return CartesianPosition(0, 0, 0)
    
    def inverse_kinematics(x, y, z, config):
        return JointAngles(0, 0, 0)
    
    print("⚠️ kinematics modul nem elérhető - csak Joint mód használható")


class ControlMode(Enum):
    """Vezérlési módok"""
    JOINT = "joint"
    CARTESIAN = "cartesian"


class RobotArmDevice(GrblDeviceBase, ClosedLoopCapability, TeachingCapability):
    """
    3 tengelyes robotkar driver GRBL firmware-rel.
    
    A robotkar 3 forgó csuklóval rendelkezik (fokban mérve):
    - J1: Bázis forgás (függőleges tengely körül) -> GRBL Z
    - J2: Váll (vízszintes tengely körül) -> GRBL X
    - J3: Könyök (vízszintes tengely körül) -> GRBL Y
    
    Végeffektorok: gripper (szervóvezérelt megfogó), szívó (sucker)
    
    Használat:
        device = RobotArmDevice(
            device_id="robot_arm_1",
            device_name="Robot Kar",
            port="/dev/ttyUSB0",
        )
        await device.connect()
        
        # Joint mód (alapértelmezett)
        await device.jog('X', 10, 50)  # J2 (váll) +10 fok
    """
    
    # Legacy (AXIS4UI) válasz minták
    MOVE_RESPONSE_PATTERN = re.compile(
        r"INFO:\s*LINEAR\s*MOVE:\s*X(-?\d+\.?\d*)\s*Y(-?\d+\.?\d*)\s*Z(-?\d+\.?\d*)"
    )
    ENDSTOP_PATTERN = re.compile(
        r"INFO:\s*ENDSTOP:\s*\[X:(\d+)\s*Y:(\d+)\s*Z:(\d+)\]"
    )
    INFO_PATTERN = re.compile(r"^INFO:\s*(.+)$", re.IGNORECASE)
    ERROR_PATTERN = re.compile(r"^ERROR:\s*(.+)$", re.IGNORECASE)
    
    WELCOME_MSG = "Connected, please calibrate the mechanical coordinates"
    
    # Joint-GRBL tengely mapping
    JOINT_TO_GRBL = {'J1': 'Z', 'J2': 'X', 'J3': 'Y'}
    
    def __init__(
        self,
        device_id: str,
        device_name: str,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 2.0,
        robot_config=None,
        use_grbl: bool = True,
        axis_mapping: Dict[str, str] = None,
        axis_invert: Dict[str, bool] = None,
        axis_limits: Dict[str, list] = None,
        axis_scale: Dict[str, float] = None,
        max_feed_rate: float = None,
        closed_loop: Dict[str, Any] = None,
    ):
        # GrblDeviceBase inicializálás
        GrblDeviceBase.__init__(
            self,
            device_id=device_id,
            device_name=device_name,
            device_type=DeviceType.ROBOT_ARM,
            port=port,
            baudrate=baudrate,
            timeout=timeout,
            max_feed_rate=max_feed_rate if max_feed_rate else 100.0,
        )
        
        # ClosedLoopCapability inicializálás
        ClosedLoopCapability.__init__(self, closed_loop)
        
        # TeachingCapability inicializálás
        TeachingCapability.__init__(self)
        
        # GRBL mód flag (legacy támogatás)
        self._use_grbl = use_grbl
        
        # Robot konfiguráció (méretek az IK-hoz)
        if robot_config is None:
            self._robot_config = RobotConfig() if KINEMATICS_AVAILABLE else None
        elif isinstance(robot_config, dict):
            if KINEMATICS_AVAILABLE:
                self._robot_config = RobotConfig(
                    L1=robot_config.get('L1', 85.0),
                    L2=robot_config.get('L2', 140.0),
                    L3=robot_config.get('L3', 165.0),
                )
            else:
                self._robot_config = None
        else:
            self._robot_config = robot_config
        
        # Vezérlési mód
        self._control_mode = ControlMode.JOINT
        
        # Joint pozíció
        self._joint_position = JointAngles(j1=0, j2=0, j3=0) if KINEMATICS_AVAILABLE else None
        self._cartesian_position = CartesianPosition(x=0, y=0, z=0) if KINEMATICS_AVAILABLE else None
        
        # Szoftveres tengelylimitek (joint szögek, fokban)
        self._joint_limits = {
            'J1': (-180, 180),
            'J2': (-90, 90),
            'J3': (-135, 135),
        }
        
        # Legacy tengely mapping (AXIS4UI kompatibilitás)
        self._axis_map = axis_mapping if axis_mapping else {'X': 'X', 'Y': 'Y', 'Z': 'Z'}
        self._axis_map_reverse = {v: k for k, v in self._axis_map.items()}
        self._axis_invert = axis_invert if axis_invert else {}
        self._axis_scale = axis_scale if axis_scale else {}
        self._axis_limits: Dict[str, tuple] = {}
        if axis_limits:
            for axis, limits in axis_limits.items():
                if isinstance(limits, (list, tuple)) and len(limits) == 2:
                    self._axis_limits[axis] = (limits[0], limits[1])
        
        self._status_query_in_progress = False
        
        # Endstop állapot
        self._endstop_blocked: Dict[str, str] = {}
        
        # Robot állapot
        self._enabled = False
        self._calibrated = False
        self._gripper_state = "unknown"
        self._sucker_state = False
        self._current_speed = 50
        
        # Capabilities beállítása
        self._capabilities = DeviceCapabilities(
            axes=["X", "Y", "Z"],
            has_spindle=False,
            has_laser=False,
            has_coolant=False,
            has_probe=False,
            has_tool_changer=False,
            has_gripper=True,
            has_sucker=True,
            has_endstops=True,
            has_vacuum_pump=True,
            supports_motion_test=True,
            supports_firmware_probe=True,
            max_feed_rate=self._config_max_feed_rate,
            max_spindle_speed=0.0,
            max_laser_power=0.0,
            work_envelope={
                "x": 360.0,
                "y": 180.0,
                "z": 240.0,
            },
            axis_limits=self._axis_limits,
        )
    
    # =========================================
    # KAPCSOLAT KEZELÉS
    # =========================================
    
    async def connect(self) -> bool:
        """Robotkarhoz csatlakozás serial porton"""
        try:
            self._set_state(DeviceState.CONNECTING)
            
            # Serial port megnyitása
            if not await self._open_serial():
                raise ConnectionError(f"Nem sikerült megnyitni: {self.port}")
            
            # Várakozás az inicializálásra - iteratív polling
            welcome = ""
            start = asyncio.get_event_loop().time()
            while asyncio.get_event_loop().time() - start < 3.0:
                await asyncio.sleep(0.2)
                if self._serial.in_waiting:
                    chunk_bytes = await asyncio.to_thread(
                        self._serial.read, self._serial.in_waiting
                    )
                    welcome += chunk_bytes.decode(errors='replace')
                    if self.GRBL_WELCOME_PATTERN.search(welcome) or self.WELCOME_MSG in welcome:
                        break
            welcome = welcome.strip()
            
            # GRBL vagy legacy firmware detektálás
            grbl_match = self.GRBL_WELCOME_PATTERN.search(welcome)
            if grbl_match:
                self._use_grbl = True
                self._grbl_version = grbl_match.group(1)
                print(f"🤖 GRBL firmware detektálva: v{self._grbl_version}")
            elif self.WELCOME_MSG in welcome:
                self._use_grbl = False
                print(f"🤖 Legacy firmware (AXIS4UI): {welcome}")
            else:
                print(f"🤖 Firmware válasz: {repr(welcome)}")
            
            self._connected = True
            self._set_state(DeviceState.IDLE)
            
            if self._use_grbl:
                # GRBL: státusz lekérdezés és pozíció szinkronizálás
                status = await self.get_grbl_status()
                if status:
                    grbl_state = status.get('state', 'unknown')
                    base_state = grbl_state.split(':')[0]
                    print(f"🤖 GRBL státusz: {grbl_state}")
                    
                    # Auto-unlock Door/Alarm állapotban
                    if base_state in ('Door', 'Alarm'):
                        print(f"🤖 {grbl_state} állapot - automatikus unlock...")
                        if await self._grbl_unlock():
                            status = await self.get_grbl_status()
                            new_state = status.get('state', 'unknown') if status else 'unknown'
                            print(f"🤖 Unlock után: {new_state}")
                    
                    # Joint pozíció kiírása
                    wpos = status.get('wpos')
                    if wpos and KINEMATICS_AVAILABLE:
                        j1, j2, j3 = wpos.z, wpos.x, wpos.y
                        print(f"🤖 Joint pozíció: J1={j1:.1f}° J2={j2:.1f}° J3={j3:.1f}°")
                
                self._calibrated = True
            else:
                # Legacy: G92-vel nullázzuk a firmware pozícióját
                await self._send_command_no_response("G92 X0 Y0 Z0")
                await asyncio.sleep(0.3)
                self._status.position = Position(x=0.0, y=0.0, z=0.0)
                self._status.work_position = Position(x=0.0, y=0.0, z=0.0)
                self._calibrated = True
            
            # Állapot frissítése
            self._status.gripper_state = self._gripper_state
            self._status.sucker_state = self._sucker_state
            
            # Állapot polling indítása
            self._start_status_polling(interval=0.2)
            
            print(f"🤖 Robotkar csatlakozva: {self.device_name} ({self.port})")
            return True
            
        except Exception as e:
            self._set_error(f"Csatlakozási hiba: {str(e)}")
            await self.disconnect()
            return False
    
    async def disconnect(self) -> None:
        """Kapcsolat bontása"""
        self._stop_status_polling()
        await self._close_serial()
        self._connected = False
        self._enabled = False
        self._set_state(DeviceState.DISCONNECTED)
    
    async def reconnect(self) -> bool:
        """Újracsatlakozás"""
        await self.disconnect()
        await asyncio.sleep(1.0)
        return await self.connect()
    
    # =========================================
    # TENGELY MAPPING (Legacy kompatibilitás)
    # =========================================
    
    def _clamp_to_limits(self, x: float, y: float, z: float) -> tuple:
        """Logikai pozíciók clampolása a konfigurált limitek közé."""
        clamped = {}
        
        if 'X' in self._axis_limits:
            lo, hi = self._axis_limits['X']
            if x < lo:
                x = lo
                clamped['X'] = True
            elif x > hi:
                x = hi
                clamped['X'] = True
        
        if 'Y' in self._axis_limits:
            lo, hi = self._axis_limits['Y']
            if y < lo:
                y = lo
                clamped['Y'] = True
            elif y > hi:
                y = hi
                clamped['Y'] = True
        
        if 'Z' in self._axis_limits:
            lo, hi = self._axis_limits['Z']
            if z < lo:
                z = lo
                clamped['Z'] = True
            elif z > hi:
                z = hi
                clamped['Z'] = True
        
        return (x, y, z, clamped)
    
    # =========================================
    # GRBL STÁTUSZ (robot-specifikus override)
    # =========================================
    
    async def get_grbl_status(self) -> Dict[str, Any]:
        """GRBL státusz lekérdezése robot-specifikus feldolgozással"""
        if not self._use_grbl:
            return {}
        
        try:
            # Base class metódus hívása
            status = await super().get_grbl_status()
            
            if status:
                wpos = status.get('wpos')
                if wpos:
                    # GRBL -> Joint konverzió
                    j1 = wpos.z  # Bázis
                    j2 = wpos.x  # Váll
                    j3 = wpos.y  # Könyök
                    
                    if KINEMATICS_AVAILABLE:
                        self._joint_position = JointAngles(j1=j1, j2=j2, j3=j3)
                        self._cartesian_position = forward_kinematics(j1, j2, j3, self._robot_config)
                    
                    # Kiterjesztett visszatérési érték
                    status['joints'] = {'j1': j1, 'j2': j2, 'j3': j3}
                    if KINEMATICS_AVAILABLE and self._cartesian_position:
                        status['cartesian'] = {
                            'x': self._cartesian_position.x,
                            'y': self._cartesian_position.y,
                            'z': self._cartesian_position.z,
                        }
            
            return status
            
        except Exception as e:
            print(f"🤖 GRBL státusz hiba: {e}")
            return {}
    
    # =========================================
    # ÁLLAPOT LEKÉRDEZÉS
    # =========================================
    
    async def get_status(self) -> DeviceStatus:
        """Aktuális állapot lekérdezése"""
        self._status.gripper_state = self._gripper_state
        self._status.sucker_state = self._sucker_state
        
        if self._connected and self.is_serial_open:
            if self._status_query_in_progress:
                return self._status
            
            self._status_query_in_progress = True
            try:
                await self.get_grbl_status()
            except Exception:
                pass
            finally:
                self._status_query_in_progress = False
        
        return self._status
    
    async def get_capabilities(self) -> DeviceCapabilities:
        """Eszköz képességek lekérdezése"""
        return self._capabilities
    
    # =========================================
    # ROBOT ENGEDÉLYEZÉS
    # =========================================
    
    async def enable(self) -> bool:
        """Robot motorok engedélyezése"""
        try:
            await self._send_command("M17")
            self._enabled = True
            print(f"🤖 Robot engedélyezve")
            return True
        except Exception as e:
            self._set_error(f"Enable hiba: {str(e)}")
            return False
    
    async def disable(self) -> bool:
        """Robot motorok letiltása"""
        try:
            await self._send_command("M84")
            self._enabled = False
            print(f"🤖 Robot letiltva")
            return True
        except Exception as e:
            self._set_error(f"Disable hiba: {str(e)}")
            return False
    
    # =========================================
    # MOZGÁS VEZÉRLÉS
    # =========================================
    
    async def home(self, axes: Optional[List[str]] = None) -> bool:
        """Alaphelyzetbe állítás - nullára mozgatás"""
        try:
            self._set_state(DeviceState.HOMING)
            response = await self._send_command("G1 X0 Y0 Z0 F50")
            
            if self.ERROR_PATTERN.search(response):
                self._set_error(f"Homing hiba: {response}")
                return False
            
            self._set_state(DeviceState.IDLE)
            return True
                
        except Exception as e:
            self._set_error(f"Homing hiba: {str(e)}")
            return False
    
    async def jog(
        self,
        axis: str,
        distance: float,
        feed_rate: float,
    ) -> bool:
        """
        Jog mozgás - GRBL $J= jog paranccsal.
        
        axis: 'X', 'Y' vagy 'Z' (J1, J2, J3)
        distance: szög fokban (negatív = ellenkező irány)
        feed_rate: sebesség (1-100 skála)
        """
        try:
            axis = axis.upper()
            if axis not in ["X", "Y", "Z"]:
                return False
            
            # Feed rate: 1-100 skála -> tényleges fok/perc
            speed_percent = max(1, min(100, int(feed_rate)))
            actual_feed_rate = (speed_percent / 100.0) * self._config_max_feed_rate
            
            # Szoftveres limit ellenőrzés
            current = self._status.position
            target_x = current.x + (distance if axis == "X" else 0)
            target_y = current.y + (distance if axis == "Y" else 0)
            target_z = current.z + (distance if axis == "Z" else 0)
            
            clamped_x, clamped_y, clamped_z, clamped = self._clamp_to_limits(
                target_x, target_y, target_z
            )
            
            # Tényleges távolság a limit után
            if axis == "X":
                actual_distance = clamped_x - current.x
            elif axis == "Y":
                actual_distance = clamped_y - current.y
            else:
                actual_distance = clamped_z - current.z
            
            if clamped:
                print(f"🤖 Limit clamp: {clamped} (distance: {distance:.1f} -> {actual_distance:.1f})")
            
            if abs(actual_distance) < 0.001:
                return True
            
            # Tengely mapping
            fw_axis = self._axis_map.get(axis, axis)
            
            # Invertálás ha szükséges
            if self._axis_invert.get(axis, False):
                actual_distance = -actual_distance
            
            # GRBL $J= jog parancs
            cmd = f"$J=G91 {fw_axis}{actual_distance:.2f} F{actual_feed_rate:.0f}"
            response = await self._send_command(cmd)
            
            if self.ERROR_PATTERN.search(response):
                return False
            
            return True
            
        except Exception as e:
            self._set_error(f"Jog hiba: {str(e)}")
            return False
    
    async def jog_stop(self) -> bool:
        """Jog mozgás azonnali leállítása"""
        self._jog_stopping = True
        async with self._jog_lock:
            try:
                if not self.is_serial_open:
                    self._jog_stopping = False
                    return False
                
                # Feed hold - $J= parancsokkal elég a feed hold
                await self._grbl_feed_hold()
                await asyncio.sleep(0.05)
                
                self._set_state(DeviceState.IDLE)
                self._jog_stopping = False
                return True
                
            except Exception:
                self._jog_stopping = False
                return False
    
    async def move_to(self, x: float, y: float, z: float, speed: float = 50) -> bool:
        """Abszolút pozícióra mozgás"""
        try:
            # Limitek alkalmazása
            clamped_x, clamped_y, clamped_z, _ = self._clamp_to_limits(x, y, z)
            
            # Tengely mapping
            fw_x = self._axis_map.get('X', 'X')
            fw_y = self._axis_map.get('Y', 'Y')
            fw_z = self._axis_map.get('Z', 'Z')
            
            cmd = f"G1 {fw_x}{clamped_x:.2f} {fw_y}{clamped_y:.2f} {fw_z}{clamped_z:.2f} F{speed:.0f}"
            response = await self._send_command(cmd)
            
            if self.ERROR_PATTERN.search(response):
                return False
            
            return True
            
        except Exception as e:
            self._set_error(f"Move hiba: {str(e)}")
            return False
    
    # =========================================
    # JOINT/CARTESIAN VEZÉRLÉS
    # =========================================
    
    async def set_control_mode(self, mode: ControlMode) -> bool:
        """Vezérlési mód váltása"""
        if mode == ControlMode.CARTESIAN and not KINEMATICS_AVAILABLE:
            print("🤖 Cartesian mód nem elérhető - kinematics modul hiányzik")
            return False
        
        self._control_mode = mode
        print(f"🤖 Vezérlési mód: {mode.value}")
        return True
    
    def get_control_mode(self) -> ControlMode:
        """Aktuális vezérlési mód"""
        return self._control_mode
    
    async def move_to_joints(self, j1: float, j2: float, j3: float, speed: float = 500) -> bool:
        """Joint pozícióra mozgás"""
        try:
            # Joint limitek
            j1 = max(self._joint_limits['J1'][0], min(self._joint_limits['J1'][1], j1))
            j2 = max(self._joint_limits['J2'][0], min(self._joint_limits['J2'][1], j2))
            j3 = max(self._joint_limits['J3'][0], min(self._joint_limits['J3'][1], j3))
            
            # Joint -> GRBL
            grbl_x = j2
            grbl_y = j3
            grbl_z = j1
            
            cmd = f"G1 X{grbl_x:.2f} Y{grbl_y:.2f} Z{grbl_z:.2f} F{speed:.0f}"
            response = await self._send_command(cmd)
            
            if self._use_grbl:
                if self.GRBL_ERROR_PATTERN.search(response):
                    return False
            else:
                if self.ERROR_PATTERN.search(response):
                    return False
            
            # Pozíció frissítése
            if KINEMATICS_AVAILABLE:
                self._joint_position = JointAngles(j1=j1, j2=j2, j3=j3)
                self._cartesian_position = forward_kinematics(j1, j2, j3, self._robot_config)
            
            return True
            
        except Exception as e:
            self._set_error(f"Move joints hiba: {str(e)}")
            return False
    
    async def move_to_xyz(self, x: float, y: float, z: float, speed: float = 500) -> bool:
        """Cartesian pozícióra mozgás (IK-val)"""
        if not KINEMATICS_AVAILABLE:
            print("🤖 Cartesian mód nem elérhető - kinematics modul hiányzik")
            return False
        
        try:
            angles = inverse_kinematics(x, y, z, self._robot_config)
            
            if not angles.valid:
                print(f"🤖 IK hiba: pozíció nem elérhető ({x:.1f}, {y:.1f}, {z:.1f})")
                return False
            
            return await self.move_to_joints(angles.j1, angles.j2, angles.j3, speed)
            
        except Exception as e:
            self._set_error(f"Move XYZ hiba: {str(e)}")
            return False
    
    async def jog_joint(self, joint: str, distance: float, speed: float = 500) -> bool:
        """Joint relatív mozgatása"""
        joint = joint.upper()
        grbl_axis = self.JOINT_TO_GRBL.get(joint)
        if not grbl_axis:
            return False
        
        async with self._jog_lock:
            cmd = f"$J=G91 {grbl_axis}{distance:.2f} F{speed:.0f}"
            response = await self._send_command(cmd)
            
            if self.GRBL_ERROR_PATTERN.search(response):
                return False
            
            return True
    
    async def jog_cartesian(self, axis: str, distance: float, speed: float = 500) -> bool:
        """Cartesian tengely relatív mozgatása"""
        if not KINEMATICS_AVAILABLE:
            return False
        
        axis = axis.upper()
        if axis not in ['X', 'Y', 'Z']:
            return False
        
        async with self._jog_lock:
            await self.get_grbl_status()
            
            j1 = self._status.position.z
            j2 = self._status.position.x
            j3 = self._status.position.y
            pos = forward_kinematics(j1, j2, j3, self._robot_config)
            x, y, z = pos.x, pos.y, pos.z
            
            if axis == 'X':
                x += distance
            elif axis == 'Y':
                y += distance
            elif axis == 'Z':
                z += distance
            
            return await self.move_to_xyz(x, y, z, speed)
    
    # =========================================
    # GRBL BEÁLLÍTÁSOK
    # =========================================
    
    async def get_grbl_settings(self) -> Dict[int, float]:
        """GRBL beállítások lekérdezése"""
        if not self._use_grbl:
            return {}
        return await super().get_grbl_settings()
    
    async def set_grbl_setting(self, setting: int, value: float) -> bool:
        """GRBL beállítás módosítása"""
        if not self._use_grbl:
            return False
        return await super().set_grbl_setting(setting, value)
    
    def get_joint_position(self) -> Optional[JointAngles]:
        """Aktuális joint pozíció"""
        return self._joint_position
    
    def get_cartesian_position(self) -> Optional[CartesianPosition]:
        """Aktuális Cartesian pozíció"""
        return self._cartesian_position
    
    def get_robot_config(self) -> RobotConfig:
        """Robot konfiguráció"""
        return self._robot_config
    
    # =========================================
    # VÉGEFFEKTOR VEZÉRLÉS
    # =========================================
    
    async def gripper_on(self) -> bool:
        """Megfogó bezárása"""
        try:
            await self._send_command("M3 S90")
            self._gripper_state = "closed"
            self._status.gripper_state = "closed"
            print(f"🤖 Gripper: bezárva")
            return True
        except Exception as e:
            self._set_error(f"Gripper hiba: {str(e)}")
            return False
    
    async def gripper_off(self) -> bool:
        """Megfogó nyitása"""
        try:
            await self._send_command("M3 S0")
            self._gripper_state = "open"
            self._status.gripper_state = "open"
            print(f"🤖 Gripper: nyitva")
            return True
        except Exception as e:
            self._set_error(f"Gripper hiba: {str(e)}")
            return False
    
    async def sucker_on(self) -> bool:
        """Szívó bekapcsolása"""
        try:
            await self._send_command("M10")
            self._sucker_state = True
            self._status.sucker_state = True
            print(f"🤖 Szívó: bekapcsolva")
            return True
        except Exception as e:
            self._set_error(f"Szívó hiba: {str(e)}")
            return False
    
    async def sucker_off(self) -> bool:
        """Szívó kikapcsolása"""
        try:
            await self._send_command("M11")
            self._sucker_state = False
            self._status.sucker_state = False
            print(f"🤖 Szívó: kikapcsolva")
            return True
        except Exception as e:
            self._set_error(f"Szívó hiba: {str(e)}")
            return False
    
    # =========================================
    # KALIBRÁCIÓ
    # =========================================
    
    async def calibrate(self) -> bool:
        """Robot kalibráció - nullára mozgatás és pozíció reset"""
        try:
            self._set_state(DeviceState.HOMING)
            print(f"🤖 Kalibráció indítása...")
            
            response = await self._send_command("G92 X0 Y0 Z0")
            await asyncio.sleep(0.5)
            
            self._status.position = Position(x=0.0, y=0.0, z=0.0)
            self._status.work_position = Position(x=0.0, y=0.0, z=0.0)
            self._calibrated = True
            
            self._set_state(DeviceState.IDLE)
            print(f"🤖 Kalibráció kész")
            return True
                
        except Exception as e:
            self._set_error(f"Kalibráció hiba: {str(e)}")
            return False
    
    # =========================================
    # G-CODE KÜLDÉS
    # =========================================
    
    async def send_gcode(self, gcode: str) -> str:
        """Egyedi G-code parancs küldése"""
        try:
            response = await self._send_command(gcode)
            
            if self._use_grbl:
                error_match = self.GRBL_ERROR_PATTERN.search(response)
                if error_match:
                    error_code = int(error_match.group(1))
                    return f"error: {self.get_grbl_error_message(error_code)}"
            
            return response
            
        except Exception as e:
            return f"error: {str(e)}"
    
    async def load_file(self, filepath: str) -> bool:
        """G-code fájl betöltése"""
        try:
            with open(filepath, "r") as f:
                lines = f.readlines()
            
            self._gcode_lines = []
            for line in lines:
                line = line.strip()
                if ";" in line:
                    line = line.split(";")[0].strip()
                if "(" in line:
                    line = re.sub(r"\([^)]*\)", "", line).strip()
                if line:
                    self._gcode_lines.append(line)
            
            self._current_line_index = 0
            self._status.current_file = filepath
            self._status.total_lines = len(self._gcode_lines)
            self._status.current_line = 0
            self._status.progress = 0.0
            
            print(f"🤖 Program betöltve: {filepath} ({len(self._gcode_lines)} sor)")
            return True
            
        except Exception as e:
            self._set_error(f"Fájl betöltési hiba: {str(e)}")
            return False
    
    async def run(self, from_line: int = 0) -> bool:
        """Program futtatás indítása"""
        if not self._gcode_lines:
            return False
        
        if self._run_task and not self._run_task.done():
            self._run_task.cancel()
            try:
                await self._run_task
            except asyncio.CancelledError:
                pass
        
        self._current_line_index = from_line
        self._running = True
        self._paused = False
        
        self._run_task = asyncio.create_task(self._run_program())
        return True
    
    async def _run_program(self) -> None:
        """Program futtatás loop"""
        self._set_state(DeviceState.RUNNING)
        total_lines = len(self._gcode_lines)
        
        while self._running and self._current_line_index < total_lines:
            while self._paused:
                await asyncio.sleep(0.1)
                if not self._running:
                    break
            
            if not self._running:
                break
            
            line = self._gcode_lines[self._current_line_index]
            response = await self._send_command(line)
            
            if self.ERROR_PATTERN.search(response):
                error_msg = response.strip()
                if "COMMAND NOT RECOGNIZED" in response:
                    print(f"🤖 Átugorva (sor {self._current_line_index + 1}): {line}")
                else:
                    self._set_error(f"G-code hiba (sor {self._current_line_index + 1}): {error_msg}")
                    self._running = False
                    break
            
            await asyncio.sleep(0.1)
            
            self._current_line_index += 1
            self._status.current_line = self._current_line_index
            if total_lines > 0:
                self._status.progress = (self._current_line_index / total_lines) * 100
            else:
                self._status.progress = 100.0
            
            if self.on_job_progress:
                self.on_job_progress(
                    self._status.progress,
                    self._current_line_index,
                    total_lines,
                )
        
        if self._current_line_index >= total_lines:
            self._status.progress = 100.0
            if self.on_job_complete:
                self.on_job_complete(self._status.current_file or "")
        
        self._running = False
        self._run_task = None
        self._set_state(DeviceState.IDLE)
    
    async def pause(self) -> bool:
        """Program megállítása"""
        try:
            await self._grbl_feed_hold()
            self._paused = True
            self._set_state(DeviceState.PAUSED)
            return True
        except Exception:
            return False
    
    async def resume(self) -> bool:
        """Program folytatása"""
        try:
            await self._grbl_cycle_start()
            self._paused = False
            self._set_state(DeviceState.RUNNING)
            return True
        except Exception:
            return False
    
    async def stop(self) -> bool:
        """Program leállítása"""
        try:
            self._running = False
            self._paused = False
            
            if self._run_task and not self._run_task.done():
                self._run_task.cancel()
            
            await self._grbl_soft_reset()
            
            self._set_state(DeviceState.IDLE)
            return True
        except Exception:
            return False
    
    async def reset(self) -> bool:
        """Alarm törlése, eszköz reset"""
        try:
            success = await self._grbl_unlock()
            if success:
                self._status.error_message = None
                self._set_state(DeviceState.IDLE)
            return success
        except Exception as e:
            self._set_error(f"Reset hiba: {str(e)}")
            return False
    
    # =========================================
    # SEGÉD FUNKCIÓK
    # =========================================
    
    def get_info(self) -> Dict[str, Any]:
        """Eszköz információk lekérdezése"""
        return {
            "id": self.device_id,
            "name": self.device_name,
            "type": self.device_type.value,
            "connected": self._connected,
            "state": self._status.state.value,
            "grbl_version": self._grbl_version,
            "use_grbl": self._use_grbl,
            "control_mode": self._control_mode.value,
            "enabled": self._enabled,
            "calibrated": self._calibrated,
            "gripper_state": self._gripper_state,
            "sucker_state": self._sucker_state,
            "taught_positions": self.teach_get_count(),
            "closed_loop": self._closed_loop_enabled,
            "port": self.port,
        }
