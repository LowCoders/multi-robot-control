"""
Simulated Device Driver - Teszteléshez
Multi-Robot Control System

Ez a modul szimulált eszközöket biztosít a rendszer teszteléséhez,
valódi hardver nélkül.
"""

import asyncio
import random
import math
from typing import Optional, Callable, Any, List
from dataclasses import dataclass, field
from enum import Enum

from base import (
    DeviceDriver,
    DeviceType,
    DeviceState,
    DeviceStatus,
    DeviceCapabilities,
    Position,
)


class SimulationMode(Enum):
    """Szimulációs módok"""
    NORMAL = "normal"           # Normál működés
    RANDOM_ERRORS = "random_errors"  # Véletlenszerű hibák
    SLOW = "slow"               # Lassú válaszidők
    OFFLINE = "offline"         # Offline állapot


@dataclass
class SimulatedMotion:
    """Szimulált mozgás adatok"""
    target_x: float = 0.0
    target_y: float = 0.0
    target_z: float = 0.0
    speed: float = 1000.0  # mm/min
    is_moving: bool = False
    start_time: float = 0.0
    duration: float = 0.0


class SimulatedDevice(DeviceDriver):
    """
    Szimulált eszköz driver teszteléshez.
    
    Szimulálja:
    - Pozíció változásokat
    - Job futtatást progress-szel
    - Homing ciklust
    - Jog mozgásokat
    - Állapot változásokat
    - Hibákat (opcionálisan)
    """
    
    def __init__(
        self,
        device_id: str,
        name: str,
        device_type: DeviceType = DeviceType.CNC_MILL,
        simulation_mode: SimulationMode = SimulationMode.NORMAL,
        max_x: float = 300.0,
        max_y: float = 200.0,
        max_z: float = 100.0,
    ):
        super().__init__(device_id, name, device_type)
        
        self.simulation_mode = simulation_mode
        self.max_x = max_x
        self.max_y = max_y
        self.max_z = max_z
        
        # Eszköz állapot
        self._state = DeviceState.DISCONNECTED
        self.name = name  # Alias for device_name
        
        # Szimulált állapot
        self._position = Position(x=0.0, y=0.0, z=50.0)
        self._work_position = Position(x=0.0, y=0.0, z=50.0)
        self._motion = SimulatedMotion()
        self._feed_rate = 0.0
        self._spindle_speed = 0.0
        self._feed_override = 100
        self._spindle_override = 100
        
        # G-code futtatás
        self._gcode_lines: List[str] = []
        self._current_line = 0
        self._current_file: Optional[str] = None
        self._run_task: Optional[asyncio.Task] = None
        self._is_paused = False
        
        # Szimuláció task
        self._simulation_task: Optional[asyncio.Task] = None
        self._running = False
        
        # Capabilities
        self._capabilities = DeviceCapabilities(
            axes=["X", "Y", "Z"],
            has_spindle=device_type in [DeviceType.CNC_MILL, DeviceType.CNC_LATHE],
            has_laser=device_type == DeviceType.LASER_CUTTER,
            has_coolant=device_type == DeviceType.CNC_MILL,
            has_tool_changer=device_type == DeviceType.CNC_MILL,
            has_probe=True,
            max_feed_rate=5000.0,
            max_spindle_speed=24000.0 if device_type == DeviceType.CNC_MILL else 12000.0,
            max_laser_power=100.0 if device_type == DeviceType.LASER_CUTTER else 0.0,
            work_envelope={
                'x': max_x,
                'y': max_y,
                'z': max_z
            }
        )
        
        print(f"[SIM] Szimulált eszköz létrehozva: {name} ({device_type.value})")
    
    async def connect(self) -> bool:
        """Csatlakozás szimulálása"""
        if self.simulation_mode == SimulationMode.OFFLINE:
            print(f"[SIM] {self.name}: Offline mód - csatlakozás sikertelen")
            return False
        
        # Kis késleltetés a realisztikusság kedvéért
        await asyncio.sleep(0.3 if self.simulation_mode != SimulationMode.SLOW else 2.0)
        
        self._connected = True
        self._set_state(DeviceState.IDLE)
        
        # Indítjuk a szimulációs loop-ot
        self._running = True
        self._simulation_task = asyncio.create_task(self._simulation_loop())
        
        print(f"[SIM] {self.name}: Csatlakozva")
        return True
    
    async def disconnect(self) -> bool:
        """Lecsatlakozás"""
        self._running = False
        
        if self._simulation_task:
            self._simulation_task.cancel()
            try:
                await self._simulation_task
            except asyncio.CancelledError:
                pass
        
        if self._run_task:
            self._run_task.cancel()
            try:
                await self._run_task
            except asyncio.CancelledError:
                pass
        
        self._connected = False
        self._set_state(DeviceState.DISCONNECTED)
        
        print(f"[SIM] {self.name}: Lecsatlakozva")
        return True
    
    async def get_status(self) -> DeviceStatus:
        """Aktuális státusz lekérdezése"""
        progress = 0.0
        if self._gcode_lines and len(self._gcode_lines) > 0:
            progress = (self._current_line / len(self._gcode_lines)) * 100
        
        return DeviceStatus(
            state=self._state,
            position=self._position,
            work_position=self._work_position,
            feed_rate=self._feed_rate,
            spindle_speed=self._spindle_speed,
            feed_override=self._feed_override,
            spindle_override=self._spindle_override,
            current_line=self._current_line,
            total_lines=len(self._gcode_lines),
            progress=progress,
            current_file=self._current_file,
            error_message=self._status.error_message if self._status else None,
        )
    
    async def home(self, axes: Optional[List[str]] = None) -> bool:
        """Homing ciklus szimulálása"""
        if not self._connected:
            return False
        
        self._set_state(DeviceState.HOMING)
        print(f"[SIM] {self.name}: Homing indítása - {axes or 'összes tengely'}")
        
        # Szimuláljuk a homing-ot
        steps = 20
        for i in range(steps):
            await asyncio.sleep(0.1)
            
            # Fokozatosan mozgatjuk a pozíciót a nullához
            factor = 1 - (i + 1) / steps
            if not axes or 'X' in axes:
                self._position.x = self._position.x * factor
            if not axes or 'Y' in axes:
                self._position.y = self._position.y * factor
            if not axes or 'Z' in axes:
                # Z először felmegy, majd lemegy
                if i < steps // 2:
                    self._position.z = min(self._position.z + 2, self.max_z)
                else:
                    self._position.z = self._position.z * factor
            
            self._notify_position_change()
        
        # Nullázás
        if not axes or 'X' in axes:
            self._position.x = 0.0
        if not axes or 'Y' in axes:
            self._position.y = 0.0
        if not axes or 'Z' in axes:
            self._position.z = 0.0
        
        self._work_position = Position(
            x=self._position.x,
            y=self._position.y,
            z=self._position.z
        )
        
        self._notify_position_change()
        self._set_state(DeviceState.IDLE)
        
        print(f"[SIM] {self.name}: Homing kész")
        return True
    
    async def jog(self, axis: str, distance: float, feed_rate: float = 1000) -> bool:
        """Jog mozgás szimulálása"""
        if not self._connected or self._state not in [DeviceState.IDLE, DeviceState.JOG]:
            return False
        
        self._set_state(DeviceState.JOG)
        self._feed_rate = feed_rate
        
        # Célpozíció számítás
        target = getattr(self._position, axis.lower(), 0) + distance
        
        # Határok ellenőrzése
        max_val = getattr(self, f'max_{axis.lower()}', 300)
        target = max(0, min(target, max_val))
        
        # Mozgás szimulálása
        current = getattr(self._position, axis.lower(), 0)
        steps = max(1, int(abs(distance) / 0.5))  # 0.5mm lépésköz
        
        for i in range(steps):
            await asyncio.sleep(0.02)
            progress = (i + 1) / steps
            new_val = current + (target - current) * progress
            setattr(self._position, axis.lower(), new_val)
            setattr(self._work_position, axis.lower(), new_val)
            self._notify_position_change()
        
        # Végső pozíció
        setattr(self._position, axis.lower(), target)
        setattr(self._work_position, axis.lower(), target)
        self._notify_position_change()
        
        self._feed_rate = 0
        self._set_state(DeviceState.IDLE)
        
        return True
    
    async def jog_stop(self) -> bool:
        """Jog leállítása"""
        if self._state == DeviceState.JOG:
            self._set_state(DeviceState.IDLE)
        return True
    
    async def send_gcode(self, gcode: str) -> bool:
        """G-code parancs küldése"""
        if not self._connected:
            return False
        
        print(f"[SIM] {self.name}: G-code: {gcode}")
        
        # Egyszerű G-code értelmezés
        gcode = gcode.upper().strip()
        
        if gcode.startswith('G0') or gcode.startswith('G1'):
            # Rapid/Linear mozgás
            await self._parse_and_move(gcode)
        elif gcode.startswith('G28'):
            # Home
            await self.home()
        elif gcode.startswith('M3') or gcode.startswith('M03'):
            # Spindle ON
            self._spindle_speed = self._extract_value(gcode, 'S', 12000)
        elif gcode.startswith('M5') or gcode.startswith('M05'):
            # Spindle OFF
            self._spindle_speed = 0
        elif gcode.startswith('M30'):
            # Program end
            self._set_state(DeviceState.IDLE)
        
        return True
    
    async def _parse_and_move(self, gcode: str):
        """G-code mozgás értelmezése és végrehajtása"""
        x = self._extract_value(gcode, 'X')
        y = self._extract_value(gcode, 'Y')
        z = self._extract_value(gcode, 'Z')
        f = self._extract_value(gcode, 'F', 1000)
        
        if x is not None or y is not None or z is not None:
            target_x = x if x is not None else self._position.x
            target_y = y if y is not None else self._position.y
            target_z = z if z is not None else self._position.z
            
            await self._move_to(target_x, target_y, target_z, f)
    
    def _extract_value(self, gcode: str, letter: str, default: float = None) -> Optional[float]:
        """Érték kinyerése G-code-ból"""
        import re
        pattern = rf'{letter}(-?\d+\.?\d*)'
        match = re.search(pattern, gcode)
        if match:
            return float(match.group(1))
        return default
    
    async def _move_to(self, x: float, y: float, z: float, feed_rate: float):
        """Mozgás célpozícióba"""
        self._feed_rate = feed_rate
        
        # Távolság számítás
        dx = x - self._position.x
        dy = y - self._position.y
        dz = z - self._position.z
        distance = math.sqrt(dx*dx + dy*dy + dz*dz)
        
        if distance < 0.001:
            return
        
        # Idő számítás (feed_rate mm/min)
        duration = (distance / feed_rate) * 60  # másodpercben
        steps = max(1, int(duration / 0.05))  # 50ms lépésköz
        
        start_x, start_y, start_z = self._position.x, self._position.y, self._position.z
        
        for i in range(steps):
            await asyncio.sleep(0.05)
            progress = (i + 1) / steps
            
            self._position.x = start_x + dx * progress
            self._position.y = start_y + dy * progress
            self._position.z = start_z + dz * progress
            self._work_position.x = self._position.x
            self._work_position.y = self._position.y
            self._work_position.z = self._position.z
            
            self._notify_position_change()
        
        self._position.x = x
        self._position.y = y
        self._position.z = z
        self._work_position.x = x
        self._work_position.y = y
        self._work_position.z = z
        self._notify_position_change()
    
    async def load_file(self, filepath: str) -> bool:
        """G-code fájl betöltése (szimulált)"""
        print(f"[SIM] {self.name}: Fájl betöltése: {filepath}")
        
        # Fájlnév tárolása
        self._current_file = filepath
        
        # Próbáljuk meg a valódi fájlt betölteni, ha létezik
        try:
            with open(filepath, 'r') as f:
                self._gcode_lines = f.read().splitlines()
                print(f"[SIM] {self.name}: Valódi fájl betöltve: {len(self._gcode_lines)} sor")
        except FileNotFoundError:
            # Ha nem létezik, szimulált G-code generálása
            self._gcode_lines = self._generate_sample_gcode()
            print(f"[SIM] {self.name}: Szimulált G-code generálva: {len(self._gcode_lines)} sor")
        
        self._current_line = 0
        self._status.current_file = filepath
        self._status.total_lines = len(self._gcode_lines)
        
        return True
    
    def _generate_sample_gcode(self) -> List[str]:
        """Minta G-code generálása teszteléshez"""
        lines = [
            "G21 ; Metric",
            "G90 ; Absolute",
            "G0 Z5",
            "M3 S12000",
        ]
        
        # Négyzet mintázat
        for i in range(3):
            x_offset = i * 30
            lines.extend([
                f"G0 X{10 + x_offset} Y10",
                "G1 Z-2 F500",
                f"G1 X{40 + x_offset} F1000",
                f"G1 Y40",
                f"G1 X{10 + x_offset}",
                "G1 Y10",
                "G0 Z5",
            ])
        
        lines.extend([
            "G0 Z10",
            "M5",
            "G0 X0 Y0",
            "M30",
        ])
        
        return lines
    
    async def run(self, start_line: int = 0) -> bool:
        """Program futtatása"""
        if not self._connected or not self._gcode_lines:
            return False
        
        self._current_line = start_line
        self._is_paused = False
        self._set_state(DeviceState.RUNNING)
        
        print(f"[SIM] {self.name}: Program indítása ({len(self._gcode_lines)} sor)")
        
        self._run_task = asyncio.create_task(self._run_program())
        return True
    
    async def _run_program(self):
        """Program futtatás loop"""
        try:
            while self._current_line < len(self._gcode_lines):
                if self._is_paused:
                    await asyncio.sleep(0.1)
                    continue
                
                if self._state != DeviceState.RUNNING:
                    break
                
                line = self._gcode_lines[self._current_line]
                
                # Kommentek és üres sorok kihagyása
                if line.strip() and not line.strip().startswith(';') and not line.strip().startswith('('):
                    await self.send_gcode(line)
                
                self._current_line += 1
                
                # Progress frissítés
                progress = (self._current_line / len(self._gcode_lines)) * 100
                self._status.progress = progress
                self._status.current_line = self._current_line
                
                # Job progress callback
                if self.on_job_progress:
                    self.on_job_progress(progress, self._current_line, len(self._gcode_lines))
                
                # Kis késleltetés a sorok között
                await asyncio.sleep(0.05)
            
            # Program vége
            if self._state == DeviceState.RUNNING:
                self._set_state(DeviceState.IDLE)
                self._status.progress = 100.0
                print(f"[SIM] {self.name}: Program befejezve")
                
                # Job complete callback
                if self.on_job_complete and self._current_file:
                    self.on_job_complete(self._current_file)
                
        except asyncio.CancelledError:
            print(f"[SIM] {self.name}: Program megszakítva")
        except Exception as e:
            print(f"[SIM] {self.name}: Hiba: {e}")
            self._set_state(DeviceState.ALARM)
            self._status.error_message = str(e)
    
    async def pause(self) -> bool:
        """Program szüneteltetése"""
        if self._state == DeviceState.RUNNING:
            self._is_paused = True
            self._set_state(DeviceState.HOLD)
            print(f"[SIM] {self.name}: Szüneteltetve")
            return True
        return False
    
    async def resume(self) -> bool:
        """Program folytatása"""
        if self._state == DeviceState.HOLD:
            self._is_paused = False
            self._set_state(DeviceState.RUNNING)
            print(f"[SIM] {self.name}: Folytatva")
            return True
        return False
    
    async def stop(self) -> bool:
        """Program leállítása"""
        if self._run_task:
            self._run_task.cancel()
            try:
                await self._run_task
            except asyncio.CancelledError:
                pass
        
        self._is_paused = False
        self._current_line = 0
        self._spindle_speed = 0
        self._feed_rate = 0
        self._set_state(DeviceState.IDLE)
        
        print(f"[SIM] {self.name}: Leállítva")
        return True
    
    async def reset(self) -> bool:
        """Eszköz reset"""
        await self.stop()
        self._gcode_lines = []
        self._current_file = None
        self._status.error_message = None
        self._status.current_file = None
        self._status.total_lines = 0
        self._status.progress = 0.0
        self._set_state(DeviceState.IDLE)
        
        print(f"[SIM] {self.name}: Reset")
        return True
    
    async def set_feed_override(self, percent: int) -> bool:
        """Feed override beállítása"""
        self._feed_override = max(0, min(200, percent))
        print(f"[SIM] {self.name}: Feed override: {self._feed_override}%")
        return True
    
    async def set_spindle_override(self, percent: int) -> bool:
        """Spindle override beállítása"""
        self._spindle_override = max(0, min(200, percent))
        print(f"[SIM] {self.name}: Spindle override: {self._spindle_override}%")
        return True
    
    def get_info(self) -> dict:
        """Eszköz információk"""
        return {
            'id': self.device_id,
            'name': self.name,
            'type': self.device_type.value,
            'driver': 'simulated',
            'connected': self._connected,
            'state': self._state.value,
            'simulation_mode': self.simulation_mode.value,
            'work_area': {
                'x': self.max_x,
                'y': self.max_y,
                'z': self.max_z,
            }
        }
    
    def get_capabilities(self) -> DeviceCapabilities:
        """Eszköz képességek"""
        return self._capabilities
    
    async def _simulation_loop(self):
        """Háttér szimulációs loop - véletlenszerű események"""
        try:
            while self._running:
                await asyncio.sleep(1.0)
                
                if self.simulation_mode == SimulationMode.RANDOM_ERRORS:
                    # 1% eséllyel hiba generálása
                    if random.random() < 0.01:
                        self._set_state(DeviceState.ALARM)
                        self._status.error_message = "Szimulált hiba!"
                        if self.on_error:
                            self.on_error("Szimulált hiba!")
                
        except asyncio.CancelledError:
            pass
    
    def _notify_position_change(self):
        """Pozíció változás értesítés"""
        if self.on_position_update:
            self.on_position_update(self._position)
    
    def _set_state(self, new_state: DeviceState):
        """Állapot változás kezelése"""
        if self._state != new_state:
            old_state = self._state
            self._state = new_state
            self._status.state = new_state
            
            if self.on_state_change:
                self.on_state_change(old_state, new_state)


# Gyors teszt
if __name__ == "__main__":
    async def test():
        device = SimulatedDevice(
            device_id="sim_cnc",
            name="Szimulált CNC",
            device_type=DeviceType.CNC_MILL
        )
        
        # Callbacks
        device.set_on_state_change(lambda id, old, new: print(f"Állapot: {old.value} -> {new.value}"))
        device.set_on_position_change(lambda id, pos: print(f"Pozíció: X={pos.x:.2f} Y={pos.y:.2f} Z={pos.z:.2f}"))
        
        await device.connect()
        print(f"Státusz: {await device.get_status()}")
        
        await device.home()
        await device.jog('X', 50, 2000)
        await device.jog('Y', 30, 2000)
        
        await device.load_file("test.nc")
        await device.run()
        
        await asyncio.sleep(5)
        await device.stop()
        await device.disconnect()
    
    asyncio.run(test())
