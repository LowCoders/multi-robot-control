"""
Base Device Driver - Absztrakt interfész minden CNC eszközhöz
Multi-Robot Control System
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Callable, Dict, List, Any
import asyncio


class DeviceType(Enum):
    """Támogatott eszköz típusok"""
    CNC_MILL = "cnc_mill"
    CNC_LATHE = "cnc_lathe"
    LASER_CUTTER = "laser_cutter"
    LASER_ENGRAVER = "laser_engraver"
    PRINTER_3D = "printer_3d"
    ROBOT_ARM = "robot_arm"
    CONVEYOR = "conveyor"
    ROTARY_TABLE = "rotary_table"
    CUSTOM = "custom"


class DeviceState(Enum):
    """Eszköz állapotok"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    ALARM = "alarm"
    HOMING = "homing"
    PROBING = "probing"
    JOG = "jog"


@dataclass
class Position:
    """3D pozíció reprezentáció"""
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    a: float = 0.0  # 4. tengely (opcionális)
    b: float = 0.0  # 5. tengely (opcionális)
    c: float = 0.0  # 6. tengely (opcionális)
    
    def to_dict(self) -> Dict[str, float]:
        return {
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "a": self.a,
            "b": self.b,
            "c": self.c,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, float]) -> "Position":
        return cls(
            x=data.get("x", 0.0),
            y=data.get("y", 0.0),
            z=data.get("z", 0.0),
            a=data.get("a", 0.0),
            b=data.get("b", 0.0),
            c=data.get("c", 0.0),
        )


@dataclass
class DeviceCapabilities:
    """Eszköz képességek leírása"""
    axes: List[str] = field(default_factory=lambda: ["X", "Y", "Z"])
    has_spindle: bool = False
    has_laser: bool = False
    has_coolant: bool = False
    has_probe: bool = False
    has_tool_changer: bool = False
    has_gripper: bool = False
    has_sucker: bool = False
    max_feed_rate: float = 1000.0  # mm/min
    max_spindle_speed: float = 0.0  # RPM
    max_laser_power: float = 0.0  # %
    work_envelope: Dict[str, float] = field(default_factory=lambda: {
        "x": 300.0,
        "y": 400.0,
        "z": 80.0,
    })
    # Per-axis limits: {'X': (min, max), 'Y': (min, max), ...}
    axis_limits: Dict[str, tuple] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            "axes": self.axes,
            "has_spindle": self.has_spindle,
            "has_laser": self.has_laser,
            "has_coolant": self.has_coolant,
            "has_probe": self.has_probe,
            "has_tool_changer": self.has_tool_changer,
            "has_gripper": self.has_gripper,
            "has_sucker": self.has_sucker,
            "max_feed_rate": self.max_feed_rate,
            "max_spindle_speed": self.max_spindle_speed,
            "max_laser_power": self.max_laser_power,
            "work_envelope": self.work_envelope,
        }
        if self.axis_limits:
            result["axis_limits"] = {
                axis: {"min": lim[0], "max": lim[1]}
                for axis, lim in self.axis_limits.items()
            }
        return result


@dataclass
class DeviceStatus:
    """Eszköz aktuális állapota"""
    state: DeviceState = DeviceState.DISCONNECTED
    position: Position = field(default_factory=Position)
    work_position: Position = field(default_factory=Position)  # WCS pozíció
    feed_rate: float = 0.0  # mm/min
    spindle_speed: float = 0.0  # RPM
    laser_power: float = 0.0  # %
    progress: float = 0.0  # 0-100%
    current_line: int = 0
    total_lines: int = 0
    current_file: Optional[str] = None
    error_message: Optional[str] = None
    feed_override: float = 100.0  # %
    spindle_override: float = 100.0  # %
    # Robot arm specific
    gripper_state: Optional[str] = None   # 'open' | 'closed' | 'unknown'
    sucker_state: Optional[bool] = None   # True = on, False = off
    # Endstop states per axis: {'X': True/False, ...}
    endstop_states: Optional[Dict[str, bool]] = None
    # Endstop blocked directions: {'Y': 'positive', 'X': 'negative', ...}
    # Indicates which axis+direction is blocked by a triggered endstop
    endstop_blocked: Optional[Dict[str, str]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            "state": self.state.value,
            "position": self.position.to_dict(),
            "work_position": self.work_position.to_dict(),
            "feed_rate": self.feed_rate,
            "spindle_speed": self.spindle_speed,
            "laser_power": self.laser_power,
            "progress": self.progress,
            "current_line": self.current_line,
            "total_lines": self.total_lines,
            "current_file": self.current_file,
            "error_message": self.error_message,
            "feed_override": self.feed_override,
            "spindle_override": self.spindle_override,
        }
        # Robot arm fields - only include if set
        if self.gripper_state is not None:
            result["gripper_state"] = self.gripper_state
        if self.sucker_state is not None:
            result["sucker_state"] = self.sucker_state
        if self.endstop_states is not None:
            result["endstop_states"] = self.endstop_states
        if self.endstop_blocked is not None:
            result["endstop_blocked"] = self.endstop_blocked
        return result


