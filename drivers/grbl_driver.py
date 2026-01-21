"""
GRBL Device Driver - EleksMana és egyéb GRBL-alapú eszközökhöz
Multi-Robot Control System
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
    settings: Dict[int, float]
    
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


class GrblDevice(DeviceDriver):
    """
    GRBL-alapú eszközök drivere.
    
    Támogatja:
    - EleksMana
    - Arduino + CNC Shield
    - Egyéb GRBL 1.1 kompatibilis boardok
    
    Használat:
        device = GrblDevice(
            device_id="laser_1",
            device_name="Lézervágó",
            port="/dev/ttyUSB0",
            baudrate=115200,
        )
        await device.connect()
    """
    
    # GRBL válasz minták
    STATUS_PATTERN = re.compile(
        r"<(\w+)\|"
        r"MPos:(-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*)"
        r"(?:\|WPos:(-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*))?"
        r"(?:\|.*?)?"
        r">"
    )
    OK_PATTERN = re.compile(r"^ok$", re.IGNORECASE)
    ERROR_PATTERN = re.compile(r"^error:(\d+)$", re.IGNORECASE)
    ALARM_PATTERN = re.compile(r"^ALARM:(\d+)$", re.IGNORECASE)
    SETTING_PATTERN = re.compile(r"^\$(\d+)=(.+)$")
    
    # GRBL hibaüzenetek
    GRBL_ERRORS = {
        1: "G-code word consists of a G followed by a value",
        2: "Numeric value format is not valid",
        3: "Grbl '$' system command was not recognized",
        9: "G-code locked out during alarm or jog state",
        20: "Soft limit exceeded",
        22: "Homing fail - axis not moving",
        23: "Homing fail - limits engaged",
        24: "Homing fail - cycle failed",
    }
    
    GRBL_ALARMS = {
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
    
    def __init__(
        self,
        device_id: str,
        device_name: str,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        device_type: DeviceType = DeviceType.LASER_CUTTER,
        timeout: float = 2.0,
    ):
        super().__init__(device_id, device_name, device_type)
        
        if not SERIAL_AVAILABLE:
            raise ImportError("pyserial csomag szükséges: pip install pyserial")
        
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        
        self._serial: Optional[serial.Serial] = None
        self._settings: Optional[GrblSettings] = None
        self._grbl_state: GrblState = GrblState.IDLE
        self._read_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._status_lock = asyncio.Lock()  # Separate lock for status queries
        self._status_polling = False
        self._poll_task: Optional[asyncio.Task] = None
        self._run_task: Optional[asyncio.Task] = None  # Track running program task
        
        # Gcode fájl kezelés
        self._gcode_lines: List[str] = []
        self._current_line_index: int = 0
        self._running: bool = False
        self._paused: bool = False
    
    # =========================================
    # KAPCSOLAT KEZELÉS
    # =========================================
    
    async def connect(self) -> bool:
        """GRBL eszközhöz csatlakozás"""
        try:
            self._set_state(DeviceState.CONNECTING)
            
            # Soros port megnyitása (blocking operation in thread)
            def open_serial():
                return serial.Serial(
                    port=self.port,
                    baudrate=self.baudrate,
                    timeout=self.timeout,
                    write_timeout=self.timeout,
                )
            
            self._serial = await asyncio.to_thread(open_serial)
            
            # Várakozás a GRBL inicializálására
            await asyncio.sleep(2.0)
            
            # Buffer ürítése (blocking in thread)
            await asyncio.to_thread(self._serial.reset_input_buffer)
            await asyncio.to_thread(self._serial.reset_output_buffer)
            
            # Soft reset küldése
            await self._write_bytes(b"\x18")  # Ctrl+X
            await asyncio.sleep(0.5)
            
            # Üdvözlő üzenet olvasása
            response = await self._read_response()
            if "Grbl" not in response:
                raise ConnectionError(f"Nem GRBL eszköz: {response}")
            
            # Beállítások lekérdezése
            await self._load_settings()
            
            # Állapot lekérdezése
            await self.get_status()
            
            self._connected = True
            self._set_state(DeviceState.IDLE)
            
            # Állapot polling indítása
            self._start_status_polling()
            
            return True
            
        except Exception as e:
            self._set_error(f"Csatlakozási hiba: {str(e)}")
            await self.disconnect()
            return False
    
    async def _write_bytes(self, data: bytes) -> None:
        """Write bytes to serial port asynchronously"""
        if not self._serial or not self._serial.is_open:
            return
        await asyncio.to_thread(self._serial.write, data)
    
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
        self._set_state(DeviceState.DISCONNECTED)
    
    # =========================================
    # ALACSONY SZINTŰ KOMMUNIKÁCIÓ
    # =========================================
    
    async def _send_command(self, command: str) -> str:
        """Parancs küldése és válasz olvasása"""
        if not self._serial or not self._serial.is_open:
            raise ConnectionError("Nincs kapcsolat")
        
        async with self._write_lock:
            # Parancs küldése (non-blocking)
            cmd = command.strip() + "\n"
            await asyncio.to_thread(self._serial.write, cmd.encode())
            
            # Válasz olvasása
            return await self._read_response()
    
    async def _read_response(self, timeout: float = None) -> str:
        """Válasz olvasása a soros portról"""
        if not self._serial:
            return ""
        
        async with self._read_lock:
            response_lines = []
            start_time = asyncio.get_event_loop().time()
            timeout = timeout or self.timeout
            
            while True:
                # Check in_waiting in thread to avoid blocking
                in_waiting = await asyncio.to_thread(lambda: self._serial.in_waiting if self._serial else 0)
                if in_waiting > 0:
                    try:
                        # Read line in thread
                        line_bytes = await asyncio.to_thread(self._serial.readline)
                        line = line_bytes.decode().strip()
                        if line:
                            response_lines.append(line)
                            
                            # Ha ok vagy error, befejezzük
                            if self.OK_PATTERN.match(line):
                                break
                            if self.ERROR_PATTERN.match(line):
                                break
                            if self.ALARM_PATTERN.match(line):
                                break
                    except Exception:
                        pass
                else:
                    await asyncio.sleep(0.01)
                
                # Timeout ellenőrzés
                if asyncio.get_event_loop().time() - start_time > timeout:
                    break
            
            return "\n".join(response_lines)
    
    async def _load_settings(self) -> None:
        """GRBL beállítások betöltése"""
        response = await self._send_command("$$")
        
        settings = {}
        for line in response.split("\n"):
            match = self.SETTING_PATTERN.match(line)
            if match:
                key = int(match.group(1))
                value = float(match.group(2))
                settings[key] = value
        
        self._settings = GrblSettings(settings=settings)
        
        # Capabilities frissítése a beállítások alapján
        if self._settings:
            self._capabilities = DeviceCapabilities(
                axes=["X", "Y", "Z"],
                has_spindle=not self._settings.laser_mode,
                has_laser=self._settings.laser_mode,
                max_feed_rate=max(
                    self._settings.max_rate_x,
                    self._settings.max_rate_y,
                    self._settings.max_rate_z,
                ),
                work_envelope={
                    "x": self._settings.max_travel_x,
                    "y": self._settings.max_travel_y,
                    "z": self._settings.max_travel_z,
                },
            )
    
    # =========================================
    # ÁLLAPOT LEKÉRDEZÉS
    # =========================================
    
    async def get_status(self) -> DeviceStatus:
        """Aktuális állapot lekérdezése"""
        if not self._serial or not self._serial.is_open:
            return self._status
        
        # Use lock to prevent race conditions with other commands
        async with self._status_lock:
            try:
                # Státusz lekérdezés (?) - non-blocking write
                await asyncio.to_thread(self._serial.write, b"?")
                await asyncio.sleep(0.05)
                
                in_waiting = await asyncio.to_thread(lambda: self._serial.in_waiting if self._serial else 0)
                if in_waiting > 0:
                    line_bytes = await asyncio.to_thread(self._serial.readline)
                    response = line_bytes.decode().strip()
                    self._parse_status(response)
            
            except Exception:
                pass
        
        return self._status
    
    def _parse_status(self, response: str) -> None:
        """Státusz válasz feldolgozása"""
        match = self.STATUS_PATTERN.search(response)
        if not match:
            return
        
        # Állapot
        state_str = match.group(1)
        try:
            self._grbl_state = GrblState(state_str)
        except ValueError:
            self._grbl_state = GrblState.IDLE
        
        # GRBL állapot -> DeviceState konverzió
        state_map = {
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
        self._set_state(state_map.get(self._grbl_state, DeviceState.IDLE))
        
        # Gép pozíció (MPos)
        self._status.position = Position(
            x=float(match.group(2)),
            y=float(match.group(3)),
            z=float(match.group(4)),
        )
        
        # Munka pozíció (WPos) - ha elérhető
        if match.group(5):
            self._status.work_position = Position(
                x=float(match.group(5)),
                y=float(match.group(6)),
                z=float(match.group(7)),
            )
        
        # Pozíció callback
        if self.on_position_update:
            self.on_position_update(self._status.position)
    
    async def get_capabilities(self) -> DeviceCapabilities:
        """Eszköz képességek lekérdezése"""
        return self._capabilities
    
    # =========================================
    # ÁLLAPOT POLLING
    # =========================================
    
    def _start_status_polling(self, interval: float = 0.1) -> None:
        """Állapot polling indítása"""
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
    # MOZGÁS VEZÉRLÉS
    # =========================================
    
    async def home(self, axes: Optional[List[str]] = None) -> bool:
        """Homing végrehajtása"""
        try:
            self._set_state(DeviceState.HOMING)
            response = await self._send_command("$H")
            
            if "ok" in response.lower():
                self._set_state(DeviceState.IDLE)
                return True
            else:
                self._set_error(f"Homing hiba: {response}")
                return False
                
        except Exception as e:
            self._set_error(f"Homing hiba: {str(e)}")
            return False
    
    async def jog(
        self,
        axis: str,
        distance: float,
        feed_rate: float,
    ) -> bool:
        """Jog mozgás"""
        try:
            axis = axis.upper()
            if axis not in ["X", "Y", "Z"]:
                return False
            
            # GRBL $J jog parancs
            cmd = f"$J=G91 {axis}{distance:.3f} F{feed_rate:.0f}"
            response = await self._send_command(cmd)
            
            return "ok" in response.lower()
            
        except Exception as e:
            self._set_error(f"Jog hiba: {str(e)}")
            return False
    
    async def jog_stop(self) -> bool:
        """Jog leállítása"""
        try:
            # Jog cancel (0x85) - non-blocking
            await self._write_bytes(b"\x85")
            return True
        except Exception:
            return False
    
    # =========================================
    # G-CODE KÜLDÉS
    # =========================================
    
    async def send_gcode(self, gcode: str) -> str:
        """Egyedi G-code parancs küldése"""
        try:
            response = await self._send_command(gcode)
            
            # Hiba ellenőrzés
            error_match = self.ERROR_PATTERN.search(response)
            if error_match:
                error_code = int(error_match.group(1))
                error_msg = self.GRBL_ERRORS.get(error_code, f"Unknown error {error_code}")
                return f"error: {error_msg}"
            
            return response
            
        except Exception as e:
            return f"error: {str(e)}"
    
    async def load_file(self, filepath: str) -> bool:
        """G-code fájl betöltése"""
        try:
            with open(filepath, "r") as f:
                lines = f.readlines()
            
            # Üres sorok és kommentek szűrése
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
            
            return True
            
        except Exception as e:
            self._set_error(f"Fájl betöltési hiba: {str(e)}")
            return False
    
    # =========================================
    # PROGRAM FUTTATÁS
    # =========================================
    
    async def run(self, from_line: int = 0) -> bool:
        """Program futtatás indítása"""
        if not self._gcode_lines:
            return False
        
        # Cancel any existing run task
        if self._run_task and not self._run_task.done():
            self._run_task.cancel()
            try:
                await self._run_task
            except asyncio.CancelledError:
                pass
        
        self._current_line_index = from_line
        self._running = True
        self._paused = False
        
        # Futtatás háttérfeladatként - store task reference
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
            
            # Következő sor küldése
            line = self._gcode_lines[self._current_line_index]
            response = await self._send_command(line)
            
            # Hiba ellenőrzés
            if self.ERROR_PATTERN.search(response):
                self._set_error(f"G-code hiba (sor {self._current_line_index + 1}): {response}")
                self._running = False
                break
            
            # Progress frissítése (safe division)
            self._current_line_index += 1
            self._status.current_line = self._current_line_index
            if total_lines > 0:
                self._status.progress = (self._current_line_index / total_lines) * 100
            else:
                self._status.progress = 100.0
            
            # Progress callback
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
        try:
            # Feed hold (!) - non-blocking
            await self._write_bytes(b"!")
            self._paused = True
            self._set_state(DeviceState.PAUSED)
            return True
        except Exception:
            return False
    
    async def resume(self) -> bool:
        """Program folytatása"""
        try:
            # Cycle start (~) - non-blocking
            await self._write_bytes(b"~")
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
            
            # Cancel run task if active
            if self._run_task and not self._run_task.done():
                self._run_task.cancel()
            
            # Soft reset - non-blocking
            await self._write_bytes(b"\x18")
            await asyncio.sleep(0.5)
            
            # Buffer ürítése - non-blocking
            if self._serial:
                await asyncio.to_thread(self._serial.reset_input_buffer)
            
            self._set_state(DeviceState.IDLE)
            return True
        except Exception:
            return False
    
    async def reset(self) -> bool:
        """Alarm törlése, eszköz reset"""
        try:
            # Unlock ($X)
            response = await self._send_command("$X")
            
            if "ok" in response.lower():
                self._status.error_message = None
                self._set_state(DeviceState.IDLE)
                return True
            else:
                return False
                
        except Exception as e:
            self._set_error(f"Reset hiba: {str(e)}")
            return False
    
    # =========================================
    # SPECIÁLIS FUNKCIÓK
    # =========================================
    
    async def set_laser_power(self, percent: float) -> bool:
        """Lézer teljesítmény beállítása"""
        if not self._settings or not self._settings.laser_mode:
            return False
        
        # S érték (0-1000 tipikusan)
        s_value = int((percent / 100.0) * 1000)
        response = await self.send_gcode(f"S{s_value}")
        return "ok" in response.lower()
    
    async def set_feed_override(self, percent: float) -> bool:
        """Feed rate override (GRBL nem támogatja közvetlenül)"""
        # GRBL real-time parancsok feed override-hoz
        # 0x90 = 100%, 0x91-0x9A = 10%-es lépések
        return False
    
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
