"""
GRBL Device Base - GRBL protokoll base osztály
Multi-Robot Control System

Ez az osztály a GRBL firmware-t használó eszközök közös
funkcionalitását tartalmazza (státusz lekérdezés, beállítások,
soft reset, unlock, jog stop).
"""

import asyncio
import re
from typing import Optional, Dict, List, Any
from enum import Enum
from dataclasses import dataclass, field

try:
    from serial_base import SerialDeviceBase
    from base import (
        DeviceType,
        DeviceState,
        DeviceStatus,
        DeviceCapabilities,
        Position,
    )
except ImportError:
    from .serial_base import SerialDeviceBase
    from .base import (
        DeviceType,
        DeviceState,
        DeviceStatus,
        DeviceCapabilities,
        Position,
    )


class GrblState(Enum):
    """GRBL belső állapotok"""
    IDLE = "Idle"
    RUN = "Run"
    HOLD = "Hold"
    JOG = "Jog"
    ALARM = "Alarm"
    DOOR = "Door"
    CHECK = "Check"
    HOME = "Home"
    SLEEP = "Sleep"


@dataclass
class GrblSettings:
    """GRBL beállítások ($$ parancs válasza)"""
    settings: Dict[int, float] = field(default_factory=dict)
    
    @property
    def steps_per_mm_x(self) -> float:
        return self.settings.get(100, 250.0)
    
    @property
    def steps_per_mm_y(self) -> float:
        return self.settings.get(101, 250.0)
    
    @property
    def steps_per_mm_z(self) -> float:
        return self.settings.get(102, 250.0)
    
    @property
    def max_rate_x(self) -> float:
        return self.settings.get(110, 500.0)
    
    @property
    def max_rate_y(self) -> float:
        return self.settings.get(111, 500.0)
    
    @property
    def max_rate_z(self) -> float:
        return self.settings.get(112, 500.0)
    
    @property
    def max_travel_x(self) -> float:
        return self.settings.get(130, 200.0)
    
    @property
    def max_travel_y(self) -> float:
        return self.settings.get(131, 200.0)
    
    @property
    def max_travel_z(self) -> float:
        return self.settings.get(132, 200.0)
    
    @property
    def laser_mode(self) -> bool:
        return self.settings.get(32, 0) == 1
    
    @property
    def soft_limits(self) -> bool:
        return self.settings.get(20, 0) == 1
    
    @property
    def hard_limits(self) -> bool:
        return self.settings.get(21, 0) == 1
    
    @property
    def step_idle_delay(self) -> int:
        """$1 - Step idle delay (ms). 255 = always on."""
        return int(self.settings.get(1, 25))


# GRBL -> DeviceState mapping
GRBL_STATE_MAP = {
    GrblState.IDLE: DeviceState.IDLE,
    GrblState.RUN: DeviceState.RUNNING,
    GrblState.HOLD: DeviceState.PAUSED,
    GrblState.JOG: DeviceState.JOG,
    GrblState.ALARM: DeviceState.ALARM,
    GrblState.HOME: DeviceState.HOMING,
    GrblState.DOOR: DeviceState.ALARM,
    GrblState.CHECK: DeviceState.IDLE,
    GrblState.SLEEP: DeviceState.IDLE,
}

# GRBL hiba kódok
GRBL_ERROR_CODES = {
    1: "G-code word consists of a G followed by a value",
    2: "Numeric value format is not valid",
    3: "Grbl '$' system command was not recognized",
    8: "Command requires Idle/Jog state (transient state window)",
    9: "G-code locked out during alarm or jog state",
    20: "Soft limit exceeded",
    22: "Homing fail - axis not moving",
    23: "Homing fail - limits engaged",
    24: "Homing fail - cycle failed",
}

# GRBL alarm kódok
GRBL_ALARM_CODES = {
    1: "Hard limit triggered",
    2: "Soft limit exceeded",
    3: "Reset while in motion",
    4: "Probe fail - contact not made",
    5: "Probe fail - initial state",
    6: "Homing fail - cycle reset",
    7: "Homing fail - door opened",
    8: "Homing fail - limits not found",
    9: "Homing fail - limits not cleared",
}


