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

Tengely elnevezés:
  - X tengely: bázis forgás (első csukló)
  - Y tengely: váll (második csukló)
  - Z tengely: könyök (harmadik csukló)
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
    - X: Bázis forgás (függőleges tengely körül, első csukló)
    - Y: Váll (vízszintes tengely körül, második csukló)
    - Z: Könyök (vízszintes tengely körül, harmadik csukló)
    
    Végeffektorok: gripper (szervóvezérelt megfogó), szívó (sucker)
    
    Használat:
        device = RobotArmDevice(
            device_id="robot_arm_1",
            device_name="Robot Kar",
            port="/dev/ttyUSB0",
        )
        await device.connect()
        
        # Tengely mozgatás
        await device.jog('X', 10, 50)  # X tengely (bázis) +10 fok
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
    
    # Tengely mapping (identity - config már X/Y/Z-t használ)
    AXIS_MAP = {'X': 'X', 'Y': 'Y', 'Z': 'Z'}
    
    def __init__(
        self,
        device_id: str,
        device_name: str,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 2.0,
        robot_config=None,
        use_grbl: bool = True,
        axis_invert: Dict[str, bool] = None,
        axis_limits: Dict[str, list] = None,
        axis_scale: Dict[str, float] = None,
        max_feed_rate: float = None,
        closed_loop: Dict[str, Any] = None,
        home_position: Dict[str, Any] = None,
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
        
        # Home pozíció konfiguráció
        # mode: "absolute" (G92 megadott értékkel), "query" (firmware lekérdezés)
        self._home_position_config = {
            'mode': 'absolute',
            'X': 0.0,
            'Y': 0.0,
            'Z': 0.0,
        }
        if home_position:
            self._home_position_config['mode'] = home_position.get('mode', 'absolute')
            self._home_position_config['X'] = home_position.get('X', 0.0)
            self._home_position_config['Y'] = home_position.get('Y', 0.0)
            self._home_position_config['Z'] = home_position.get('Z', 0.0)
        
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
        
        # Szoftveres tengelylimitek (szögek fokban)
        self._joint_limits = {
            'X': (-180, 180),
            'Y': (-90, 90),
            'Z': (-135, 135),
        }
        
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
        
        # Limit monitor task jog közben
        self._limit_monitoring = False
        self._limit_monitor_margin = 2.0  # Biztonsági margó (fok) - nagyobb érték a megbízhatóbb megálláshoz
        self._current_jog_axis: Optional[str] = None  # Aktuálisan mozgatott tengely
        self._current_jog_direction: int = 0  # 1 = pozitív, -1 = negatív
        
        # Dinamikus limit konfiguráció (tengely -> config dict)
        self._dynamic_limit_config: Dict[str, dict] = {}
        
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
                
                # Home pozíció beállítása a konfiguráció alapján
                await self._apply_home_position()

                # Státusz frissítése a home pozíció után
                status = await self.get_grbl_status()
                if status:
                    wpos = status.get('wpos')
                    if wpos and KINEMATICS_AVAILABLE:
                        print(f"🤖 Tengely pozíció: X={wpos.x:.1f}° Y={wpos.y:.1f}° Z={wpos.z:.1f}°")
                
                self._calibrated = True
            else:
                # Legacy firmware: home pozíció beállítása
                await self._apply_home_position()
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
    
    async def _apply_home_position(self) -> None:
        """
        Home pozíció alkalmazása a konfiguráció alapján.
        
        Módok:
        - "absolute": G92 a megadott értékkel (jelenlegi pozíció = config érték)
        - "query": Firmware pozíció elfogadása, nincs G92
        """
        mode = self._home_position_config.get('mode', 'absolute')
        x = self._home_position_config.get('X', 0.0)
        y = self._home_position_config.get('Y', 0.0)
        z = self._home_position_config.get('Z', 0.0)
        
        if mode == 'query':
            # Firmware pozíció elfogadása - lekérdezzük és azt használjuk
            print(f"🤖 Home mód: query - firmware pozíció elfogadása")
            status = await self.get_grbl_status()
            if status:
                wpos = status.get('wpos')
                if wpos:
                    self._status.position = Position(x=wpos.x, y=wpos.y, z=wpos.z)
                    self._status.work_position = Position(x=wpos.x, y=wpos.y, z=wpos.z)
                    print(f"🤖 Firmware pozíció: X={wpos.x:.1f} Y={wpos.y:.1f} Z={wpos.z:.1f}")
            else:
                # Fallback: absolute mode ha nem tudtuk lekérdezni
                print(f"🤖 Query fallback: absolute - pozíció: X={x:.1f} Y={y:.1f} Z={z:.1f}")
                await self._send_command_no_response(f"G92 X{x:.2f} Y{y:.2f} Z{z:.2f}")
                await asyncio.sleep(0.3)
                self._status.position = Position(x=x, y=y, z=z)
                self._status.work_position = Position(x=x, y=y, z=z)
        
        else:  # mode == 'absolute' (default)
            # Megadott pozíció beállítása G92-vel
            print(f"🤖 Home mód: absolute - pozíció: X={x:.1f} Y={y:.1f} Z={z:.1f}")
            await self._send_command_no_response(f"G92 X{x:.2f} Y{y:.2f} Z{z:.2f}")
            await asyncio.sleep(0.3)
            self._status.position = Position(x=x, y=y, z=z)
            self._status.work_position = Position(x=x, y=y, z=z)
    
    def get_home_position_config(self) -> Dict[str, Any]:
        """Home pozíció konfiguráció lekérdezése."""
        return self._home_position_config.copy()
    
    def set_home_position_config(self, config: Dict[str, Any]) -> None:
        """Home pozíció konfiguráció beállítása."""
        if 'mode' in config:
            self._home_position_config['mode'] = config['mode']
        if 'X' in config:
            self._home_position_config['X'] = float(config['X'])
        if 'Y' in config:
            self._home_position_config['Y'] = float(config['Y'])
        if 'Z' in config:
            self._home_position_config['Z'] = float(config['Z'])
    
    def update_driver_config(
        self,
        axis_invert: Dict[str, bool] = None,
        axis_scale: Dict[str, float] = None,
        axis_limits: Dict[str, tuple] = None,
        max_feed_rate: float = None,
        dynamic_limits: Dict[str, dict] = None,
    ) -> None:
        """
        Runtime konfiguráció frissítése újraindítás nélkül.
        A MachineConfigTab mentése után hívható, hogy az új beállítások
        azonnal életbe lépjenek.
        """
        if axis_invert is not None:
            old_invert = self._axis_invert.copy() if self._axis_invert else {}
            self._axis_invert = axis_invert
            inverted = [k for k, v in axis_invert.items() if v]
            if inverted:
                print(f"🔄 Invertált tengelyek: {', '.join(inverted)}")
            elif old_invert:
                print(f"🔄 Invertálás kikapcsolva (korábban: {old_invert})")

        if axis_scale is not None:
            self._axis_scale = axis_scale
            if axis_scale:
                print(f"🔄 Tengely scale frissítve: {axis_scale}")

        if axis_limits is not None:
            for axis, limits in axis_limits.items():
                if isinstance(limits, (list, tuple)) and len(limits) == 2:
                    self._axis_limits[axis] = (limits[0], limits[1])
            if axis_limits:
                print(f"🔄 Tengely limitek frissítve: {axis_limits}")

        if max_feed_rate is not None:
            self._config_max_feed_rate = max_feed_rate
            print(f"🔄 Max feed rate frissítve: {max_feed_rate}")
        
        if dynamic_limits is not None:
            self._dynamic_limit_config = dynamic_limits
            if dynamic_limits:
                for axis, cfg in dynamic_limits.items():
                    print(f"🔄 Dinamikus limit [{axis}]: függ {cfg.get('dependsOn', '?')}-tól, base=[{cfg.get('baseMin')}, {cfg.get('baseMax')}]")
    
    # =========================================
    # DINAMIKUS LIMIT KEZELÉS
    # =========================================
    
    def _get_dynamic_limits(self, axis: str) -> tuple:
        """Kiszámítja a dinamikus limiteket a függő tengely pozíciója alapján.

        Ha az adott tengelynek van dynamicLimits konfigurációja, akkor a limitek
        a függő tengely aktuális pozíciójától függnek (linear_offset formula).
        
        A base min/max értékek a tengely saját axis_limits értékeiből származnak.
        A referencia érték a függő tengely min értéke.

        Returns:
            (min, max) tuple az aktuális limitekkel
        """
        axis = axis.upper()

        # Ha nincs dinamikus limit konfig, statikus limitet használunk
        if axis not in self._dynamic_limit_config:
            return self._axis_limits.get(axis, (-180, 180))

        config = self._dynamic_limit_config[axis]
        depends_on = config.get('dependsOn', '').upper()

        if not depends_on:
            return self._axis_limits.get(axis, (-180, 180))

        # Függő tengely aktuális pozíciója
        dep_value = getattr(self._status.work_position, depends_on.lower(), 0.0)

        # Base limitek a saját tengely statikus limitjeiből
        base_min, base_max = self._axis_limits.get(axis, (-180, 180))
        
        # Referencia érték a függő tengely min értéke
        dep_limits = self._axis_limits.get(depends_on, (-180, 180))
        reference_value = dep_limits[0]  # min érték
        
        # Offset számítás (linear_offset formula)
        offset = dep_value - reference_value

        return (base_min + offset, base_max + offset)
    
    def _clamp_to_limits(self, x: float, y: float, z: float) -> tuple:
        """Logikai pozíciók clampolása a konfigurált limitek közé.
        
        Dinamikus limiteket használ, ha konfigurálva vannak.
        """
        clamped = {}
        
        # X tengely (általában nincs dinamikus limit)
        lo, hi = self._get_dynamic_limits('X')
        if x < lo:
            x = lo
            clamped['X'] = True
        elif x > hi:
            x = hi
            clamped['X'] = True
        
        # Y tengely
        lo, hi = self._get_dynamic_limits('Y')
        if y < lo:
            y = lo
            clamped['Y'] = True
        elif y > hi:
            y = hi
            clamped['Y'] = True
        
        # Z tengely (általában Y-tól függ)
        lo, hi = self._get_dynamic_limits('Z')
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
                    # X/Y/Z direkt használat
                    x = wpos.x
                    y = wpos.y
                    z = wpos.z
                    
                    if KINEMATICS_AVAILABLE:
                        self._joint_position = JointAngles(j1=x, j2=y, j3=z)
                        self._cartesian_position = forward_kinematics(x, y, z, self._robot_config)
                    
                    # Kiterjesztett visszatérési érték
                    status['axes'] = {'x': x, 'y': y, 'z': z}
                    if KINEMATICS_AVAILABLE and self._cartesian_position:
                        status['cartesian'] = {
                            'x': self._cartesian_position.x,
                            'y': self._cartesian_position.y,
                            'z': self._cartesian_position.z,
                        }
                    
                    # Szoftveres limit ellenőrzés
                    self._update_limit_blocked()
            
            return status
            
        except Exception as e:
            print(f"🤖 GRBL státusz hiba: {e}")
            return {}
    
    def _update_limit_blocked(self) -> None:
        """Frissíti a status.endstop_blocked mezőt a pozíció és limitek alapján.
        
        Dinamikus limiteket használ ha konfigurálva vannak.
        Ha egy tengely invertált, a blokkolt irány is invertálódik,
        mert a fizikai irány ellentétes a logikai iránnyal.
        """
        pos = self._status.work_position  # work_position tartalmazza a tényleges pozíciót
        blocked = {}
        
        for axis in ['X', 'Y', 'Z']:
            # Dinamikus limitek lekérése (ha vannak)
            lo, hi = self._get_dynamic_limits(axis)
            val = getattr(pos, axis.lower(), 0.0)
            is_inverted = self._axis_invert.get(axis, False)

            if val <= lo:
                # Logikailag negatív irány blokkolt
                # Ha invertált, fizikailag pozitív irány blokkolt
                blocked[axis] = 'positive' if is_inverted else 'negative'
            elif val >= hi:
                # Logikailag pozitív irány blokkolt
                # Ha invertált, fizikailag negatív irány blokkolt
                blocked[axis] = 'negative' if is_inverted else 'positive'
        
        # Kétirányú limit: Y blokkolás Z pozíció alapján
        # Ha Z a limitjénél van, Y nem mozgatható abba az irányba ami Z-t kívülre vinné
        if 'Z' in self._dynamic_limit_config:
            z_limits = self._get_dynamic_limits('Z')
            z_val = getattr(pos, 'z', 0.0)
            y_inverted = self._axis_invert.get('Y', False)
            margin = 0.5
            
            if z_val <= z_limits[0] + margin:
                # Z felső limitnél → Y lefelé (pozitív logikai irány) blokkolva
                # Mert ha Y pozitív irányba menne, Z limitje feljebb tolódna, Z kicsúszna
                y_block_dir = 'negative' if y_inverted else 'positive'
                if 'Y' not in blocked:
                    blocked['Y'] = y_block_dir
            elif z_val >= z_limits[1] - margin:
                # Z alsó limitnél → Y felfelé (negatív logikai irány) blokkolva
                y_block_dir = 'positive' if y_inverted else 'negative'
                if 'Y' not in blocked:
                    blocked['Y'] = y_block_dir

        self._status.endstop_blocked = blocked if blocked else None
    
    async def _limit_monitor_task(self) -> None:
        """Jog közben figyeli a limiteket és automatikusan leállít ha limit közelében van.
        
        Dinamikus limiteket használ ha konfigurálva vannak.
        Csak az aktuálisan mozgatott tengelyt figyeli, és csak a mozgás irányában.
        """
        while self._limit_monitoring:
            try:
                axis = self._current_jog_axis
                direction = self._current_jog_direction
                
                if not axis:
                    await asyncio.sleep(0.05)
                    continue
                
                # Pozíció frissítése
                await self.get_grbl_status()
                pos = self._status.work_position
                
                # Dinamikus limitek lekérése (minden ciklusban újra, mert függő tengely mozoghatott)
                lo, hi = self._get_dynamic_limits(axis)
                val = getattr(pos, axis.lower(), 0.0)
                margin = self._limit_monitor_margin
                
                # Csak a mozgás irányában ellenőrzünk
                should_stop = False
                if direction < 0 and val <= lo + margin:
                    # Negatív irányba mozgás, alsó limit közelében
                    should_stop = True
                    print(f"🛑 Limit monitor: {axis} tengely alsó limit közelében (val={val:.2f}, min={lo:.2f})")
                elif direction > 0 and val >= hi - margin:
                    # Pozitív irányba mozgás, felső limit közelében
                    should_stop = True
                    print(f"🛑 Limit monitor: {axis} tengely felső limit közelében (val={val:.2f}, max={hi:.2f})")
                
                # Kétirányú limit: Y jog közben Z pozíció figyelése
                if not should_stop and axis == 'Y' and 'Z' in self._dynamic_limit_config:
                    z_limits = self._get_dynamic_limits('Z')
                    z_val = getattr(pos, 'z', 0.0)
                    
                    # Y pozitív irány → Z limit felfelé tolódik → ha Z felső limitnél, stop
                    if direction > 0 and z_val <= z_limits[0] + margin:
                        should_stop = True
                        print(f"🛑 Limit monitor: Y jog stop (Z={z_val:.2f} elérte felső limitet={z_limits[0]:.2f})")
                    # Y negatív irány → Z limit lefelé tolódik → ha Z alsó limitnél, stop
                    elif direction < 0 and z_val >= z_limits[1] - margin:
                        should_stop = True
                        print(f"🛑 Limit monitor: Y jog stop (Z={z_val:.2f} elérte alsó limitet={z_limits[1]:.2f})")

                if should_stop:
                    self._limit_monitoring = False
                    await self.jog_stop()
                    return
                
                await asyncio.sleep(0.02)  # 20ms polling (50 Hz) - gyorsabb reakció a limitek közelében
                
            except Exception as e:
                print(f"⚠️ Limit monitor hiba: {e}")
                self._limit_monitoring = False
                return
    
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
        """Home pozícióra mozgatás (konfigurált értékek)"""
        try:
            self._set_state(DeviceState.HOMING)
            
            x = self._home_position_config.get('X', 0.0)
            y = self._home_position_config.get('Y', 0.0)
            z = self._home_position_config.get('Z', 0.0)
            
            response = await self._send_command(f"G1 X{x} Y{y} Z{z} F50")

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

        axis: 'X', 'Y' vagy 'Z' tengely
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
            
            # Invertálás ha szükséges
            if self._axis_invert.get(axis, False):
                actual_distance = -actual_distance
            
            # GRBL $J= jog parancs
            cmd = f"$J=G91 {axis}{actual_distance:.2f} F{actual_feed_rate:.0f}"
            response = await self._send_command(cmd)
            
            if self.ERROR_PATTERN.search(response):
                return False
            
            return True
            
        except Exception as e:
            self._set_error(f"Jog hiba: {str(e)}")
            return False
    
    async def jog_stop(self) -> bool:
        """Jog mozgás azonnali leállítása"""
        # Limit monitor leállítása
        self._limit_monitoring = False
        self._current_jog_axis = None
        self._current_jog_direction = 0

        self._jog_stopping = True
        async with self._jog_lock:
            try:
                if not self.is_serial_open:
                    self._jog_stopping = False
                    return False
                
                # Feed hold - azonnal megállítja a jog mozgást
                await self._grbl_feed_hold()
                await asyncio.sleep(0.05)
                
                # Cycle start - visszatérés Idle állapotba (Hold állapotból)
                await self._grbl_cycle_start()
                await asyncio.sleep(0.02)
                
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
            
            cmd = f"G1 X{clamped_x:.2f} Y{clamped_y:.2f} Z{clamped_z:.2f} F{speed:.0f}"
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
    
    async def move_to_joints(self, x: float, y: float, z: float, speed: float = 500) -> bool:
        """Tengely pozícióra mozgás (X/Y/Z szögek fokban)"""
        try:
            # Tengely limitek
            x = max(self._joint_limits['X'][0], min(self._joint_limits['X'][1], x))
            y = max(self._joint_limits['Y'][0], min(self._joint_limits['Y'][1], y))
            z = max(self._joint_limits['Z'][0], min(self._joint_limits['Z'][1], z))
            
            cmd = f"G1 X{x:.2f} Y{y:.2f} Z{z:.2f} F{speed:.0f}"
            response = await self._send_command(cmd)
            
            if self._use_grbl:
                if self.GRBL_ERROR_PATTERN.search(response):
                    return False
            else:
                if self.ERROR_PATTERN.search(response):
                    return False
            
            # Pozíció frissítése
            if KINEMATICS_AVAILABLE:
                self._joint_position = JointAngles(j1=x, j2=y, j3=z)
                self._cartesian_position = forward_kinematics(x, y, z, self._robot_config)
            
            return True
            
        except Exception as e:
            self._set_error(f"Move hiba: {str(e)}")
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
    
    async def jog_joint(self, axis: str, distance: float, speed: float = 500) -> bool:
        """Tengely relatív mozgatása (X/Y/Z)"""
        axis = axis.upper()
        if axis not in ['X', 'Y', 'Z']:
            return False

        # Invertálás alkalmazása ELŐBB (mert a limit ellenőrzés a GRBL irányra vonatkozik)
        actual_distance = distance
        if self._axis_invert.get(axis, False):
            actual_distance = -distance

        # Friss pozíció lekérése a limit ellenőrzés előtt
        await self.get_grbl_status()

        # Szoftveres limit ellenőrzés - az actual_distance alapján (invertálás UTÁN)
        # Dinamikus limiteket használunk ha konfigurálva vannak
        current_val = getattr(self._status.work_position, axis.lower(), 0.0)
        lo, hi = self._get_dynamic_limits(axis)
        
        # Biztonsági margó - korábban blokkol, hogy legyen idő megállni
        soft_limit_margin = 1.0
        
        # Blokkolás ha a limithez közel van ÉS abba az irányba próbál mozogni (GRBL irány)
        if actual_distance < 0 and current_val <= lo + soft_limit_margin:
            print(f"🛑 Soft limit: {axis} tengely negatív irányban blokkolva (current={current_val:.2f} <= min={lo:.2f}+margin)")
            return False
        if actual_distance > 0 and current_val >= hi - soft_limit_margin:
            print(f"🛑 Soft limit: {axis} tengely pozitív irányban blokkolva (current={current_val:.2f} >= max={hi:.2f}-margin)")
            return False
        
        # Kétirányú limit: Y mozgás előtt Z limit ellenőrzés
        # Ha Y mozgatása Z-t limiten kívülre vinné, blokkolunk
        if axis == 'Y' and 'Z' in self._dynamic_limit_config:
            z_limits = self._get_dynamic_limits('Z')
            z_val = getattr(self._status.work_position, 'z', 0.0)
            bidir_margin = 2.0
            
            # Y pozitív GRBL irány → Z limit felfelé tolódik → ha Z már felső limitnél, blokkolás
            if actual_distance > 0 and z_val <= z_limits[0] + bidir_margin:
                print(f"🛑 Kétirányú limit: Y pozitív blokkolva (Z={z_val:.2f} <= Z_min={z_limits[0]:.2f}+margin)")
                return False
            # Y negatív GRBL irány → Z limit lefelé tolódik → ha Z már alsó limitnél, blokkolás
            if actual_distance < 0 and z_val >= z_limits[1] - bidir_margin:
                print(f"🛑 Kétirányú limit: Y negatív blokkolva (Z={z_val:.2f} >= Z_max={z_limits[1]:.2f}-margin)")
                return False

        async with self._jog_lock:
            cmd = f"$J=G91 {axis}{actual_distance:.2f} F{speed:.0f}"
            response = await self._send_command(cmd)

            if self.GRBL_ERROR_PATTERN.search(response):
                return False

            # Limit monitor indítása folyamatos jog esetén (nagy távolság)
            if abs(actual_distance) > 100 and not self._limit_monitoring:
                self._current_jog_axis = axis
                self._current_jog_direction = 1 if actual_distance > 0 else -1
                self._limit_monitoring = True
                asyncio.create_task(self._limit_monitor_task())

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
            
            # X/Y/Z direkt pozíció
            ax = self._status.position.x
            ay = self._status.position.y
            az = self._status.position.z
            pos = forward_kinematics(ax, ay, az, self._robot_config)
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
