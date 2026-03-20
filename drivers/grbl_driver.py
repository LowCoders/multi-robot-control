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
    from grbl_protocols import GrblProtocol, resolve_grbl_protocol
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
    from .grbl_protocols import GrblProtocol, resolve_grbl_protocol


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

        # Firmware-specifikus command stratégia (GRBL 1.1 vs 0.9x)
        self._protocol: GrblProtocol = resolve_grbl_protocol(None)

        # Utolsó jog diagnostika nyers adatai
        self._last_jog_trace: Dict[str, Any] = {}
        # Streaming jog session állapot
        self._jog_session_lock = asyncio.Lock()
        self._jog_session_task: Optional[asyncio.Task] = None
        self._jog_session_active: bool = False
        self._jog_session_axis: str = "X"
        self._jog_session_direction: float = 1.0
        self._jog_session_feed_rate: float = 100.0
        self._jog_session_tick_ms: int = 40
        self._jog_session_heartbeat_timeout: float = 0.5
        self._jog_session_last_beat: float = 0.0
        self._streaming_error8_retries: int = 0
        self._streaming_consecutive_error8: int = 0
        self._streaming_last_success_ts: float = 0.0
        self._adaptive_tick_ms: float = 40.0

    def _apply_jog_capabilities(self) -> None:
        """Ensure jog capability flags stay consistent with selected protocol."""
        self._capabilities.supports_streaming_jog = self._protocol.supports_streaming_jog
        self._capabilities.supports_hard_jog_stop = True

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
            elif "grblhal" in response.lower():
                # grblHAL fallback: protocol feature set is GRBL 1.1+.
                self._grbl_version = "1.1h"
            self._protocol = resolve_grbl_protocol(self._grbl_version)
            self._apply_jog_capabilities()
            
            # Beállítások lekérdezése
            await self._load_settings()
            self._apply_jog_capabilities()
            await self._restore_hold_settings_if_configured()
            
            # Állapot lekérdezése
            await self.get_status()
            
            self._connected = True
            self._set_state(DeviceState.IDLE)
            
            # Állapot polling indítása
            self._start_status_polling(interval=0.25)
            
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
                supports_streaming_jog=self._protocol.supports_streaming_jog,
                supports_hard_jog_stop=True,
                work_envelope={
                    "x": self._grbl_settings.max_travel_x,
                    "y": self._grbl_settings.max_travel_y,
                    "z": self._grbl_settings.max_travel_z,
                },
            )
        else:
            self._apply_jog_capabilities()
    
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

    def _extract_grbl_error(self, response: str) -> Optional[int]:
        """error:N kód kinyerése GRBL válaszból."""
        for line in response.splitlines():
            line = line.strip()
            match = self.GRBL_ERROR_PATTERN.match(line)
            if match:
                return int(match.group(1))
        return None

    async def _get_jog_state(self) -> str:
        """Aktuális GRBL state biztonságos lekérdezése jog előtt."""
        status = await self.get_grbl_status()
        raw_state = status.get("state", "") if status else ""
        return raw_state.split(":")[0] if raw_state else ""

    def _get_cached_jog_state(self) -> str:
        """Last known mapped device state without forcing a serial roundtrip."""
        current = self._status.state
        if current == DeviceState.IDLE:
            return "Idle"
        if current == DeviceState.JOG:
            return "Jog"
        if current == DeviceState.PAUSED:
            return "Hold"
        if current == DeviceState.ALARM:
            return "Alarm"
        if current == DeviceState.RUNNING:
            return "Run"
        return ""

    async def _restore_hold_settings_if_configured(self) -> None:
        """
        Re-apply hold-related startup settings after reset/stop paths.
        Tube bender startup config provides these as integer-key dict.
        """
        startup_settings = getattr(self, "_startup_grbl_settings", None)
        if not isinstance(startup_settings, dict) or not startup_settings:
            return
        for setting_key in (1, 4):
            if setting_key in startup_settings:
                try:
                    await self.set_grbl_setting(setting_key, float(startup_settings[setting_key]))
                except Exception:
                    pass

    async def _post_motion_stop_recovery(self) -> None:
        """
        Normalize state after stop/reset and restore hold torque settings.
        """
        try:
            await self.get_grbl_status()
        except Exception:
            pass
        await self._restore_hold_settings_if_configured()

    def get_jog_diagnostics(self) -> Dict[str, Any]:
        """Utolsó jog művelet diagnosztika."""
        return {
            "grbl_version": self._grbl_version,
            "protocol": self._protocol.name,
            "streaming_error8_retries": self._streaming_error8_retries,
            "last_jog_trace": self._last_jog_trace,
        }
    
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

                state_before = await self._get_jog_state()
                if state_before in ("Alarm", "Door"):
                    self._set_error(f"Jog tiltva {state_before} állapotban. Futtass reset/unlock műveletet.")
                    self._last_jog_trace = {
                        "success": False,
                        "state_before": state_before,
                        "grbl_version": self._grbl_version,
                        "protocol": self._protocol.name,
                        "commands": [],
                        "responses": [],
                        "error": "state_blocked",
                    }
                    return False

                commands = self._protocol.build_jog_commands(axis, distance, feed_rate)
                responses: List[str] = []

                for command in commands:
                    response = await self._send_command(command)
                    responses.append(response)

                    error_code = self._extract_grbl_error(response)
                    if error_code is not None:
                        error_message = self.get_grbl_error_message(error_code)
                        self._set_error(
                            f"Jog hiba ({self._protocol.name}, {command}): "
                            f"error:{error_code} - {error_message}"
                        )
                        self._last_jog_trace = {
                            "success": False,
                            "state_before": state_before,
                            "grbl_version": self._grbl_version,
                            "protocol": self._protocol.name,
                            "commands": commands,
                            "responses": responses,
                            "error_code": error_code,
                            "error_message": error_message,
                        }
                        return False

                success = all("ok" in response.lower() for response in responses if response.strip())
                if not success:
                    self._set_error(
                        f"Jog hiba ({self._protocol.name}): nem érkezett egyértelmű 'ok' válasz"
                    )

                self._last_jog_trace = {
                    "success": success,
                    "state_before": state_before,
                    "grbl_version": self._grbl_version,
                    "protocol": self._protocol.name,
                    "commands": commands,
                    "responses": responses,
                }
                return success
                
            except Exception as e:
                self._set_error(f"Jog hiba: {str(e)}")
                self._last_jog_trace = {
                    "success": False,
                    "state_before": None,
                    "grbl_version": self._grbl_version,
                    "protocol": self._protocol.name,
                    "commands": [],
                    "responses": [],
                    "error": str(e),
                }
                return False
    
    async def jog_stop(self) -> bool:
        """
        Jog mozgás azonnali leállítása és buffer törlése.
        
        GRBL 0.9 esetén a $J= nem támogatott, ezért soft reset kell.
        """
        if self._protocol.supports_streaming_jog:
            success = await super().jog_stop()
            if success:
                await self._post_motion_stop_recovery()
            return success

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
                await self._post_motion_stop_recovery()
                
                self._jog_stopping = False
                return True
            except Exception:
                self._jog_stopping = False
                return False

    async def hard_jog_stop(self) -> bool:
        """
        Agresszív jog stop: feed hold + soft reset + unlock.
        """
        self._jog_stopping = True
        async with self._jog_lock:
            try:
                if not self.is_serial_open:
                    self._jog_stopping = False
                    return False
                await self._grbl_feed_hold()
                await asyncio.sleep(0.02)
                await self._grbl_soft_reset()
                await asyncio.sleep(0.05)
                try:
                    await self._grbl_unlock()
                except Exception:
                    pass
                self._set_state(DeviceState.IDLE)
                await self._post_motion_stop_recovery()
                self._jog_stopping = False
                return True
            except Exception:
                self._jog_stopping = False
                return False

    async def start_jog_session(
        self,
        axis: str,
        direction: float,
        feed_rate: float,
        heartbeat_timeout: float = 0.5,
        tick_ms: int = 40,
        mode: Optional[str] = None,
    ) -> bool:
        """
        Folyamatos jog session indítása (GRBL 1.1+).
        """
        if not self._protocol.supports_streaming_jog:
            return False
        axis = axis.upper()
        if axis not in ["X", "Y", "Z"]:
            return False
        if direction == 0:
            return False
        feed_rate = max(1.0, float(feed_rate))
        direction = 1.0 if direction > 0 else -1.0

        async with self._jog_session_lock:
            self._jog_session_axis = axis
            self._jog_session_direction = direction
            self._jog_session_feed_rate = feed_rate
            self._jog_session_tick_ms = max(20, min(200, int(tick_ms)))
            self._jog_session_heartbeat_timeout = max(0.15, min(2.0, float(heartbeat_timeout)))
            self._jog_session_last_beat = asyncio.get_event_loop().time()
            self._streaming_last_success_ts = self._jog_session_last_beat

            if self._jog_session_task and not self._jog_session_task.done():
                self._jog_session_active = True
                return True

            state_before = await self._get_jog_state()
            if state_before in ("Alarm", "Door"):
                self._set_error(f"Streaming jog tiltva {state_before} állapotban.")
                return False

            self._jog_session_active = True
            self._set_state(DeviceState.JOG)
            self._jog_session_task = asyncio.create_task(self._run_jog_session_loop())
            return True

    async def update_jog_session(
        self,
        axis: Optional[str] = None,
        direction: Optional[float] = None,
        feed_rate: Optional[float] = None,
        mode: Optional[str] = None,
    ) -> bool:
        """
        Folyamatos jog session heartbeat/frissítés.
        """
        if not self._protocol.supports_streaming_jog:
            return False
        async with self._jog_session_lock:
            if not self._jog_session_active:
                return False
            if axis:
                axis = axis.upper()
                if axis in ["X", "Y", "Z"]:
                    self._jog_session_axis = axis
            if direction is not None and direction != 0:
                self._jog_session_direction = 1.0 if direction > 0 else -1.0
            if feed_rate is not None:
                self._jog_session_feed_rate = max(1.0, float(feed_rate))
            self._jog_session_last_beat = asyncio.get_event_loop().time()
            return True

    async def stop_jog_session(self, hard_stop: bool = False) -> bool:
        """
        Folyamatos jog session leállítás.
        """
        task_to_wait: Optional[asyncio.Task] = None
        async with self._jog_session_lock:
            self._jog_session_active = False
            self._jog_session_last_beat = 0.0
            if self._jog_session_task and not self._jog_session_task.done():
                task_to_wait = self._jog_session_task

        if task_to_wait:
            try:
                await asyncio.wait_for(task_to_wait, timeout=0.5)
            except asyncio.TimeoutError:
                task_to_wait.cancel()
            except asyncio.CancelledError:
                # A háttér session task normálisan cancel-ölődhet stop közben.
                pass
            except Exception:
                pass

        if hard_stop:
            return await self.hard_jog_stop()
        return await self.jog_stop()

    async def _send_streaming_jog_with_guard(
        self,
        command: str,
        max_retries: int = 5,
    ) -> Dict[str, Any]:
        """
        Send a streaming jog command with state-gating and transient error:8 retry.
        """
        for attempt in range(max_retries + 1):
            state_now = self._get_cached_jog_state()
            # Keep only hard safety gate locally; avoid per-tick status queries.
            if state_now in ("Alarm", "Door"):
                return {"ok": False, "error_code": 8, "state": state_now, "response": ""}

            response = await self._send_command(command, timeout=0.5)
            error_code = self._extract_grbl_error(response)
            if error_code == 8 and attempt < max_retries:
                self._streaming_error8_retries += 1
                await asyncio.sleep(0.01 * (attempt + 1))
                continue

            return {
                "ok": error_code is None,
                "error_code": error_code,
                "state": state_now,
                "response": response,
            }

        return {"ok": False, "error_code": 8, "state": "unknown", "response": ""}

    async def _run_jog_session_loop(self) -> None:
        """
        Streaming jog loop heartbeat timeout figyeléssel.
        """
        try:
            next_due = asyncio.get_event_loop().time()
            while True:
                async with self._jog_session_lock:
                    if not self._jog_session_active:
                        break
                    axis = self._jog_session_axis
                    direction = self._jog_session_direction
                    feed_rate = self._jog_session_feed_rate
                    tick_ms = self._jog_session_tick_ms
                    heartbeat_timeout = self._jog_session_heartbeat_timeout
                    last_beat = self._jog_session_last_beat

                now = asyncio.get_event_loop().time()
                if last_beat and now - last_beat > heartbeat_timeout:
                    # Watchdog stop: heartbeat megszakadt.
                    await self.hard_jog_stop()
                    async with self._jog_session_lock:
                        self._jog_session_active = False
                    break

                # Adapt tick to measured serial throughput to avoid planner starvation/jitter.
                effective_tick_ms = max(float(tick_ms), self._adaptive_tick_ms)
                tick_sec = effective_tick_ms / 1000.0
                distance = (feed_rate / 60.0) * tick_sec * direction
                if 0 < abs(distance) < 0.005:
                    distance = 0.005 if distance > 0 else -0.005
                # High feed rates require proportionally longer segments; otherwise
                # each short segment finishes too fast and leaves a visible stop-go gap.
                max_segment_mm = 90.0
                if abs(distance) > max_segment_mm:
                    distance = max_segment_mm if distance > 0 else -max_segment_mm
                effective_feed_rate = feed_rate

                commands = self._protocol.build_jog_commands(axis, distance, effective_feed_rate)
                for command in commands:
                    send_started = asyncio.get_event_loop().time()
                    send_result = await self._send_streaming_jog_with_guard(command, max_retries=3)
                    send_elapsed_ms = int((asyncio.get_event_loop().time() - send_started) * 1000)
                    if send_elapsed_ms > 0:
                        target_tick = max(float(tick_ms), min(200.0, send_elapsed_ms * 1.2))
                        self._adaptive_tick_ms = (self._adaptive_tick_ms * 0.75) + (target_tick * 0.25)
                    error_code = send_result.get("error_code")
                    if error_code == 8:
                        self._streaming_consecutive_error8 += 1
                        now_ts = asyncio.get_event_loop().time()
                        if (now_ts - self._streaming_last_success_ts) <= 3.0:
                            await asyncio.sleep(0.01 * min(self._streaming_consecutive_error8, 5))
                            continue
                    else:
                        self._streaming_consecutive_error8 = 0

                    if error_code is not None:
                        error_message = self.get_grbl_error_message(error_code)
                        blocked_state = send_result.get("state")
                        transient_flag = (
                            " transient_retry_exhausted=true"
                            if error_code == 8 and self._streaming_consecutive_error8 > 3
                            else ""
                        )
                        self._set_error(
                            f"Streaming jog hiba: error:{error_code} - {error_message}"
                            f" (state={blocked_state}){transient_flag}"
                        )
                        self._last_jog_trace = {
                            "success": False,
                            "error_code": error_code,
                            "error_message": error_message,
                            "state": blocked_state,
                            "transient_retry_exhausted": error_code == 8 and self._streaming_consecutive_error8 > 3,
                            "streaming_error8_retries": self._streaming_error8_retries,
                        }
                        await self.hard_jog_stop()
                        async with self._jog_session_lock:
                            self._jog_session_active = False
                        return
                    self._streaming_consecutive_error8 = 0
                    self._streaming_last_success_ts = asyncio.get_event_loop().time()

                next_due += tick_sec
                delay = next_due - asyncio.get_event_loop().time()
                if delay > 0:
                    await asyncio.sleep(delay)
                else:
                    next_due = asyncio.get_event_loop().time()
        finally:
            async with self._jog_session_lock:
                if self._jog_session_task and self._jog_session_task.done():
                    self._jog_session_task = None
            if self.state == DeviceState.JOG:
                self._set_state(DeviceState.IDLE)
    
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
            await self._post_motion_stop_recovery()
            
            self._set_state(DeviceState.IDLE)
            return True
        except Exception:
            return False
    
    async def reset(self) -> bool:
        """Alarm törlése, eszköz reset"""
        try:
            success = await self._grbl_unlock()
            if success:
                await self._post_motion_stop_recovery()
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
            "grbl_protocol": self._protocol.name,
            "port": self.port,
        })
        return info

    async def disconnect(self) -> None:
        """Kapcsolat bontása streaming jog leállítással."""
        try:
            await self.stop_jog_session(hard_stop=False)
        except Exception:
            pass
        await super().disconnect()