class GrblDeviceBase(SerialDeviceBase):
    """
    GRBL firmware-t használó eszközök base osztálya.
    
    Közös funkcionalitás:
    - GRBL válasz parsing (ok, error, status)
    - Státusz lekérdezés (?)
    - Beállítások kezelése ($$)
    - Soft reset (0x18)
    - Unlock ($X)
    - Feed hold (!)
    
    Használat:
        Származtass ebből az osztályból a konkrét eszközhöz
        (pl. GrblDevice, RobotArmDevice).
    """
    
    # GRBL válasz minták
    GRBL_OK_PATTERN = re.compile(r"^ok$", re.IGNORECASE)
    GRBL_ERROR_PATTERN = re.compile(r"^error:(\d+)$", re.IGNORECASE)
    GRBL_ALARM_PATTERN = re.compile(r"^ALARM:(\d+)$", re.IGNORECASE)
    GRBL_SETTING_PATTERN = re.compile(r"^\$(\d+)=(.+)$")
    
    # Státusz pattern - kezeli mind a GRBL 0.9 (,) mind a 1.1 (|) szeparátort
    # és az állapot alkódokat is (pl. Door:0, Hold:1)
    GRBL_STATE_PATTERN = re.compile(r"<(\w+(?::\d+)?)[,|]")
    GRBL_WPOS_PATTERN = re.compile(
        r"WPos:(-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*)"
    )
    GRBL_MPOS_PATTERN = re.compile(
        r"MPos:(-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*)"
    )
    
    # Full status pattern for compatibility
    GRBL_STATUS_PATTERN = re.compile(
        r"<(\w+)[,|]"
        r"MPos:(-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*)"
        r"(?:[,|]WPos:(-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*))?"
        r"(?:[,|].*?)?"
        r">"
    )
    
    # Supports classic "Grbl 1.1h" and grblHAL-like banners.
    GRBL_WELCOME_PATTERN = re.compile(r"Grbl(?:HAL)?\s+(\d+\.\d+\w*)", re.IGNORECASE)
    
    def __init__(
        self,
        device_id: str,
        device_name: str,
        device_type: DeviceType,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 2.0,
        max_feed_rate: float = None,
    ):
        super().__init__(
            device_id=device_id,
            device_name=device_name,
            device_type=device_type,
            port=port,
            baudrate=baudrate,
            timeout=timeout,
        )
        
        self._config_max_feed_rate = max_feed_rate
        self._grbl_version: Optional[str] = None
        self._grbl_state: GrblState = GrblState.IDLE
        self._grbl_settings: Optional[GrblSettings] = None
        
        # Status polling
        self._status_polling = False
        self._poll_task: Optional[asyncio.Task] = None
        
        # Jog stop flag - prevents status polling from changing state during jog_stop
        self._jog_stopping: bool = False
        
        # G-code file handling
        self._gcode_lines: List[str] = []
        self._current_line_index: int = 0
        self._running: bool = False
        self._paused: bool = False
        self._run_task: Optional[asyncio.Task] = None
    
    # =========================================
    # GRBL SPECIFIKUS SEND/READ OVERRIDE
    # =========================================
    
    async def _send_command(self, command: str, timeout: float = None) -> str:
        """
        Parancs küldése GRBL-specifikus kezeléssel.
        
        - '?' realtime parancs: nincs line terminator
        - Egyéb parancsok: \\r\\n lezárás
        """
        if not self.is_serial_open:
            raise ConnectionError("Nincs kapcsolat")
        
        async with self._serial_lock:
            cmd = command.strip()
            await self._flush_input_buffer_unlocked()
            
            # '?' GRBL realtime parancs - nem kell line terminator
            if cmd == '?':
                await asyncio.to_thread(self._serial.write, b'?')
            else:
                await asyncio.to_thread(self._serial.write, f"{cmd}\r\n".encode())
            
            return await self._read_response_unlocked(timeout=timeout)
    
    async def _read_response_unlocked(self, timeout: float = None) -> str:
        """
        GRBL válasz olvasása - "ok" vagy "error:X" lezárással.
        """
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
                        
                        # GRBL "ok" vagy "error:X" - azonnal visszatérünk
                        if self.GRBL_OK_PATTERN.match(line):
                            break
                        if self.GRBL_ERROR_PATTERN.match(line):
                            break
                        if self.GRBL_ALARM_PATTERN.match(line):
                            break
                except Exception:
                    pass
            else:
                # Ha van már válasz és nincs több adat
                if response_lines:
                    await asyncio.sleep(0.05)
                    in_waiting2 = await asyncio.to_thread(
                        lambda: self._serial.in_waiting if self._serial else 0
                    )
                    if in_waiting2 == 0:
                        break
                await asyncio.sleep(0.01)
            
            # Timeout
            if asyncio.get_event_loop().time() - start_time > timeout:
                break
        
        return "\n".join(response_lines)
    
    # =========================================
    # GRBL PROTOKOLL METÓDUSOK
    # =========================================
    
    async def _grbl_soft_reset(self) -> None:
        """GRBL soft reset (Ctrl-X, 0x18) küldése."""
        if not self.is_serial_open:
            return
        await asyncio.to_thread(self._serial.write, b'\x18')
        await asyncio.sleep(1.5)
        if self._serial.in_waiting:
            await asyncio.to_thread(self._serial.read, self._serial.in_waiting)
    
    async def _grbl_unlock(self) -> bool:
        """
        Door/Alarm unlock - több stratégiával próbálkozik.
        
        Returns:
            True ha sikerült Idle állapotba kerülni
        """
        # 1. próba: $X közvetlenül
        try:
            response = await self._send_command("$X", timeout=3.0)
            if "ok" in response.lower() or "unlocked" in response.lower():
                return True
        except Exception:
            pass
        
        # 2. próba: soft reset + $X
        await self._grbl_soft_reset()
        try:
            response = await self._send_command("$X", timeout=3.0)
            if "ok" in response.lower() or "unlocked" in response.lower():
                return True
        except Exception:
            pass
        
        # 3. próba: állapot ellenőrzése - lehet hogy már Idle
        status = await self.get_grbl_status()
        state = status.get('state', '').split(':')[0]
        return state == 'Idle'
    
    async def _grbl_feed_hold(self) -> None:
        """Feed hold (!) küldése - azonnal megállítja a mozgást."""
        if not self.is_serial_open:
            return
        await self._write_bytes(b"!")
    
    async def _grbl_cycle_start(self) -> None:
        """Cycle start (~) küldése - folytatja a mozgást."""
        if not self.is_serial_open:
            return
        await self._write_bytes(b"~")
    
    # =========================================
    # GRBL STÁTUSZ ÉS BEÁLLÍTÁSOK
    # =========================================
    
    async def get_grbl_status(self) -> Dict[str, Any]:
        """
        GRBL státusz lekérdezése '?' paranccsal.
        
        Returns:
            {'state': str, 'mpos': Position, 'wpos': Position}
        """
        if not self.is_serial_open:
            return {}
        
        try:
            response = await self._send_command("?", timeout=0.5)
            
            state_match = self.GRBL_STATE_PATTERN.search(response)
            mpos_match = self.GRBL_MPOS_PATTERN.search(response)
            wpos_match = self.GRBL_WPOS_PATTERN.search(response)
            
            if state_match:
                raw_state = state_match.group(1)
                base_state = raw_state.split(':')[0]
                
                # Parse positions
                mpos = Position()
                wpos = Position()
                
                if mpos_match:
                    mpos = Position(
                        x=float(mpos_match.group(1)),
                        y=float(mpos_match.group(2)),
                        z=float(mpos_match.group(3)),
                    )
                
                if wpos_match:
                    wpos = Position(
                        x=float(wpos_match.group(1)),
                        y=float(wpos_match.group(2)),
                        z=float(wpos_match.group(3)),
                    )
                elif mpos_match:
                    # WPos nem elérhető, MPos-t használjuk
                    wpos = mpos
                
                # Update internal state
                self._status.position = mpos
                self._status.work_position = wpos
                
                # Update device state
                try:
                    self._grbl_state = GrblState(base_state)
                    new_state = GRBL_STATE_MAP.get(self._grbl_state, DeviceState.IDLE)
                    if not self._jog_stopping:
                        self._set_state(new_state)
                except ValueError:
                    pass
                
                # Position callback
                if self.on_position_update:
                    self.on_position_update(self._status.position)
                
                return {
                    'state': raw_state,
                    'mpos': mpos,
                    'wpos': wpos,
                }
            
            return {}
            
        except Exception as e:
            return {}
    
    async def get_grbl_settings(self) -> Dict[int, float]:
        """
        GRBL beállítások lekérdezése '$$' paranccsal.
        
        Returns:
            Dict[setting_number, value]
        """
        if not self.is_serial_open:
            return {}
        
        def _parse_settings(response: str) -> Dict[int, float]:
            settings = {}
            for line in response.split('\n'):
                match = self.GRBL_SETTING_PATTERN.match(line)
                if match:
                    key = int(match.group(1))
                    value_str = match.group(2)
                    # Handle descriptions: "10 (step pulse, usec)"
                    value_str = value_str.split()[0].split('(')[0].strip()
                    try:
                        settings[key] = float(value_str)
                    except ValueError:
                        pass
            return settings
        
        try:
            response = await self._send_command("$$", timeout=5.0)
            settings = _parse_settings(response)
            
            # Ha üres, lehet Door/Alarm - próbáljuk unlock után
            if not settings:
                status = await self.get_grbl_status()
                state = status.get('state', '').split(':')[0]
                if state in ('Door', 'Alarm'):
                    await self._grbl_unlock()
                    await asyncio.sleep(0.5)
                    response = await self._send_command("$$", timeout=5.0)
                    settings = _parse_settings(response)
            
            if settings:
                self._grbl_settings = GrblSettings(settings=settings)
            
            return settings
            
        except Exception:
            return {}
    
    async def set_grbl_setting(self, setting: int, value: float) -> bool:
        """
        GRBL beállítás módosítása.
        
        Args:
            setting: Beállítás száma (pl. 100 = steps/mm X)
            value: Új érték
            
        Returns:
            True ha sikeres
        """
        try:
            # Integer-only settings must be sent without decimal point.
            if setting in (1, 4):
                command = f"${setting}={int(round(value))}"
            else:
                command = f"${setting}={value}"
            response = await self._send_command(command)
            return "ok" in response.lower()
        except Exception:
            return False
    
    # =========================================
    # STATUS POLLING
    # =========================================
    
    def _start_status_polling(self, interval: float = 0.2) -> None:
        """Állapot polling indítása."""
        if self._status_polling:
            return
        self._status_polling = True
        self._poll_task = asyncio.create_task(self._poll_status(interval))
    
    def _stop_status_polling(self) -> None:
        """Állapot polling leállítása."""
        self._status_polling = False
        if self._poll_task:
            self._poll_task.cancel()
            self._poll_task = None
    
    async def _poll_status(self, interval: float) -> None:
        """Állapot polling loop."""
        while self._status_polling and self._connected:
            try:
                jog_session_active = bool(getattr(self, "_jog_session_active", False))
                if self._status.state == DeviceState.JOG or jog_session_active:
                    # Streaming jog alatt ne kérdezzünk extra '?' státuszt pollingból,
                    # mert a $J= ciklussal lock-kontenciót és jittert okoz.
                    await asyncio.sleep(interval)
                    continue
                await self.get_grbl_status()
            except Exception:
                pass
            await asyncio.sleep(interval)
    
    # =========================================
    # JOG STOP - közös implementáció $J= parancsokhoz
    # =========================================
    
    async def jog_stop(self) -> bool:
        """
        Jog mozgás azonnali leállítása.
        
        A $J= jog parancsokkal a feed hold (!) automatikusan:
        - Azonnal megállítja a mozgást
        - Törli a jog buffert
        - Visszatér Idle állapotba
        - Motorok bekapcsolva maradnak
        
        Returns:
            True ha sikeres
        """
        self._jog_stopping = True
        async with self._jog_lock:
            try:
                if not self.is_serial_open:
                    self._jog_stopping = False
                    return False
                
                # Feed hold - azonnal megállítja és törli a $J= buffert
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
    
    # =========================================
    # DISCONNECT OVERRIDE
    # =========================================
    
    async def disconnect(self) -> None:
        """Kapcsolat bontása - polling leállítással."""
        self._stop_status_polling()
        await super().disconnect()
    
    # =========================================
    # GRBL ERROR HANDLING
    # =========================================
    
    def get_grbl_error_message(self, error_code: int) -> str:
        """GRBL hiba kód lefordítása üzenetre."""
        return GRBL_ERROR_CODES.get(error_code, f"Unknown error {error_code}")
    
    def get_grbl_alarm_message(self, alarm_code: int) -> str:
        """GRBL alarm kód lefordítása üzenetre."""
        return GRBL_ALARM_CODES.get(alarm_code, f"Unknown alarm {alarm_code}")
