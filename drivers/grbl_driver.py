"""
GRBL Device Driver - EleksMana és egyéb GRBL-alapú eszközökhöz
Multi-Robot Control System

Refaktorált verzió - GrblDeviceBase-ből örököl.
"""

import asyncio
import re
from typing import Optional, List, Dict, Any

try:
    from grbl_base import (
        GrblDeviceBase,
        GrblState,
        GrblSettings,
        GRBL_STATE_MAP,
        GRBL_ERROR_CODES,
    )
    from base import (
        DeviceType,
        DeviceState,
        DeviceStatus,
        DeviceCapabilities,
        Position,
    )
except ImportError:
    from .grbl_base import (
        GrblDeviceBase,
        GrblState,
        GrblSettings,
        GRBL_STATE_MAP,
        GRBL_ERROR_CODES,
    )
    from .base import (
        DeviceType,
        DeviceState,
        DeviceStatus,
        DeviceCapabilities,
        Position,
    )


class GrblDevice(GrblDeviceBase):
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
    
    def __init__(
        self,
        device_id: str,
        device_name: str,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        device_type: DeviceType = DeviceType.LASER_CUTTER,
        timeout: float = 2.0,
        max_feed_rate: Optional[float] = None,
    ):
        super().__init__(
            device_id=device_id,
            device_name=device_name,
            device_type=device_type,
            port=port,
            baudrate=baudrate,
            timeout=timeout,
            max_feed_rate=max_feed_rate,
        )
        
        # Ha config-ból jön max_feed_rate, frissítsük az alapértelmezett capabilities-t
        if max_feed_rate:
            self._capabilities.max_feed_rate = max_feed_rate
    
    # =========================================
    # KAPCSOLAT KEZELÉS
    # =========================================
    
    async def connect(self) -> bool:
        """GRBL eszközhöz csatlakozás"""
        try:
            self._set_state(DeviceState.CONNECTING)
            
            # Serial port megnyitása
            if not await self._open_serial():
                raise ConnectionError(f"Nem sikerült megnyitni: {self.port}")
            
            # Várakozás a GRBL inicializálására
            await asyncio.sleep(2.0)
            
            # Soft reset küldése
            await self._write_bytes(b"\x18")
            await asyncio.sleep(0.5)
            
            # Üdvözlő üzenet olvasása
            response = await self._read_response()
            if "Grbl" not in response:
                raise ConnectionError(f"Nem GRBL eszköz: {response}")
            
            # GRBL verzió kinyerése
            match = self.GRBL_WELCOME_PATTERN.search(response)
            if match:
                self._grbl_version = match.group(1)
            
            # Beállítások lekérdezése
            await self._load_settings()
            
            # Állapot lekérdezése
            await self.get_status()
            
            self._connected = True
            self._set_state(DeviceState.IDLE)
            
            # Állapot polling indítása
            self._start_status_polling(interval=0.1)
            
            return True
            
        except Exception as e:
            self._set_error(f"Csatlakozási hiba: {str(e)}")
            await self.disconnect()
            return False
    
    async def _load_settings(self) -> None:
        """GRBL beállítások betöltése és capabilities frissítése"""
        settings = await self.get_grbl_settings()
        
        if settings:
            self._grbl_settings = GrblSettings(settings=settings)
            
            # Capabilities frissítése a beállítások alapján
            grbl_max_rate = max(
                self._grbl_settings.max_rate_x,
                self._grbl_settings.max_rate_y,
                self._grbl_settings.max_rate_z,
            )
            effective_max_feed_rate = self._config_max_feed_rate if self._config_max_feed_rate else grbl_max_rate
            
            self._capabilities = DeviceCapabilities(
                axes=["X", "Y", "Z"],
                has_spindle=not self._grbl_settings.laser_mode,
                has_laser=self._grbl_settings.laser_mode,
                has_endstops=self._grbl_settings.hard_limits or self._grbl_settings.soft_limits,
                has_vacuum_pump=False,
                supports_motion_test=True,
                supports_firmware_probe=True,
                max_feed_rate=effective_max_feed_rate,
                work_envelope={
                    "x": self._grbl_settings.max_travel_x,
                    "y": self._grbl_settings.max_travel_y,
                    "z": self._grbl_settings.max_travel_z,
                },
            )
    
    # =========================================
    # ÁLLAPOT LEKÉRDEZÉS
    # =========================================
    
    async def get_status(self) -> DeviceStatus:
        """Aktuális állapot lekérdezése"""
        if not self.is_serial_open:
            return self._status
        
        await self.get_grbl_status()
        return self._status
    
    async def get_capabilities(self) -> DeviceCapabilities:
        """Eszköz képességek lekérdezése"""
        return self._capabilities
    
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
        async with self._jog_lock:
            try:
                axis = axis.upper()
                if axis not in ["X", "Y", "Z"]:
                    return False
                
                # GRBL $J= jog parancs - inkrementális mód
                cmd = f"$J=G91 {axis}{distance:.3f} F{feed_rate:.0f}"
                response = await self._send_command(cmd)
                
                return "ok" in response.lower()
                
            except Exception as e:
                self._set_error(f"Jog hiba: {str(e)}")
                return False
    
    async def jog_stop(self) -> bool:
        """
        Jog mozgás azonnali leállítása és buffer törlése.
        
        GRBL 0.9 esetén a $J= nem támogatott, ezért soft reset kell.
        """
        self._jog_stopping = True
        async with self._jog_lock:
            try:
                if not self.is_serial_open:
                    self._jog_stopping = False
                    return False
                
                # Feed hold küldése (azonnal megállítja a mozgást)
                await self._write_bytes(b"!")
                await asyncio.sleep(0.02)
                
                # Pozíció lekérdezése soft reset előtt
                saved_pos = Position()
                async with self._serial_lock:
                    await asyncio.to_thread(self._serial.write, b"?")
                    await asyncio.sleep(0.02)
                    in_waiting = await asyncio.to_thread(lambda: self._serial.in_waiting if self._serial else 0)
                    if in_waiting > 0:
                        line_bytes = await asyncio.to_thread(self._serial.readline)
                        response = line_bytes.decode().strip()
                        match = self.GRBL_STATUS_PATTERN.search(response)
                        if match:
                            saved_pos = Position(
                                x=float(match.group(2)),
                                y=float(match.group(3)),
                                z=float(match.group(4)),
                            )
                
                # Soft reset - törli a buffert és visszaállítja Idle-re
                await self._write_bytes(b"\x18")
                await asyncio.sleep(0.25)
                
                # Üdvözlő üzenet kiolvasása
                await self._read_response(timeout=0.25)
                
                # Unlock - a GRBL 0.9 esetén a soft reset után Alarm állapotba kerül
                try:
                    await self._send_command("$X")
                except Exception:
                    pass
                
                # Pozíció visszaállítása G92-vel
                await self._send_command(f"G92 X{saved_pos.x:.3f} Y{saved_pos.y:.3f} Z{saved_pos.z:.3f}")
                await asyncio.sleep(0.02)
                
                # Állapot visszaállítása
                self._set_state(DeviceState.IDLE)
                
                self._jog_stopping = False
                return True
            except Exception:
                self._jog_stopping = False
                return False
    
    # =========================================
    # G-CODE KÜLDÉS
    # =========================================
    
    async def send_gcode(self, gcode: str) -> str:
        """Egyedi G-code parancs küldése"""
        try:
            response = await self._send_command(gcode)
            
            # Hiba ellenőrzés
            error_match = self.GRBL_ERROR_PATTERN.search(response)
            if error_match:
                error_code = int(error_match.group(1))
                error_msg = self.get_grbl_error_message(error_code)
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
            if self.GRBL_ERROR_PATTERN.search(response):
                self._set_error(f"G-code hiba (sor {self._current_line_index + 1}): {response}")
                self._running = False
                break
            
            # Progress frissítése
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
            
            # Cancel run task if active
            if self._run_task and not self._run_task.done():
                self._run_task.cancel()
            
            # Soft reset
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
    # SPECIÁLIS FUNKCIÓK
    # =========================================
    
    async def set_laser_power(self, percent: float) -> bool:
        """Lézer teljesítmény beállítása"""
        if not self._grbl_settings or not self._grbl_settings.laser_mode:
            return False
        
        # S érték (0-1000 tipikusan)
        s_value = int((percent / 100.0) * 1000)
        response = await self.send_gcode(f"S{s_value}")
        return "ok" in response.lower()
    
    async def set_feed_override(self, percent: float) -> bool:
        """Feed rate override (GRBL nem támogatja közvetlenül)"""
        return False
    
    def get_info(self) -> Dict[str, Any]:
        """Eszköz információk lekérdezése"""
        info = super().get_info() if hasattr(super(), 'get_info') else {}
        info.update({
            "id": self.device_id,
            "name": self.device_name,
            "type": self.device_type.value,
            "connected": self._connected,
            "state": self._status.state.value,
            "grbl_version": self._grbl_version,
            "port": self.port,
        })
        return info