class DeviceDriver(ABC):
    """
    Absztrakt base class minden device driverhez.
    
    Minden új eszköz típushoz ezt az osztályt kell implementálni.
    """
    
    # Eszköz alapadatok
    device_type: DeviceType
    device_id: str
    device_name: str
    
    # Belső állapot
    _connected: bool = False
    _status: DeviceStatus
    _capabilities: DeviceCapabilities
    
    # Event callbacks
    on_state_change: Optional[Callable[[DeviceState, DeviceState], None]] = None
    on_position_update: Optional[Callable[[Position], None]] = None
    on_error: Optional[Callable[[str], None]] = None
    on_job_complete: Optional[Callable[[str], None]] = None
    on_job_progress: Optional[Callable[[float, int, int], None]] = None
    
    def __init__(
        self,
        device_id: str,
        device_name: str,
        device_type: DeviceType = DeviceType.CUSTOM,
    ):
        self.device_id = device_id
        self.device_name = device_name
        self.device_type = device_type
        self._connected = False
        self._status = DeviceStatus()
        self._capabilities = DeviceCapabilities()
    
    @property
    def is_connected(self) -> bool:
        return self._connected
    
    @property
    def state(self) -> DeviceState:
        return self._status.state
    
    def _set_state(self, new_state: DeviceState) -> None:
        """Állapot változtatása callback hívással"""
        old_state = self._status.state
        if old_state != new_state:
            self._status.state = new_state
            if self.on_state_change:
                self.on_state_change(old_state, new_state)
    
    def _set_error(self, message: str) -> None:
        """Hiba beállítása callback hívással"""
        self._status.error_message = message
        self._set_state(DeviceState.ALARM)
        if self.on_error:
            self.on_error(message)
    
    # =========================================
    # ABSZTRAKT METÓDUSOK - KÖTELEZŐ IMPLEMENTÁLNI
    # =========================================
    
    @abstractmethod
    async def connect(self) -> bool:
        """
        Kapcsolat létrehozása az eszközzel.
        
        Returns:
            bool: True ha sikeres, False ha nem
        """
        pass
    
    @abstractmethod
    async def disconnect(self) -> None:
        """Kapcsolat bontása"""
        pass
    
    @abstractmethod
    async def get_status(self) -> DeviceStatus:
        """
        Aktuális állapot lekérdezése.
        
        Returns:
            DeviceStatus: Az eszköz aktuális állapota
        """
        pass
    
    @abstractmethod
    async def get_capabilities(self) -> DeviceCapabilities:
        """
        Eszköz képességek lekérdezése.
        
        Returns:
            DeviceCapabilities: Az eszköz képességei
        """
        pass
    
    @abstractmethod
    async def home(self, axes: Optional[List[str]] = None) -> bool:
        """
        Homing végrehajtása.
        
        Args:
            axes: Tengelyek listája (None = mind)
            
        Returns:
            bool: True ha sikeres
        """
        pass
    
    @abstractmethod
    async def jog(
        self,
        axis: str,
        distance: float,
        feed_rate: float,
    ) -> bool:
        """
        Manuális mozgatás (jog).
        
        Args:
            axis: Tengely neve (X, Y, Z, stb.)
            distance: Távolság mm-ben (negatív = ellenkező irány)
            feed_rate: Sebesség mm/min
            
        Returns:
            bool: True ha sikeres
        """
        pass
    
    @abstractmethod
    async def jog_stop(self) -> bool:
        """
        Jog mozgás leállítása.
        
        Returns:
            bool: True ha sikeres
        """
        pass
    
    @abstractmethod
    async def send_gcode(self, gcode: str) -> str:
        """
        Egyedi G-code parancs küldése (MDI mód).
        
        Args:
            gcode: G-code parancs
            
        Returns:
            str: Válasz az eszköztől
        """
        pass
    
    @abstractmethod
    async def load_file(self, filepath: str) -> bool:
        """
        G-code fájl betöltése.
        
        Args:
            filepath: Fájl útvonala
            
        Returns:
            bool: True ha sikeres
        """
        pass
    
    @abstractmethod
    async def run(self, from_line: int = 0) -> bool:
        """
        Program futtatás indítása/folytatása.
        
        Args:
            from_line: Kezdő sor (0 = elejétől)
            
        Returns:
            bool: True ha sikeres
        """
        pass
    
    @abstractmethod
    async def pause(self) -> bool:
        """
        Program megállítása (feed hold).
        
        Returns:
            bool: True ha sikeres
        """
        pass
    
    @abstractmethod
    async def resume(self) -> bool:
        """
        Program folytatása pause után.
        
        Returns:
            bool: True ha sikeres
        """
        pass
    
    @abstractmethod
    async def stop(self) -> bool:
        """
        Program leállítása.
        
        Returns:
            bool: True ha sikeres
        """
        pass
    
    @abstractmethod
    async def reset(self) -> bool:
        """
        Eszköz reset (alarm törlése).
        
        Returns:
            bool: True ha sikeres
        """
        pass
    
    # =========================================
    # OPCIONÁLIS METÓDUSOK - FELÜLÍRHATÓ
    # =========================================
    
    async def set_feed_override(self, percent: float) -> bool:
        """Feed rate override beállítása (0-200%)"""
        return False
    
    async def set_spindle_override(self, percent: float) -> bool:
        """Spindle speed override beállítása (0-200%)"""
        return False
    
    async def set_laser_power(self, percent: float) -> bool:
        """Lézer teljesítmény beállítása (0-100%)"""
        return False
    
    async def spindle_on(self, speed: float, clockwise: bool = True) -> bool:
        """Orsó bekapcsolása"""
        return False
    
    async def spindle_off(self) -> bool:
        """Orsó kikapcsolása"""
        return False
    
    async def coolant_on(self, flood: bool = True, mist: bool = False) -> bool:
        """Hűtés bekapcsolása"""
        return False
    
    async def coolant_off(self) -> bool:
        """Hűtés kikapcsolása"""
        return False
    
    async def probe(
        self,
        axis: str,
        direction: float,
        feed_rate: float,
    ) -> Optional[Position]:
        """
        Probing művelet.
        
        Returns:
            Position: Érintkezési pont, vagy None ha nem sikerült
        """
        return None
    
    async def set_work_offset(
        self,
        offset_id: str,
        position: Optional[Position] = None,
    ) -> bool:
        """
        Munkadarab nullpont beállítása.
        
        Args:
            offset_id: Offset azonosító (G54, G55, stb.)
            position: Új pozíció (None = aktuális pozíció)
        """
        return False
    
    # =========================================
    # ROBOT ARM SPECIFIC - OPCIONÁLIS
    # =========================================
    
    async def gripper_on(self) -> bool:
        """Megfogó bezárása"""
        return False
    
    async def gripper_off(self) -> bool:
        """Megfogó nyitása"""
        return False
    
    async def sucker_on(self) -> bool:
        """Szívó bekapcsolása"""
        return False
    
    async def sucker_off(self) -> bool:
        """Szívó kikapcsolása"""
        return False
    
    async def calibrate(self) -> bool:
        """Robot kalibráció"""
        return False
    
    async def enable(self) -> bool:
        """Robot engedélyezése"""
        return False
    
    async def disable(self) -> bool:
        """Robot letiltása"""
        return False
    
    def get_info(self) -> Dict[str, Any]:
        """Eszköz információk lekérdezése"""
        return {
            "id": self.device_id,
            "name": self.device_name,
            "type": self.device_type.value,
            "connected": self._connected,
            "state": self._status.state.value,
        }
