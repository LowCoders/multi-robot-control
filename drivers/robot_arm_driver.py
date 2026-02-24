"""
Robot Arm Device Driver - 3 tengelyes robotkar GRBL firmware-rel
Multi-Robot Control System

Támogatott firmware-ek:
  - GRBL 0.9j (grbl4axis fork)
  - Eredeti AXIS4UI firmware (legacy mód)

GRBL protokoll:
  - Serial: 115200 baud, 8N1
  - Welcome: "Grbl 0.9j ['$' for help]"
  - Mozgás: "G1 X{j2} Y{j3} Z{j1} F{speed}" (joint szögek fokban)
  - Válasz: "ok" vagy "error:N"
  - Státusz: "?" -> "<Idle,MPos:0.000,0.000,0.000,WPos:0.000,0.000,0.000>"
  - Beállítások: "$$" -> "$100=80.000 (x, step/mm)" stb.

Joint-GRBL tengely mapping:
  - J1 (bázis) -> Z tengely
  - J2 (váll)  -> X tengely
  - J3 (könyök) -> Y tengely

Vezérlési módok:
  - Joint mód: közvetlen joint szög vezérlés
  - Cartesian mód: X,Y,Z koordináták -> IK -> joint szögek
"""

import asyncio
import re
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from enum import Enum

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False

