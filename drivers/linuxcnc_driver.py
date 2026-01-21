"""
LinuxCNC Device Driver - LinuxCNC vezérelt gépekhez
Multi-Robot Control System

Használathoz a LinuxCNC-nek futnia kell, és a Python modulnak 
elérhetőnek kell lennie (linuxcnc csomag).
"""

import asyncio
import os
from typing import Optional, List, Dict, Any
from pathlib import Path

# LinuxCNC Python modul importálása
try:
    import linuxcnc
    LINUXCNC_AVAILABLE = True
except ImportError:
    LINUXCNC_AVAILABLE = False

from base import (
    DeviceDriver,
    DeviceType,
    DeviceState,
    DeviceStatus,
    DeviceCapabilities,
    Position,
)


class LinuxCNCDevice(DeviceDriver):
    """
    LinuxCNC-alapú eszközök drivere.
    
    Támogatja:
    - CNC marók
    - CNC esztergák
    - Bármely LinuxCNC vezérelt gép
    
    Követelmény:
    - LinuxCNC-nek futnia kell
    - Python linuxcnc modul elérhető
    
    Használat:
        device = LinuxCNCDevice(
            device_id="cnc_main",
            device_name="CNC Maró",
            ini_file="/home/user/linuxcnc/configs/jp3163b/jp3163b.ini",
        )
        await device.connect()
    """
    
    # LinuxCNC állapotok -> DeviceState
    INTERP_STATE_MAP = {
        1: DeviceState.IDLE,      # INTERP_IDLE
        2: DeviceState.RUNNING,   # INTERP_READING
        3: DeviceState.PAUSED,    # INTERP_PAUSED
        4: DeviceState.RUNNING,   # INTERP_WAITING
    }
    
    TASK_STATE_MAP = {
        1: DeviceState.ALARM,     # STATE_ESTOP
        2: DeviceState.ALARM,     # STATE_ESTOP_RESET
        3: DeviceState.IDLE,      # STATE_OFF
        4: DeviceState.IDLE,      # STATE_ON
    }
    
    TASK_MODE_MAP = {
        1: "manual",    # MODE_MANUAL
        2: "auto",      # MODE_AUTO
        3: "mdi",       # MODE_MDI
    }
    
    def __init__(
        self,
        device_id: str,
        device_name: str,
        ini_file: Optional[str] = None,
        device_type: DeviceType = DeviceType.CNC_MILL,
    ):
        super().__init__(device_id, device_name, device_type)
        
        if not LINUXCNC_AVAILABLE:
            raise ImportError(
                "linuxcnc Python modul nem elérhető. "
                "Telepítsd a LinuxCNC-t és győződj meg róla, "
                "hogy a Python modul a PYTHONPATH-ban van."
            )
        
        self.ini_file = ini_file
        
        # LinuxCNC objektumok
        self._stat: Optional[linuxcnc.stat] = None
        self._command: Optional[linuxcnc.command] = None
        self._error: Optional[linuxcnc.error_channel] = None
        
        # Állapot polling
        self._status_polling = False
        self._poll_task: Optional[asyncio.Task] = None
        
        # Gép info (INI-ből)
        self._num_joints = 3
        self._axis_letters = ["X", "Y", "Z"]
    
    # =========================================
    # KAPCSOLAT KEZELÉS
    # =========================================
    
    async def connect(self) -> bool:
        """Csatlakozás a LinuxCNC-hez"""
        try:
            self._set_state(DeviceState.CONNECTING)
            
            # LinuxCNC objektumok létrehozása (non-blocking)
            self._stat = await asyncio.to_thread(linuxcnc.stat)
            self._command = await asyncio.to_thread(linuxcnc.command)
            self._error = await asyncio.to_thread(linuxcnc.error_channel)
            
            # Első állapot lekérdezés (non-blocking)
            await asyncio.to_thread(self._stat.poll)
            
            # Tengelyek számának lekérdezése
            self._num_joints = self._stat.joints
            
            # Capabilities beállítása
            await self._setup_capabilities()
            
            self._connected = True
            
            # Kezdeti állapot
            await self.get_status()
            
            # Állapot polling indítása
            self._start_status_polling()
            
            return True
            
        except linuxcnc.error as e:
            self._set_error(f"LinuxCNC hiba: {str(e)}")
            return False
        except Exception as e:
            self._set_error(f"Csatlakozási hiba: {str(e)}")
            return False
    
    async def disconnect(self) -> None:
        """Kapcsolat bontása"""
        self._stop_status_polling()
        
        self._stat = None
        self._command = None
        self._error = None
        
        self._connected = False
        self._set_state(DeviceState.DISCONNECTED)
    
    async def _setup_capabilities(self) -> None:
        """Capabilities beállítása az INI fájl alapján"""
        axes = []
        for i in range(min(self._num_joints, 6)):
            axes.append(["X", "Y", "Z", "A", "B", "C"][i])
        
        # Alap capabilities
        self._capabilities = DeviceCapabilities(
            axes=axes,
            has_spindle=True,
            has_coolant=True,
            has_probe=True,
            max_feed_rate=6000.0,  # mm/min
            max_spindle_speed=24000.0,
        )
        
        # INI fájl olvasása ha van
        if self.ini_file and os.path.exists(self.ini_file):
            await self._parse_ini_file()
    
    async def _parse_ini_file(self) -> None:
        """INI fájl feldolgozása a capabilities-hez"""
        try:
            import configparser
            config = configparser.ConfigParser()
            config.read(self.ini_file)
            
            # Munkatér méretek
            work_envelope = {}
            for axis in ["X", "Y", "Z"]:
                axis_section = f"AXIS_{axis}"
                if config.has_section(axis_section):
                    if config.has_option(axis_section, "MAX_LIMIT"):
                        max_val = config.getfloat(axis_section, "MAX_LIMIT")
                        min_val = config.getfloat(axis_section, "MIN_LIMIT", fallback=0)
                        work_envelope[axis.lower()] = max_val - min_val
            
            if work_envelope:
                self._capabilities.work_envelope = work_envelope
            
            # Max sebesség
            if config.has_section("TRAJ"):
                if config.has_option("TRAJ", "MAX_LINEAR_VELOCITY"):
                    max_vel = config.getfloat("TRAJ", "MAX_LINEAR_VELOCITY")
                    self._capabilities.max_feed_rate = max_vel * 60  # mm/s -> mm/min
            
            # Spindle
            if config.has_section("SPINDLE_0"):
                if config.has_option("SPINDLE_0", "MAX_FORWARD_VELOCITY"):
                    self._capabilities.max_spindle_speed = config.getfloat(
                        "SPINDLE_0", "MAX_FORWARD_VELOCITY"
                    )
                    
        except Exception:
            pass  # Ha nem sikerül, maradnak az alapértékek
    
    # =========================================
    # ÁLLAPOT LEKÉRDEZÉS
    # =========================================
    
    async def get_status(self) -> DeviceStatus:
        """Aktuális állapot lekérdezése (non-blocking)"""
        if not self._stat:
            return self._status
        
        try:
            await asyncio.to_thread(self._stat.poll)
            
            # Állapot meghatározása
            device_state = self._determine_state()
            self._set_state(device_state)
            
            # Pozíció
            # actual_position: tuple of floats for each axis
            pos = self._stat.actual_position
            self._status.position = Position(
                x=pos[0] if len(pos) > 0 else 0.0,
                y=pos[1] if len(pos) > 1 else 0.0,
                z=pos[2] if len(pos) > 2 else 0.0,
                a=pos[3] if len(pos) > 3 else 0.0,
                b=pos[4] if len(pos) > 4 else 0.0,
                c=pos[5] if len(pos) > 5 else 0.0,
            )
            
            # G5x offset (work coordinates)
            g5x = self._stat.g5x_offset
            self._status.work_position = Position(
                x=pos[0] - g5x[0] if len(pos) > 0 else 0.0,
                y=pos[1] - g5x[1] if len(pos) > 1 else 0.0,
                z=pos[2] - g5x[2] if len(pos) > 2 else 0.0,
            )
            
            # Feed és spindle
            self._status.feed_rate = self._stat.current_vel * 60  # units/s -> units/min
            self._status.spindle_speed = abs(self._stat.spindle[0]['speed']) if self._stat.spindle else 0.0
            
            # Override értékek
            self._status.feed_override = self._stat.feedrate * 100
            self._status.spindle_override = self._stat.spindle[0]['override'] * 100 if self._stat.spindle else 100.0
            
            # Program info
            self._status.current_file = self._stat.file or None
            self._status.current_line = self._stat.current_line
            self._status.total_lines = self._stat.total_lines if hasattr(self._stat, 'total_lines') else 0
            
            if self._status.total_lines > 0:
                self._status.progress = (self._status.current_line / self._status.total_lines) * 100
            
            # Pozíció callback
            if self.on_position_update:
                self.on_position_update(self._status.position)
            
            # Hiba csatorna ellenőrzése
            await self._check_errors()
            
        except linuxcnc.error as e:
            self._set_error(str(e))
        
        return self._status
    
    def _determine_state(self) -> DeviceState:
        """LinuxCNC állapot meghatározása"""
        if not self._stat:
            return DeviceState.DISCONNECTED
        
        # E-Stop ellenőrzés
        if self._stat.estop:
            return DeviceState.ALARM
        
        # Task state
        task_state = self._stat.task_state
        if task_state == 1:  # STATE_ESTOP
            return DeviceState.ALARM
        if task_state == 2:  # STATE_ESTOP_RESET
            return DeviceState.ALARM
        if task_state == 3:  # STATE_OFF
            return DeviceState.IDLE
        
        # Interpreter state
        interp_state = self._stat.interp_state
        if interp_state == 1:  # INTERP_IDLE
            return DeviceState.IDLE
        if interp_state == 2:  # INTERP_READING
            return DeviceState.RUNNING
        if interp_state == 3:  # INTERP_PAUSED
            return DeviceState.PAUSED
        if interp_state == 4:  # INTERP_WAITING
            return DeviceState.RUNNING
        
        # Homing ellenőrzés
        if self._stat.homed and not all(self._stat.homed):
            return DeviceState.HOMING
        
        return DeviceState.IDLE
    
    async def _check_errors(self) -> None:
        """Hibacsatorna ellenőrzése (non-blocking)"""
        if not self._error:
            return
        
        error = await asyncio.to_thread(self._error.poll)
        if error:
            kind, text = error
            if kind in (linuxcnc.NML_ERROR, linuxcnc.OPERATOR_ERROR):
                self._set_error(text)
    
    async def get_capabilities(self) -> DeviceCapabilities:
        """Eszköz képességek lekérdezése"""
        return self._capabilities
    
    # =========================================
    # ÁLLAPOT POLLING
    # =========================================
    
    def _start_status_polling(self, interval: float = 0.05) -> None:
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
    # SEGÉD METÓDUSOK
    # =========================================
    
    async def _wait_complete(self, timeout: float = 30.0) -> bool:
        """Várakozás amíg a parancs befejeződik (non-blocking)"""
        if not self._command:
            return False
        
        try:
            await asyncio.to_thread(self._command.wait_complete, timeout)
            return True
        except linuxcnc.error:
            return False
    
    async def _ensure_mode(self, mode: int) -> bool:
        """Mód váltás ha szükséges (non-blocking)"""
        if not self._stat or not self._command:
            return False
        
        await asyncio.to_thread(self._stat.poll)
        if self._stat.task_mode != mode:
            await asyncio.to_thread(self._command.mode, mode)
            await asyncio.to_thread(self._command.wait_complete)
        
        return True
    
    async def _ensure_enabled(self) -> bool:
        """Machine on állapot biztosítása (non-blocking)"""
        if not self._stat or not self._command:
            return False
        
        await asyncio.to_thread(self._stat.poll)
        
        # E-Stop reset ha kell
        if self._stat.estop:
            await asyncio.to_thread(self._command.state, linuxcnc.STATE_ESTOP_RESET)
            await asyncio.to_thread(self._command.wait_complete)
        
        # Machine on
        if self._stat.task_state != linuxcnc.STATE_ON:
            await asyncio.to_thread(self._command.state, linuxcnc.STATE_ON)
            await asyncio.to_thread(self._command.wait_complete)
        
        return True
    
    # =========================================
    # MOZGÁS VEZÉRLÉS
    # =========================================
    
    async def home(self, axes: Optional[List[str]] = None) -> bool:
        """Homing végrehajtása"""
        if not self._command:
            return False
        
        try:
            await self._ensure_enabled()
            await self._ensure_mode(linuxcnc.MODE_MANUAL)
            
            self._set_state(DeviceState.HOMING)
            
            if axes is None:
                # Összes tengely homing
                for joint in range(self._num_joints):
                    await asyncio.to_thread(self._command.home, joint)
                    await self._wait_complete()
            else:
                # Megadott tengelyek
                axis_map = {"X": 0, "Y": 1, "Z": 2, "A": 3, "B": 4, "C": 5}
                for axis in axes:
                    joint = axis_map.get(axis.upper())
                    if joint is not None and joint < self._num_joints:
                        await asyncio.to_thread(self._command.home, joint)
                        await self._wait_complete()
            
            self._set_state(DeviceState.IDLE)
            return True
            
        except linuxcnc.error as e:
            self._set_error(f"Homing hiba: {str(e)}")
            return False
    
    async def jog(
        self,
        axis: str,
        distance: float,
        feed_rate: float,
    ) -> bool:
        """Jog mozgás"""
        if not self._command:
            return False
        
        try:
            await self._ensure_enabled()
            await self._ensure_mode(linuxcnc.MODE_MANUAL)
            
            axis_map = {"X": 0, "Y": 1, "Z": 2, "A": 3, "B": 4, "C": 5}
            joint = axis_map.get(axis.upper())
            
            if joint is None or joint >= self._num_joints:
                return False
            
            # Sebesség beállítása (units/sec)
            velocity = feed_rate / 60.0
            
            # Inkrementális jog (non-blocking)
            await asyncio.to_thread(
                self._command.jog,
                linuxcnc.JOG_INCREMENT,
                False,  # joint mode
                joint,
                velocity,
                distance,
            )
            
            return True
            
        except linuxcnc.error as e:
            self._set_error(f"Jog hiba: {str(e)}")
            return False
    
    async def jog_stop(self) -> bool:
        """Jog leállítása"""
        if not self._command:
            return False
        
        try:
            for joint in range(self._num_joints):
                await asyncio.to_thread(
                    self._command.jog, linuxcnc.JOG_STOP, False, joint, 0, 0
                )
            return True
        except linuxcnc.error:
            return False
    
    # =========================================
    # G-CODE KÜLDÉS
    # =========================================
    
    async def send_gcode(self, gcode: str) -> str:
        """MDI parancs küldése"""
        if not self._command:
            return "error: Nincs kapcsolat"
        
        try:
            await self._ensure_enabled()
            await self._ensure_mode(linuxcnc.MODE_MDI)
            
            await asyncio.to_thread(self._command.mdi, gcode)
            await self._wait_complete()
            
            return "ok"
            
        except linuxcnc.error as e:
            return f"error: {str(e)}"
    
    async def load_file(self, filepath: str) -> bool:
        """G-code fájl betöltése"""
        if not self._command:
            return False
        
        if not os.path.exists(filepath):
            self._set_error(f"Fájl nem található: {filepath}")
            return False
        
        try:
            await self._ensure_enabled()
            await self._ensure_mode(linuxcnc.MODE_AUTO)
            
            await asyncio.to_thread(self._command.program_open, filepath)
            
            # Fájl info frissítése
            await asyncio.to_thread(self._stat.poll)
            self._status.current_file = filepath
            
            # Sorok számolása (file I/O is blocking)
            def count_lines():
                with open(filepath, 'r') as f:
                    return sum(1 for _ in f)
            
            self._status.total_lines = await asyncio.to_thread(count_lines)
            
            self._status.current_line = 0
            self._status.progress = 0.0
            
            return True
            
        except linuxcnc.error as e:
            self._set_error(f"Fájl betöltési hiba: {str(e)}")
            return False
    
    # =========================================
    # PROGRAM FUTTATÁS
    # =========================================
    
    async def run(self, from_line: int = 0) -> bool:
        """Program futtatás indítása"""
        if not self._command:
            return False
        
        try:
            await self._ensure_enabled()
            await self._ensure_mode(linuxcnc.MODE_AUTO)
            
            if from_line > 0:
                await asyncio.to_thread(self._command.auto, linuxcnc.AUTO_RUN, from_line)
            else:
                await asyncio.to_thread(self._command.auto, linuxcnc.AUTO_RUN)
            
            self._set_state(DeviceState.RUNNING)
            return True
            
        except linuxcnc.error as e:
            self._set_error(f"Indítási hiba: {str(e)}")
            return False
    
    async def pause(self) -> bool:
        """Program megállítása"""
        if not self._command:
            return False
        
        try:
            await asyncio.to_thread(self._command.auto, linuxcnc.AUTO_PAUSE)
            self._set_state(DeviceState.PAUSED)
            return True
        except linuxcnc.error as e:
            self._set_error(f"Pause hiba: {str(e)}")
            return False
    
    async def resume(self) -> bool:
        """Program folytatása"""
        if not self._command:
            return False
        
        try:
            await asyncio.to_thread(self._command.auto, linuxcnc.AUTO_RESUME)
            self._set_state(DeviceState.RUNNING)
            return True
        except linuxcnc.error as e:
            self._set_error(f"Resume hiba: {str(e)}")
            return False
    
    async def stop(self) -> bool:
        """Program leállítása"""
        if not self._command:
            return False
        
        try:
            await asyncio.to_thread(self._command.abort)
            await self._wait_complete()
            self._set_state(DeviceState.IDLE)
            return True
        except linuxcnc.error as e:
            self._set_error(f"Stop hiba: {str(e)}")
            return False
    
    async def reset(self) -> bool:
        """Alarm/E-Stop reset"""
        if not self._command:
            return False
        
        try:
            await asyncio.to_thread(self._command.state, linuxcnc.STATE_ESTOP_RESET)
            await asyncio.to_thread(self._command.wait_complete)
            
            await asyncio.to_thread(self._command.state, linuxcnc.STATE_ON)
            await asyncio.to_thread(self._command.wait_complete)
            
            self._status.error_message = None
            self._set_state(DeviceState.IDLE)
            return True
            
        except linuxcnc.error as e:
            self._set_error(f"Reset hiba: {str(e)}")
            return False
    
    # =========================================
    # OVERRIDE BEÁLLÍTÁSOK
    # =========================================
    
    async def set_feed_override(self, percent: float) -> bool:
        """Feed rate override beállítása"""
        if not self._command:
            return False
        
        try:
            # 0.0 - 2.0 (0% - 200%)
            await asyncio.to_thread(self._command.feedrate, percent / 100.0)
            return True
        except linuxcnc.error:
            return False
    
    async def set_spindle_override(self, percent: float) -> bool:
        """Spindle speed override beállítása"""
        if not self._command:
            return False
        
        try:
            await asyncio.to_thread(self._command.spindleoverride, percent / 100.0)
            return True
        except linuxcnc.error:
            return False
    
    # =========================================
    # SPINDLE & COOLANT
    # =========================================
    
    async def spindle_on(self, speed: float, clockwise: bool = True) -> bool:
        """Orsó bekapcsolása"""
        if not self._command:
            return False
        
        try:
            direction = linuxcnc.SPINDLE_FORWARD if clockwise else linuxcnc.SPINDLE_REVERSE
            await asyncio.to_thread(self._command.spindle, direction, speed)
            return True
        except linuxcnc.error:
            return False
    
    async def spindle_off(self) -> bool:
        """Orsó kikapcsolása"""
        if not self._command:
            return False
        
        try:
            await asyncio.to_thread(self._command.spindle, linuxcnc.SPINDLE_OFF)
            return True
        except linuxcnc.error:
            return False
    
    async def coolant_on(self, flood: bool = True, mist: bool = False) -> bool:
        """Hűtés bekapcsolása"""
        if not self._command:
            return False
        
        try:
            if flood:
                await asyncio.to_thread(self._command.flood, linuxcnc.FLOOD_ON)
            if mist:
                await asyncio.to_thread(self._command.mist, linuxcnc.MIST_ON)
            return True
        except linuxcnc.error:
            return False
    
    async def coolant_off(self) -> bool:
        """Hűtés kikapcsolása"""
        if not self._command:
            return False
        
        try:
            await asyncio.to_thread(self._command.flood, linuxcnc.FLOOD_OFF)
            await asyncio.to_thread(self._command.mist, linuxcnc.MIST_OFF)
            return True
        except linuxcnc.error:
            return False
    
    # =========================================
    # WORK OFFSET
    # =========================================
    
    async def set_work_offset(
        self,
        offset_id: str,
        position: Optional[Position] = None,
    ) -> bool:
        """Munkadarab nullpont beállítása"""
        # G54=1, G55=2, ..., G59.3=9
        offset_map = {
            "G54": 1, "G55": 2, "G56": 3, "G57": 4,
            "G58": 5, "G59": 6, "G59.1": 7, "G59.2": 8, "G59.3": 9,
        }
        
        offset_num = offset_map.get(offset_id.upper())
        if offset_num is None:
            return False
        
        if position is None:
            # Aktuális pozíció nullázása
            await self.send_gcode(f"G10 L20 P{offset_num} X0 Y0 Z0")
        else:
            await self.send_gcode(
                f"G10 L20 P{offset_num} X{position.x} Y{position.y} Z{position.z}"
            )
        
        return True