from base import (
    DeviceDriver,
    JogSafeDeviceDriver,
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
    print("⚠️ kinematics modul nem elérhető - csak Joint mód használható")


class ControlMode(Enum):
    """Vezérlési módok"""
    JOINT = "joint"           # Közvetlen joint szög vezérlés
    CARTESIAN = "cartesian"   # X,Y,Z koordináták IK-val


class RobotArmDevice(JogSafeDeviceDriver):
    """
    3 tengelyes robotkar driver GRBL firmware-rel.
    
    A robotkar 3 forgó csuklóval rendelkezik (fokban mérve):
    - J1: Bázis forgás (függőleges tengely körül) -> GRBL Z
    - J2: Váll (vízszintes tengely körül) -> GRBL X
    - J3: Könyök (vízszintes tengely körül) -> GRBL Y
    
    Végeffektorok: gripper (szervóvezérelt megfogó), szívó (sucker)
    
    Vezérlési módok:
    - Joint mód: közvetlen joint szög vezérlés (j1, j2, j3 fokban)
    - Cartesian mód: X,Y,Z koordináták mm-ben -> IK -> joint szögek
    
    Használat:
        device = RobotArmDevice(
            device_id="robot_arm_1",
            device_name="Robot Kar",
            port="/dev/ttyUSB0",
        )
        await device.connect()
        
        # Joint mód (alapértelmezett)
        await device.jog('X', 10, 50)  # J2 (váll) +10 fok
        
        # Cartesian mód
        await device.set_control_mode(ControlMode.CARTESIAN)
        await device.move_to_xyz(200, 0, 150, speed=50)
    """
    
    # GRBL válasz minták
    GRBL_OK_PATTERN = re.compile(r"^ok$", re.IGNORECASE)
    GRBL_ERROR_PATTERN = re.compile(r"^error:(\d+)$", re.IGNORECASE)
    # WPos-t olvassuk (Work Position), nem MPos-t, mert a G92 a WPos-t nullázza
    GRBL_STATUS_PATTERN = re.compile(
        r"<(\w+),MPos:[^,]*,[^,]*,[^,]*,[^,]*,WPos:(-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*)"
    )
    GRBL_WELCOME_PATTERN = re.compile(r"Grbl\s+(\d+\.\d+\w*)")
    
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
    
    def __init__(
        self,
        device_id: str,
        device_name: str,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 2.0,
        robot_config = None,
        use_grbl: bool = True,
        axis_mapping: Dict[str, str] = None,
        axis_invert: Dict[str, bool] = None,
        axis_limits: Dict[str, list] = None,
        axis_scale: Dict[str, float] = None,
        max_feed_rate: float = None,
    ):
        super().__init__(device_id, device_name, DeviceType.ROBOT_ARM)
        
        if not SERIAL_AVAILABLE:
            raise ImportError("pyserial csomag szükséges: pip install pyserial")
        
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self._config_max_feed_rate = max_feed_rate if max_feed_rate else 100.0
        
        # GRBL mód flag
        self._use_grbl = use_grbl
        self._grbl_version = None
        
        # Robot konfiguráció (méretek az IK-hoz)
        # Elfogadunk RobotConfig objektumot vagy dict-et (YAML config-ból)
        if robot_config is None:
            self._robot_config = RobotConfig()
        elif isinstance(robot_config, dict):
            self._robot_config = RobotConfig(
                L1=robot_config.get('L1', 85.0),
                L2=robot_config.get('L2', 140.0),
                L3=robot_config.get('L3', 165.0),
            )
        else:
            self._robot_config = robot_config
        
        # Vezérlési mód
        self._control_mode = ControlMode.JOINT
        
        # Joint pozíció (j1, j2, j3 fokban) - a GRBL X,Y,Z-ből számolva
        self._joint_position = JointAngles(j1=0, j2=0, j3=0) if KINEMATICS_AVAILABLE else None
        
        # Cartesian pozíció (FK-ból számolva)
        self._cartesian_position = CartesianPosition(x=0, y=0, z=0) if KINEMATICS_AVAILABLE else None
        
        # Tengely mapping: GRBL -> Joint
        # GRBL X = J2 (váll), GRBL Y = J3 (könyök), GRBL Z = J1 (bázis)
        # Nem konfigurálható - fix a firmware bekötés alapján
        self._grbl_to_joint = {'X': 'J2', 'Y': 'J3', 'Z': 'J1'}
        self._joint_to_grbl = {'J1': 'Z', 'J2': 'X', 'J3': 'Y'}
        
        # Szoftveres tengelylimitek (joint szögek, fokban)
        self._joint_limits = {
            'J1': (-180, 180),  # Bázis forgás
            'J2': (-90, 90),    # Váll
            'J3': (-135, 135),  # Könyök
        }
        
        # Legacy tengely mapping (AXIS4UI kompatibilitás) - konfigurálható
        self._axis_map = axis_mapping if axis_mapping else {'X': 'X', 'Y': 'Y', 'Z': 'Z'}
        self._axis_map_reverse = {v: k for k, v in self._axis_map.items()}
        self._axis_invert = axis_invert if axis_invert else {}
        self._axis_scale = axis_scale if axis_scale else {}
        self._axis_limits: Dict[str, tuple] = {}
        if axis_limits:
            for axis, limits in axis_limits.items():
                if isinstance(limits, (list, tuple)) and len(limits) == 2:
                    self._axis_limits[axis] = (limits[0], limits[1])
        
        self._serial: Optional[serial.Serial] = None
        self._serial_lock = asyncio.Lock()
        # _jog_lock az ősosztályból (JogSafeDeviceDriver) öröklődik
        self._status_polling = False
        self._poll_task: Optional[asyncio.Task] = None
        self._run_task: Optional[asyncio.Task] = None
        self._diagnostics_running = False
        
        # Endstop állapot: tengely -> blokkolt irány ('positive' vagy 'negative')
        # Pl. {'Y': 'positive'} ha az Y tengely pozitív végállása aktív
        self._endstop_blocked: Dict[str, str] = {}
        
        # Robot állapot
        self._enabled = False
        self._calibrated = False
        self._gripper_state = "unknown"  # 'open' | 'closed' | 'unknown'
        self._sucker_state = False
        self._current_speed = 50  # Aktuális sebesség (1-100)
        
        # G-code fájl kezelés
        self._gcode_lines: List[str] = []
        self._current_line_index: int = 0
        self._running: bool = False
        self._paused: bool = False
        
        # Teaching mód - rögzített pozíciók
        self._taught_positions: List[Dict[str, Any]] = []
        
        # Capabilities beállítása
        self._capabilities = DeviceCapabilities(
            axes=["X", "Y", "Z"],  # J1=X, J2=Y, J3=Z mapping
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
                "x": 360.0,   # J1: ±180 fok
                "y": 180.0,   # J2: ±90 fok
                "z": 240.0,   # J3: ±120 fok
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
            
            # Soros port megnyitása
            def open_serial():
                return serial.Serial(
                    port=self.port,
                    baudrate=self.baudrate,
                    timeout=self.timeout,
                    write_timeout=self.timeout,
                )
            
            self._serial = await asyncio.to_thread(open_serial)
            
            # Várakozás az inicializálásra
            await asyncio.sleep(2.5)
            
            # Buffer olvasás - welcome message ellenőrzés
            welcome = ""
            if self._serial.in_waiting:
                welcome_bytes = await asyncio.to_thread(
                    self._serial.read, self._serial.in_waiting
                )
                welcome = welcome_bytes.decode(errors='replace').strip()
            
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
                # Próbáljuk GRBL-ként kezelni
                print(f"🤖 Firmware válasz: {repr(welcome)}")
            
            self._connected = True
            self._set_state(DeviceState.IDLE)
            
            if self._use_grbl:
                # GRBL: státusz lekérdezés és pozíció szinkronizálás
                status = await self.get_grbl_status()
                if status:
                    print(f"🤖 GRBL státusz: {status.get('state', 'unknown')}")
                    if KINEMATICS_AVAILABLE:
                        print(f"🤖 Joint pozíció: J1={status['joints']['j1']:.1f}° "
                              f"J2={status['joints']['j2']:.1f}° J3={status['joints']['j3']:.1f}°")
                        if status.get('cartesian'):
                            print(f"🤖 Cartesian: X={status['cartesian']['x']:.1f}mm "
                                  f"Y={status['cartesian']['y']:.1f}mm Z={status['cartesian']['z']:.1f}mm")
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
            self._start_status_polling()
            
            print(f"🤖 Robotkar csatlakozva: {self.device_name} ({self.port})")
            return True
            
        except Exception as e:
            self._set_error(f"Csatlakozási hiba: {str(e)}")
            await self.disconnect()
            return False
    
    async def disconnect(self) -> None:
        """Kapcsolat bontása"""
        self._stop_status_polling()
        
        if self._serial and self._serial.is_open:
            try:
                self._serial.close()
            except Exception:
                pass
        
        self._serial = None
        self._connected = False
        self._enabled = False
        self._set_state(DeviceState.DISCONNECTED)
    
    async def reconnect(self) -> bool:
        """Újracsatlakozás - régi serial bezárása és újranyitás.
        
        Hasznos USB disconnect/reconnect után, amikor a serial handle
        érvénytelenné válik de a port újra elérhető.
        """
        print(f"🤖 Újracsatlakozás: {self.device_name} ({self.port})...")
        self._stop_status_polling()
        
        # Régi serial bezárása (hibaálló)
        if self._serial:
            try:
                self._serial.close()
            except Exception:
                pass
            self._serial = None
        
        self._connected = False
        
        # Újracsatlakozás
        return await self.connect()
    
    # =========================================
    # TENGELY MAPPING
    # =========================================
    
    def _apply_invert(self, x: float, y: float, z: float) -> tuple:
        """Invertálás alkalmazása a logikai tengelyekre (kimenő irány)."""
        if self._axis_invert.get('X'):
            x = -x
        if self._axis_invert.get('Y'):
            y = -y
        if self._axis_invert.get('Z'):
            z = -z
        return (x, y, z)
    
    def _degrees_to_firmware(self, x: float, y: float, z: float) -> tuple:
        """Fizikai fokok -> firmware egységek (osztás a scale-lel).
        
        Ha axis_scale nincs megadva (vagy 0), 1:1 konverzió (nincs skálázás).
        Pl. scale={'X': 0.15} → x_fw = x_deg / 0.15
        """
        sx = self._axis_scale.get('X', 0)
        sy = self._axis_scale.get('Y', 0)
        sz = self._axis_scale.get('Z', 0)
        fw_x = x / sx if sx else x
        fw_y = y / sy if sy else y
        fw_z = z / sz if sz else z
        return (fw_x, fw_y, fw_z)
    
    def _firmware_to_degrees(self, x: float, y: float, z: float) -> tuple:
        """Firmware egységek -> fizikai fokok (szorzás a scale-lel).
        
        Ha axis_scale nincs megadva (vagy 0), 1:1 konverzió (nincs skálázás).
        Pl. scale={'X': 0.15} → x_deg = x_fw * 0.15
        """
        sx = self._axis_scale.get('X', 0)
        sy = self._axis_scale.get('Y', 0)
        sz = self._axis_scale.get('Z', 0)
        deg_x = x * sx if sx else x
        deg_y = y * sy if sy else y
        deg_z = z * sz if sz else z
        return (deg_x, deg_y, deg_z)
    
    def _map_outgoing(self, x: float, y: float, z: float) -> tuple:
        """Logikai X,Y,Z (fizikai fok) -> firmware X,Y,Z (firmware egység).
        
        Lépések:
        1. Skálázás (axis_scale): fizikai fok -> firmware egység
        2. Invertálás (axis_invert): logikai tengely irányának megfordítása
        3. Mapping (axis_mapping): logikai tengely -> firmware tengely
        """
        # 1. Fizikai fok -> firmware egység
        x, y, z = self._degrees_to_firmware(x, y, z)
        # 2. Invertálás a logikai értékeken
        x, y, z = self._apply_invert(x, y, z)
        # 3. Mapping: logikai -> firmware
        logical = {'X': x, 'Y': y, 'Z': z}
        fw_x = logical.get(self._axis_map_reverse.get('X', 'X'), 0.0)
        fw_y = logical.get(self._axis_map_reverse.get('Y', 'Y'), 0.0)
        fw_z = logical.get(self._axis_map_reverse.get('Z', 'Z'), 0.0)
        print(f"🔧 _map_outgoing: logical({x:.2f},{y:.2f},{z:.2f}) → fw({fw_x:.2f},{fw_y:.2f},{fw_z:.2f})")
        return (fw_x, fw_y, fw_z)
    
    def _map_incoming(self, fw_x: float, fw_y: float, fw_z: float) -> tuple:
        """Firmware X,Y,Z (firmware egység) -> logikai X,Y,Z (fizikai fok).
        
        Lépések:
        1. Mapping (axis_mapping): firmware tengely -> logikai tengely
        2. Invertálás (axis_invert): logikai tengely irányának visszafordítása
        3. Skálázás (axis_scale): firmware egység -> fizikai fok
        """
        # 1. Mapping: firmware -> logikai
        firmware = {'X': fw_x, 'Y': fw_y, 'Z': fw_z}
        log_x = firmware.get(self._axis_map.get('X', 'X'), 0.0)
        log_y = firmware.get(self._axis_map.get('Y', 'Y'), 0.0)
        log_z = firmware.get(self._axis_map.get('Z', 'Z'), 0.0)
        # 2. Invertálás visszafordítása (szimmetrikus: -(-x) = x)
        log_x, log_y, log_z = self._apply_invert(log_x, log_y, log_z)
        # 3. Firmware egység -> fizikai fok
        log_x, log_y, log_z = self._firmware_to_degrees(log_x, log_y, log_z)
        print(f"🔧 _map_incoming: fw({fw_x:.2f},{fw_y:.2f},{fw_z:.2f}) → logical({log_x:.2f},{log_y:.2f},{log_z:.2f})")
        return (log_x, log_y, log_z)
    
    def _remap_gcode(self, gcode: str) -> str:
        """Nyers G-code parancsban a tengely betűk átírása a mapping szerint.
        
        Pl. 'G1 X50 Y30 Z10 F50' -> 'G1 Y50 X30 Z10 F50' ha X<->Y swap.
        """
        # Identitás mapping esetén nincs mit csinálni
        if self._axis_map == {'X': 'X', 'Y': 'Y', 'Z': 'Z'}:
            return gcode
        
        # Tengely értékek kinyerése
        axis_values = {}
        for axis in ['X', 'Y', 'Z']:
            match = re.search(rf'([{axis}])(-?\d+\.?\d*)', gcode, re.IGNORECASE)
            if match:
                axis_values[axis.upper()] = match.group(2)
        
        if not axis_values:
            return gcode
        
        # Mapping alkalmazás: a logikai tengely értékét a firmware tengelyre írjuk
        # Placeholder-eket használunk, hogy elkerüljük az egymásra hatást
        result = gcode
        for logical_axis, value in axis_values.items():
            firmware_axis = self._axis_map.get(logical_axis, logical_axis)
            result = re.sub(
                rf'{logical_axis}(-?\d+\.?\d*)',
                f'__{firmware_axis}__{value}',
                result,
                flags=re.IGNORECASE
            )
        
        # Placeholder-ek visszacserélése végleges formára
        for axis in ['X', 'Y', 'Z']:
            result = result.replace(f'__{axis}__', axis)
        
        return result
    
    # =========================================
    # SZOFTVERES TENGELYLIMITEK
    # =========================================
    
    def _clamp_to_limits(self, x: float, y: float, z: float) -> tuple:
        """Logikai pozíciók clampolása a konfigurált limitek közé.
        
        Returns:
            (clamped_x, clamped_y, clamped_z, clamped_axes)
            clamped_axes: dict {'X': True, 'Y': True, ...} ha clampolás történt
        """
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
    # ALACSONY SZINTŰ KOMMUNIKÁCIÓ
    # =========================================
    
    async def _write_bytes(self, data: bytes) -> None:
        """Byte-ok írása a serial portra"""
        if not self._serial or not self._serial.is_open:
            return
        await asyncio.to_thread(self._serial.write, data)
    
    async def _send_command(self, command: str) -> str:
        """Parancs küldése és válasz olvasása (thread-safe)"""
        if not self._serial or not self._serial.is_open:
            raise ConnectionError("Nincs kapcsolat")
        
        async with self._serial_lock:
            # Buffer ürítés a parancs előtt
            if self._serial.in_waiting:
                await asyncio.to_thread(self._serial.read, self._serial.in_waiting)
            
            # Parancs küldése
            cmd = command.strip() + "\r\n"
            await asyncio.to_thread(self._serial.write, cmd.encode())
            
            # Válasz olvasása
            return await self._read_response_unlocked()
    
    async def _send_command_no_response(self, command: str) -> None:
        """Parancs küldése ahol NEM várunk választ (pl. G91, G90).
        
        A firmware bizonyos parancsokra (mód váltás) nem küld választ.
        Ilyenkor felesleges a teljes timeout-ot kivárni.
        """
        if not self._serial or not self._serial.is_open:
            return
        
        async with self._serial_lock:
            # Buffer ürítés
            if self._serial.in_waiting:
                await asyncio.to_thread(self._serial.read, self._serial.in_waiting)
            
            # Parancs küldése
            cmd = command.strip() + "\r\n"
            await asyncio.to_thread(self._serial.write, cmd.encode())
            
            # Rövid várakozás a feldolgozásra (nincs válasz, nem kell timeout-olni)
            await asyncio.sleep(0.1)
    
    async def _read_response_unlocked(self, timeout: float = None) -> str:
        """Válasz olvasása a soros portról"""
        if not self._serial:
            return ""
        
        response_lines = []
        start_time = asyncio.get_event_loop().time()
        timeout = timeout or self.timeout
        
        while True:
            in_waiting = await asyncio.to_thread(
                lambda: self._serial.in_waiting if self._serial else 0
            )
            if in_waiting > 0:
                try:
                    line_bytes = await asyncio.to_thread(self._serial.readline)
                    line = line_bytes.decode(errors='replace').strip()
                    if line:
                        response_lines.append(line)
                        
                        # A robot válaszai INFO: vagy ERROR: -rel kezdődnek
                        # Egy INFO/ERROR sor a teljes válasz (nincs "ok" lezárás)
                        if self.INFO_PATTERN.match(line) or self.ERROR_PATTERN.match(line):
                            # Kis várakozás esetleges további sorokra
                            await asyncio.sleep(0.05)
                            continue
                except Exception:
                    pass
            else:
                # Ha van már válasz és nincs több adat, kész
                if response_lines:
                    await asyncio.sleep(0.1)
                    in_waiting2 = await asyncio.to_thread(
                        lambda: self._serial.in_waiting if self._serial else 0
                    )
                    if in_waiting2 == 0:
                        break
                await asyncio.sleep(0.02)
            
            # Timeout
            if asyncio.get_event_loop().time() - start_time > timeout:
                break
        
        result = "\n".join(response_lines)
        
        # Pozíció frissítése ha mozgás válasz érkezett
        self._parse_move_response(result)
        
        return result
    
    def _parse_move_response(self, response: str) -> None:
        """Mozgás válaszból pozíció kinyerése (firmware -> logikai tengely mapping-gel)"""
        match = self.MOVE_RESPONSE_PATTERN.search(response)
        if match:
            fw_x = float(match.group(1))
            fw_y = float(match.group(2))
            fw_z = float(match.group(3))
            print(f"🔧 Firmware válasz pozíció: X={fw_x:.2f} Y={fw_y:.2f} Z={fw_z:.2f}")
            # Firmware tengelyek -> logikai tengelyek (mapping + invert + scale)
            log_x, log_y, log_z = self._map_incoming(fw_x, fw_y, fw_z)
            self._status.position = Position(x=log_x, y=log_y, z=log_z)
            self._status.work_position = Position(x=log_x, y=log_y, z=log_z)
            print(f"🔧 Logikai pozíció frissítve: X={log_x:.2f} Y={log_y:.2f} Z={log_z:.2f}")
            if self.on_position_update:
                self.on_position_update(self._status.position)
    
    # =========================================
    # ÁLLAPOT LEKÉRDEZÉS
    # =========================================
    
    async def check_endstops(self) -> Dict[str, bool]:
        """Végállás érzékelők lekérdezése M119 paranccsal.
        
        Az eredményt firmware -> logikai tengely mapping-gel konvertálja.
        Visszatérési érték: {'X': bool, 'Y': bool, 'Z': bool}
        ahol True = végállás aktív (nyomva).
        
        FIGYELEM: Nem hívandó mozgás közben, mert a serial kommunikáció
        interferálhat a mozgásparancsokkal.
        """
        try:
            response = await self._send_command("M119")
            match = self.ENDSTOP_PATTERN.search(response)
            if match:
                # Firmware endstop értékek
                fw_endstops = {
                    'X': match.group(1) == '1',
                    'Y': match.group(2) == '1',
                    'Z': match.group(3) == '1',
                }
                # Firmware -> logikai tengely mapping alkalmazása
                # Ha axis_mapping: {'X': 'Y', 'Y': 'X', 'Z': 'Z'}, akkor:
                #   firmware X endstop -> logikai Y (mert logikai Y = firmware X)
                logical_endstops = {}
                for fw_axis, triggered in fw_endstops.items():
                    logical_axis = self._axis_map_reverse.get(fw_axis, fw_axis)
                    logical_endstops[logical_axis] = triggered
                
                # Statusba mentés
                self._status.endstop_states = logical_endstops
                return logical_endstops
            
            return {'X': False, 'Y': False, 'Z': False}
            
        except Exception as e:
            print(f"🤖 Endstop lekérdezés hiba: {e}")
            return {'X': False, 'Y': False, 'Z': False}
    
    async def _check_endstop_after_jog(self, axis: str, distance: float) -> None:
        """Végállás ellenőrzés jog mozgás után.
        
        M119-et küld, és ha a mozgatott tengely végállása aktív,
        megjegyzi a blokkolt irányt. Ha nem aktív, feloldja a blokkolást.
        Az eredmény a status.endstop_blocked mezőbe kerül.
        
        axis: mozgatott tengely ('X', 'Y', 'Z')
        distance: mozgatás távolsága (pozitív/negatív irány)
        """
        try:
            endstops = await self.check_endstops()
            
            if endstops.get(axis, False):
                # Végállás aktív: blokkoljuk a mozgás irányát
                direction = 'positive' if distance > 0 else 'negative'
                self._endstop_blocked[axis] = direction
                print(f"🤖 Végállás aktív: {axis} {direction} irány blokkolva")
            else:
                # Végállás nem aktív: feloldjuk ha volt blokkolás
                if axis in self._endstop_blocked:
                    del self._endstop_blocked[axis]
            
            # Statusba írás (a frontend olvassa)
            self._status.endstop_blocked = dict(self._endstop_blocked) if self._endstop_blocked else None
            
        except Exception as e:
            print(f"🤖 Endstop ellenőrzés hiba jog után: {e}")
    
    async def get_status(self) -> DeviceStatus:
        """Aktuális állapot lekérdezése GRBL státusz polling-gal.
        
        Aktívan lekérdezi a GRBL állapotot (?) a valós idejű pozíció és
        állapot frissítéshez, hasonlóan a GrblDevice működéséhez.
        """
        # Robot-specifikus állapot frissítése
        self._status.gripper_state = self._gripper_state
        self._status.sucker_state = self._sucker_state
        
        # GRBL státusz lekérdezése (ha csatlakozva és nincs diagnosztika)
        if self._connected and self._serial and self._serial.is_open:
            if not getattr(self, '_diagnostics_running', False):
                try:
                    await self.get_grbl_status()
                except Exception:
                    pass
        
        return self._status
    
    async def get_capabilities(self) -> DeviceCapabilities:
        """Eszköz képességek lekérdezése"""
        return self._capabilities
    
    # =========================================
    # ÁLLAPOT POLLING
    # =========================================
    
    def _start_status_polling(self, interval: float = 0.2) -> None:
        """Állapot polling indítása (gyors frissítés a valós idejű pozícióhoz)"""
        if self._status_polling:
            return
        self._status_polling = True
        self._poll_task = asyncio.create_task(self._poll_status(interval))
    
    def _stop_status_polling(self) -> None:
        """Állapot polling leállítása"""
        self._status_polling = False
        if self._poll_task:
            self._poll_task.cancel()
            self._poll_task = None
    
    async def _poll_status(self, interval: float) -> None:
        """Állapot polling loop"""
        while self._status_polling and self._connected:
            try:
                await self.get_status()
            except Exception:
                pass
            await asyncio.sleep(interval)
    
    # =========================================
    # ROBOT ENGEDÉLYEZÉS
    # =========================================
    
    async def enable(self) -> bool:
        """Robot motorok engedélyezése (M17)"""
        try:
            await self._send_command("M17")
            self._enabled = True
            print(f"🤖 Robot engedélyezve")
            return True
        except Exception as e:
            self._set_error(f"Enable hiba: {str(e)}")
            return False
    
    async def disable(self) -> bool:
        """Robot motorok letiltása (M84)"""
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
        Jog mozgás - tengelyenkénti mozgatás abszolút pozícióval.
        
        A jelenlegi pozícióból számítja ki a célpozíciót, így csak a kért
        tengely értéke változik. A többi tengely a jelenlegi pozícióján marad,
        ezért a firmware nem mozgatja azokat (nincs motor-kattogás).
        
        Nem használ G91/G90 módváltást - mindig abszolút módban (G90) marad.
        
        Szoftveres tengelylimitek: a célpozíció a konfigurált min/max
        értékekre clampolódik, így soha nem lépi túl a megengedett tartományt.
        
        axis: 'X', 'Y' vagy 'Z' (J1, J2, J3)
        distance: szög fokban (negatív = ellenkező irány)
        feed_rate: sebesség (1-100)
        """
        try:
            axis = axis.upper()
            if axis not in ["X", "Y", "Z"]:
                return False
            
            speed = max(1, min(100, int(feed_rate)))
            
            # Abszolút célpozíció számítás a jelenlegi pozícióból
            current = self._status.position
            target_x = current.x
            target_y = current.y
            target_z = current.z
            
            if axis == "X":
                target_x += distance
            elif axis == "Y":
                target_y += distance
            elif axis == "Z":
                target_z += distance
            
            # Szoftveres tengelylimitek alkalmazása (biztonsági háló)
            target_x, target_y, target_z, clamped = self._clamp_to_limits(
                target_x, target_y, target_z
            )
            if clamped:
                print(f"🤖 Limit clamp: {clamped} "
                      f"(target: X={target_x:.1f} Y={target_y:.1f} Z={target_z:.1f})")
            
            # Logikai -> firmware tengely mapping
            fw_x, fw_y, fw_z = self._map_outgoing(target_x, target_y, target_z)
            
            # Abszolút mozgás (G90 módban) - csak a kért tengely változik,
            # a többi a jelenlegi pozícióján marad -> firmware nem mozgatja
            response = await self._send_command(
                f"G1 X{fw_x:.2f} Y{fw_y:.2f} Z{fw_z:.2f} F{speed}"
            )
            
            if self.ERROR_PATTERN.search(response):
                return False
            
            # Végállás ellenőrzés a mozgás után
            await self._check_endstop_after_jog(axis, distance)
            
            return True
            
        except Exception as e:
            self._set_error(f"Jog hiba: {str(e)}")
            return False
    
    async def jog_stop(self) -> bool:
        """Jog mozgás azonnali leállítása és buffer törlése.
        
        A GRBL kezelése:
        1. Feed hold (!) - azonnal megállítja a mozgást
        2. Soft reset (0x18) - törli a buffert és visszaállítja Idle-re
        3. Unlock ($X) - ha szükséges, feloldja a GRBL-t
        
        Fontos: A cycle start (~) NEM használható, mert az folytatja az előző mozgást!
        """
        import time
        start_time = time.time()
        print(f"🤖 Jog stop: hívás kezdete")
        
        # Megvárjuk, hogy az előző jog művelet befejeződjön
        async with self._jog_lock:
            try:
                if not self._serial or not self._serial.is_open:
                    print(f"🤖 Jog stop: serial nincs nyitva!")
                    return False
                
                # Feed hold küldése (azonnal megállítja a mozgást)
                print(f"🤖 Jog stop: feed hold (!) küldése...")
                await self._write_bytes(b"!")
                await asyncio.sleep(0.02)
                
                # Aktuális pozíció lekérdezése MIELŐTT soft reset-et küldünk
                # (a soft reset nullázza a pozíciót)
                status = await self.get_grbl_status()
                saved_pos = status.get('grbl', {'x': 0, 'y': 0, 'z': 0})
                print(f"🤖 Jog stop: pozíció mentve: X={saved_pos['x']}, Y={saved_pos['y']}, Z={saved_pos['z']}")
                
                # Soft reset - törli a buffert és visszaállítja Idle-re
                print(f"🤖 Jog stop: soft reset (0x18) küldése...")
                await self._write_bytes(b"\x18")
                await asyncio.sleep(0.1)  # Soft reset-nek több idő kell
                
                # Buffer ürítése - a soft reset válaszüzenetei
                if self._serial and self._serial.is_open:
                    self._serial.reset_input_buffer()
                
                # Unlock ha szükséges (soft reset után alarm állapotba kerülhet)
                print(f"🤖 Jog stop: unlock ($X) küldése...")
                await self._send_command("$X")
                await asyncio.sleep(0.02)
                
                # Pozíció visszaállítása G92-vel
                print(f"🤖 Jog stop: pozíció visszaállítása G92-vel...")
                await self._send_command(f"G92 X{saved_pos['x']:.3f} Y{saved_pos['y']:.3f} Z{saved_pos['z']:.3f}")
                await asyncio.sleep(0.02)
                
                # Állapot visszaállítása
                self._set_state(DeviceState.IDLE)
                
                elapsed = (time.time() - start_time) * 1000
                print(f"🤖 Jog stop: kész ({elapsed:.1f}ms)")
                return True
                
            except Exception as e:
                print(f"🤖 Jog stop hiba: {e}")
                return False
    
    async def move_to(self, x: float, y: float, z: float, speed: float = 50) -> bool:
        """Abszolút pozícióra mozgás (logikai koordináták, szoftveres limitekkel)"""
        try:
            speed = max(1, min(100, int(speed)))
            
            # Szoftveres tengelylimitek alkalmazása (biztonsági háló)
            x, y, z, clamped = self._clamp_to_limits(x, y, z)
            if clamped:
                print(f"🤖 Move limit clamp: {clamped} "
                      f"(target: X={x:.1f} Y={y:.1f} Z={z:.1f})")
            
            # Logikai -> firmware tengely mapping
            fw_x, fw_y, fw_z = self._map_outgoing(x, y, z)
            response = await self._send_command(f"G1 X{fw_x:.2f} Y{fw_y:.2f} Z{fw_z:.2f} F{speed}")
            
            if self.ERROR_PATTERN.search(response):
                return False
            
            return True
        except Exception as e:
            self._set_error(f"Move hiba: {str(e)}")
            return False
    
    # =========================================
    # GRBL-SPECIFIKUS METÓDUSOK
    # =========================================
    
    async def set_control_mode(self, mode: ControlMode) -> bool:
        """Vezérlési mód váltása (Joint vagy Cartesian)"""
        if mode == ControlMode.CARTESIAN and not KINEMATICS_AVAILABLE:
            print("🤖 Cartesian mód nem elérhető - kinematics modul hiányzik")
            return False
        
        self._control_mode = mode
        print(f"🤖 Vezérlési mód: {mode.value}")
        return True
    
    def get_control_mode(self) -> ControlMode:
        """Aktuális vezérlési mód lekérdezése"""
        return self._control_mode
    
    async def move_to_joints(self, j1: float, j2: float, j3: float, speed: float = 500) -> bool:
        """
        Joint pozícióra mozgás (közvetlenül, IK nélkül).
        
        Args:
            j1: Bázis forgás fokban
            j2: Váll szög fokban
            j3: Könyök szög fokban
            speed: Sebesség (GRBL F érték, fok/perc)
        """
        try:
            # Joint limitek ellenőrzése
            j1 = max(self._joint_limits['J1'][0], min(self._joint_limits['J1'][1], j1))
            j2 = max(self._joint_limits['J2'][0], min(self._joint_limits['J2'][1], j2))
            j3 = max(self._joint_limits['J3'][0], min(self._joint_limits['J3'][1], j3))
            
            # Joint -> GRBL tengely konverzió
            # J1 -> Z, J2 -> X, J3 -> Y
            # Megjegyzés: $3=1 GRBL beállítás invertálja az X tengelyt
            grbl_x = j2   # Váll
            grbl_y = j3   # Könyök
            grbl_z = j1   # Bázis
            
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
        """
        Cartesian pozícióra mozgás (IK-val).
        
        Args:
            x, y, z: Cél pozíció mm-ben (robot koordináta-rendszerben)
            speed: Sebesség (GRBL F érték, fok/perc)
        
        Returns:
            True ha sikeres, False ha IK hiba vagy elérhetetlen pozíció
        """
        if not KINEMATICS_AVAILABLE:
            print("🤖 Cartesian mód nem elérhető - kinematics modul hiányzik")
            return False
        
        try:
            # Inverz kinematika
            angles = inverse_kinematics(x, y, z, self._robot_config)
            
            if not angles.valid:
                print(f"🤖 IK hiba: {angles.error}")
                return False
            
            # Joint pozícióra mozgás
            return await self.move_to_joints(angles.j1, angles.j2, angles.j3, speed)
            
        except Exception as e:
            self._set_error(f"Move XYZ hiba: {str(e)}")
            return False
    
    async def move_to_xyz_linear(self, x: float, y: float, z: float, 
                                  speed: float = 500, step_size: float = 5.0) -> bool:
        """
        Cartesian lineáris mozgás - egyenes vonal a TCP-nek.
        
        A mozgást kis lépésekre bontja és minden ponthoz IK-t számol,
        így a TCP egyenes vonalat követ Cartesian térben (nem íves pályát).
        
        Args:
            x, y, z: Cél pozíció mm-ben
            speed: Sebesség (GRBL F érték)
            step_size: Lépésköz mm-ben (kisebb = pontosabb, de lassabb)
        
        Returns:
            True ha sikeres, False ha IK hiba
        """
        import math
        
        if not KINEMATICS_AVAILABLE:
            print("🤖 Cartesian mód nem elérhető - kinematics modul hiányzik")
            return False
        
        try:
            # Aktuális pozíció lekérése
            status = await self.get_grbl_status()
            if not status:
                print("🤖 Státusz lekérdezés sikertelen")
                return False
            
            j1 = status['joints']['j1']
            j2 = status['joints']['j2']
            j3 = status['joints']['j3']
            
            # FK: jelenlegi joint szögekből Cartesian pozíció
            start = forward_kinematics(j1, j2, j3, self._robot_config)
            
            # Távolság számítása
            dx = x - start.x
            dy = y - start.y
            dz = z - start.z
            dist = math.sqrt(dx*dx + dy*dy + dz*dz)
            
            if dist < 0.1:  # Már ott vagyunk
                return True
            
            # Lépések száma
            n_steps = max(1, int(dist / step_size))
            
            print(f"🤖 Lineáris mozgás: {dist:.1f}mm, {n_steps} lépés")
            
            # Interpoláció és mozgás
            for i in range(1, n_steps + 1):
                t = i / n_steps
                
                # Köztes pont
                ix = start.x + t * dx
                iy = start.y + t * dy
                iz = start.z + t * dz
                
                # IK a köztes ponthoz
                angles = inverse_kinematics(ix, iy, iz, self._robot_config)
                if not angles.valid:
                    print(f"🤖 IK hiba lépés {i}/{n_steps}: {angles.error}")
                    return False
                
                # Mozgás (várakozás nélkül a köztes pontokra, kivéve az utolsót)
                await self.move_to_joints(angles.j1, angles.j2, angles.j3, speed)
                
                # Rövid várakozás a GRBL buffer kezeléshez
                # (A GRBL buffereli a G1 parancsokat, nem kell minden lépésnél várni)
                if i < n_steps:
                    await asyncio.sleep(0.05)  # 50ms - csak buffer sync
            
            return True
            
        except Exception as e:
            self._set_error(f"Move XYZ linear hiba: {str(e)}")
            return False
    
    async def jog_joint(self, joint: str, distance: float, speed: float = 500) -> bool:
        """
        Egyetlen joint relatív mozgatása.
        
        Args:
            joint: 'J1', 'J2', vagy 'J3'
            distance: Szög fokban (pozitív/negatív)
            speed: Sebesség (fok/perc)
        """
        print(f"🤖 Jog joint: {joint}, distance={distance}, speed={speed}")
        
        joint = joint.upper()
        if joint not in ['J1', 'J2', 'J3']:
            return False
        
        # Lock megszerzése - megvárjuk, ha jog_stop fut
        async with self._jog_lock:
            # GRBL pozíció lekérdezése a jog előtt - ez frissíti a _status.position-t
            await self.get_grbl_status()
            
            # Aktuális pozíció - most már a friss GRBL adatokból
            j1 = self._status.position.z  # J1 = GRBL Z
            j2 = self._status.position.x  # J2 = GRBL X
            j3 = self._status.position.y  # J3 = GRBL Y
            
            print(f"🤖 Jog joint: aktuális pozíció J1={j1}, J2={j2}, J3={j3}")
            
            # Cél pozíció
            if joint == 'J1':
                j1 += distance
            elif joint == 'J2':
                j2 += distance
            elif joint == 'J3':
                j3 += distance
            
            return await self.move_to_joints(j1, j2, j3, speed)
    
    async def jog_cartesian(self, axis: str, distance: float, speed: float = 500) -> bool:
        """
        Cartesian tengely relatív mozgatása (IK-val).
        
        Args:
            axis: 'X', 'Y', vagy 'Z' (Cartesian koordináták)
            distance: Távolság mm-ben
            speed: Sebesség
        """
        if not KINEMATICS_AVAILABLE:
            return False
        
        axis = axis.upper()
        if axis not in ['X', 'Y', 'Z']:
            return False
        
        # Lock megszerzése - megvárjuk, ha jog_stop fut
        async with self._jog_lock:
            # GRBL pozíció lekérdezése a jog előtt - ez frissíti a _status.position-t
            await self.get_grbl_status()
            
            # Aktuális Cartesian pozíció - most már a friss GRBL adatokból, FK-val számolva
            j1 = self._status.position.z
            j2 = self._status.position.x
            j3 = self._status.position.y
            pos = forward_kinematics(j1, j2, j3, self._robot_config)
            x, y, z = pos.x, pos.y, pos.z
            
            # Cél pozíció
            if axis == 'X':
                x += distance
            elif axis == 'Y':
                y += distance
            elif axis == 'Z':
                z += distance
            
            return await self.move_to_xyz(x, y, z, speed)
    
    async def get_grbl_status(self) -> dict:
        """GRBL státusz lekérdezése '?' paranccsal"""
        if not self._use_grbl:
            return {}
        
        try:
            response = await self._send_command("?")
            match = self.GRBL_STATUS_PATTERN.search(response)
            if match:
                state = match.group(1)
                grbl_x = float(match.group(2))
                grbl_y = float(match.group(3))
                grbl_z = float(match.group(4))
                
                # GRBL -> Joint konverzió
                # Megjegyzés: $3=1 GRBL beállítás invertálja az X tengelyt
                j1 = grbl_z  # Bázis
                j2 = grbl_x  # Váll
                j3 = grbl_y  # Könyök
                
                # Pozíció frissítése
                self._status.position = Position(x=grbl_x, y=grbl_y, z=grbl_z)
                
                # GRBL state string -> DeviceState konverzió
                state_map = {
                    'Idle': DeviceState.IDLE,
                    'Run': DeviceState.RUNNING,
                    'Hold': DeviceState.PAUSED,
                    'Jog': DeviceState.JOG,
                    'Alarm': DeviceState.ALARM,
                    'Home': DeviceState.HOMING,
                    'Door': DeviceState.ALARM,
                    'Check': DeviceState.IDLE,
                    'Sleep': DeviceState.IDLE,
                }
                new_state = state_map.get(state, DeviceState.IDLE)
                self._set_state(new_state)
                
                if KINEMATICS_AVAILABLE:
                    self._joint_position = JointAngles(j1=j1, j2=j2, j3=j3)
                    self._cartesian_position = forward_kinematics(j1, j2, j3, self._robot_config)
                
                return {
                    'state': state,
                    'grbl': {'x': grbl_x, 'y': grbl_y, 'z': grbl_z},
                    'joints': {'j1': j1, 'j2': j2, 'j3': j3},
                    'cartesian': {
                        'x': self._cartesian_position.x if self._cartesian_position else 0,
                        'y': self._cartesian_position.y if self._cartesian_position else 0,
                        'z': self._cartesian_position.z if self._cartesian_position else 0,
                    } if KINEMATICS_AVAILABLE else None,
                }
            return {}
        except Exception as e:
            print(f"🤖 GRBL státusz hiba: {e}")
            return {}
    
    async def get_grbl_settings(self) -> dict:
        """GRBL beállítások lekérdezése '$$' paranccsal"""
        if not self._use_grbl:
            return {}
        
        try:
            response = await self._send_command("$$")
            settings = {}
            for line in response.split('\n'):
                match = re.match(r'\$(\d+)=(-?\d+\.?\d*)', line)
                if match:
                    settings[int(match.group(1))] = float(match.group(2))
            return settings
        except Exception as e:
            print(f"🤖 GRBL beállítások hiba: {e}")
            return {}
    
    async def set_grbl_setting(self, setting: int, value: float) -> bool:
        """GRBL beállítás módosítása"""
        if not self._use_grbl:
            return False
        
        try:
            response = await self._send_command(f"${setting}={value}")
            return "ok" in response.lower()
        except Exception as e:
            print(f"🤖 GRBL beállítás hiba: {e}")
            return False
    
    def get_joint_position(self) -> Optional[JointAngles]:
        """Aktuális joint pozíció lekérdezése"""
        return self._joint_position
    
    def get_cartesian_position(self) -> Optional[CartesianPosition]:
        """Aktuális Cartesian pozíció lekérdezése (FK-ból)"""
        return self._cartesian_position
    
    def get_robot_config(self) -> RobotConfig:
        """Robot konfiguráció (méretek) lekérdezése"""
        return self._robot_config
    
    # =========================================
    # VÉGEFFEKTOR VEZÉRLÉS
    # =========================================
    
    async def gripper_on(self) -> bool:
        """Megfogó bezárása (szervó 90 fok)"""
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
        """Megfogó nyitása (szervó 0 fok)"""
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
        """Szívó bekapcsolása (M10)"""
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
        """Szívó kikapcsolása (M11)"""
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
        """
        Robot kalibráció - nullára mozgatás és pozíció reset.
        A robotkar kéri a kalibrációt csatlakozáskor.
        """
        try:
            self._set_state(DeviceState.HOMING)
            print(f"🤖 Kalibráció indítása...")
            
            # Nullázás: a robotot kézzel kell a home pozícióba állítani,
            # majd G92-vel resetelni a pozíciót
            response = await self._send_command("G92 X0 Y0 Z0")
            await asyncio.sleep(0.5)
            
            # Pozíció nullázás megerősítése
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
    # G-CODE KÜLDÉS ÉS PROGRAM FUTTATÁS
    # =========================================
    
    async def send_gcode(self, gcode: str) -> str:
        """Egyedi G-code parancs küldése (tengely mapping-gel)"""
        try:
            # Nyers G-code-ban is alkalmazzuk a tengely mapping-et,
            # hogy az MDI konzol konzisztens legyen a jog gombokkal
            mapped_gcode = self._remap_gcode(gcode)
            response = await self._send_command(mapped_gcode)
            
            if self.ERROR_PATTERN.search(response):
                return f"error: {response}"
            
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
                # Komment eltávolítása
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
        
        # Meglévő futás leállítása
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
            # Pause ellenőrzés
            while self._paused:
                await asyncio.sleep(0.1)
                if not self._running:
                    break
            
            if not self._running:
                break
            
            # Következő sor küldése (tengely mapping alkalmazásával)
            line = self._gcode_lines[self._current_line_index]
            mapped_line = self._remap_gcode(line)
            response = await self._send_command(mapped_line)
            
            # Hiba ellenőrzés
            if self.ERROR_PATTERN.search(response):
                error_msg = response.strip()
                # Ismeretlen parancsot átugorjuk (komment, nem támogatott)
                if "COMMAND NOT RECOGNIZED" in response:
                    print(f"🤖 Átugorva (sor {self._current_line_index + 1}): {line}")
                else:
                    self._set_error(
                        f"G-code hiba (sor {self._current_line_index + 1}): {error_msg}"
                    )
                    self._running = False
                    break
            
            # Kis várakozás a mozgás befejezésére
            await asyncio.sleep(0.1)
            
            # Progress frissítése
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
        
        # Befejezés
        if self._current_line_index >= total_lines:
            self._status.progress = 100.0
            if self.on_job_complete:
                self.on_job_complete(self._status.current_file or "")
        
        self._running = False
        self._run_task = None
        self._set_state(DeviceState.IDLE)
    
    async def pause(self) -> bool:
        """Program megállítása"""
        self._paused = True
        self._set_state(DeviceState.PAUSED)
        return True
    
    async def resume(self) -> bool:
        """Program folytatása"""
        self._paused = False
        self._set_state(DeviceState.RUNNING)
        return True
    
    async def stop(self) -> bool:
        """Program és mozgás leállítása"""
        try:
            self._running = False
            self._paused = False
            
            if self._run_task and not self._run_task.done():
                self._run_task.cancel()
            
            self._set_state(DeviceState.IDLE)
            return True
        except Exception:
            return False
    
    async def reset(self) -> bool:
        """Eszköz reset - hiba törlése"""
        try:
            self._status.error_message = None
            self._set_state(DeviceState.IDLE)
            return True
        except Exception as e:
            self._set_error(f"Reset hiba: {str(e)}")
            return False
    
    # =========================================
    # TEACHING MÓD
    # =========================================
    
    async def teach_record_position(self) -> Dict[str, Any]:
        """Aktuális pozíció rögzítése teaching módhoz"""
        pos = {
            "index": len(self._taught_positions),
            "x": self._status.position.x,
            "y": self._status.position.y,
            "z": self._status.position.z,
            "gripper": self._gripper_state,
            "sucker": self._sucker_state,
        }
        self._taught_positions.append(pos)
        print(f"🤖 Pozíció rögzítve #{pos['index']}: "
              f"X={pos['x']:.2f} Y={pos['y']:.2f} Z={pos['z']:.2f}")
        return pos
    
    async def teach_play(self, speed: float = 50.0) -> bool:
        """Rögzített pozíciók lejátszása"""
        if not self._taught_positions:
            return False
        
        self._set_state(DeviceState.RUNNING)
        self._running = True
        
        for pos in self._taught_positions:
            if not self._running:
                break
            
            # Pozícióra mozgás
            await self.move_to(pos['x'], pos['y'], pos['z'], speed)
            
            # Végeffektor állapot beállítása
            if pos.get("gripper") == "closed":
                await self.gripper_on()
            elif pos.get("gripper") == "open":
                await self.gripper_off()
            
            if pos.get("sucker"):
                await self.sucker_on()
            elif pos.get("sucker") is False:
                await self.sucker_off()
            
            await asyncio.sleep(0.5)  # Rövid várakozás pozíciók között
        
        self._running = False
        self._set_state(DeviceState.IDLE)
        return True
    
    def teach_clear(self) -> None:
        """Rögzített pozíciók törlése"""
        self._taught_positions.clear()
        print(f"🤖 Tanított pozíciók törölve")
    
    def teach_get_positions(self) -> List[Dict[str, Any]]:
        """Rögzített pozíciók lekérdezése"""
        return self._taught_positions.copy()
    
    # =========================================
    # SEGÉD FUNKCIÓK
    # =========================================
    
    @staticmethod
    def list_ports() -> List[Dict[str, str]]:
        """Elérhető soros portok listázása"""
        if not SERIAL_AVAILABLE:
            return []
        
        ports = []
        for port in serial.tools.list_ports.comports():
            ports.append({
                "port": port.device,
                "description": port.description,
                "hwid": port.hwid,
            })
        return ports
    
    def get_info(self) -> Dict[str, Any]:
        """Eszköz információk lekérdezése (bővített)"""
        info = super().get_info()
        info.update({
            "port": self.port,
            "baudrate": self.baudrate,
            "enabled": self._enabled,
            "calibrated": self._calibrated,
            "gripper_state": self._gripper_state,
            "sucker_state": self._sucker_state,
            "taught_positions": len(self._taught_positions),
        })
        return info
