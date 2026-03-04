"""
Serial Device Base - Közös serial kommunikáció base osztály
Multi-Robot Control System

Ez az osztály a serial porton keresztül kommunikáló eszközök közös
funkcionalitását tartalmazza (serial nyitás/zárás, írás, olvasás).
"""

import asyncio
from typing import Optional
from abc import abstractmethod

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False

try:
    from base import (
        JogSafeDeviceDriver,
        DeviceType,
        DeviceState,
    )
except ImportError:
    from .base import (
        JogSafeDeviceDriver,
        DeviceType,
        DeviceState,
    )


class SerialDeviceBase(JogSafeDeviceDriver):
    """
    Serial kommunikációt használó eszközök base osztálya.
    
    Közös funkcionalitás:
    - Serial port nyitás/zárás
    - Aszinkron írás/olvasás
    - Thread-safe kommunikáció (_serial_lock)
    
    Használat:
        Származtass ebből az osztályból és implementáld a
        protokoll-specifikus metódusokat (pl. GRBL, LinuxCNC).
    """
    
    def __init__(
        self,
        device_id: str,
        device_name: str,
        device_type: DeviceType,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 2.0,
    ):
        super().__init__(device_id, device_name, device_type)
        
        if not SERIAL_AVAILABLE:
            raise ImportError("pyserial csomag szükséges: pip install pyserial")
        
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        
        self._serial: Optional[serial.Serial] = None
        self._serial_lock = asyncio.Lock()
    
    # =========================================
    # SERIAL PORT KEZELÉS
    # =========================================
    
    async def _open_serial(self) -> bool:
        """
        Serial port megnyitása aszinkron módon.
        
        Returns:
            True ha sikeres, False ha nem
        """
        try:
            def open_serial():
                return serial.Serial(
                    port=self.port,
                    baudrate=self.baudrate,
                    timeout=self.timeout,
                    write_timeout=self.timeout,
                )
            
            self._serial = await asyncio.to_thread(open_serial)
            
            # Buffer ürítése
            await asyncio.to_thread(self._serial.reset_input_buffer)
            await asyncio.to_thread(self._serial.reset_output_buffer)
            
            return True
            
        except Exception as e:
            print(f"Serial port hiba: {e}")
            return False
    
    async def _close_serial(self) -> None:
        """Serial port bezárása."""
        if self._serial and self._serial.is_open:
            try:
                self._serial.close()
            except Exception:
                pass
        self._serial = None
    
    @property
    def is_serial_open(self) -> bool:
        """Serial port nyitva van-e."""
        return self._serial is not None and self._serial.is_open
    
    # =========================================
    # ALACSONY SZINTŰ KOMMUNIKÁCIÓ
    # =========================================
    
    async def _write_bytes(self, data: bytes) -> None:
        """
        Byte-ok írása a serial portra (aszinkron).
        
        Args:
            data: Küldendő byte-ok
        """
        if not self.is_serial_open:
            return
        await asyncio.to_thread(self._serial.write, data)
    
    async def _flush_input_buffer(self) -> None:
        """Input buffer ürítése."""
        if not self.is_serial_open:
            return
        if self._serial.in_waiting:
            await asyncio.to_thread(self._serial.read, self._serial.in_waiting)
    
    async def _send_command(self, command: str, timeout: float = None) -> str:
        """
        Parancs küldése és válasz olvasása (thread-safe).
        
        Ez az alap implementáció - a leszármazott osztályok
        felülírhatják protokoll-specifikus logikával.
        
        Args:
            command: Parancs string
            timeout: Optional timeout (default: self.timeout)
            
        Returns:
            Válasz string
        """
        if not self.is_serial_open:
            raise ConnectionError("Nincs kapcsolat")
        
        async with self._serial_lock:
            # Buffer ürítés a parancs előtt
            await self._flush_input_buffer_unlocked()
            
            # Parancs küldése
            cmd = command.strip() + "\n"
            await asyncio.to_thread(self._serial.write, cmd.encode())
            
            # Válasz olvasása
            return await self._read_response_unlocked(timeout=timeout)
    
    async def _send_command_no_response(self, command: str) -> None:
        """
        Parancs küldése ahol NEM várunk választ.
        
        Használat: módváltó parancsok (G90, G91), ahol a firmware
        nem küld választ.
        
        Args:
            command: Parancs string
        """
        if not self.is_serial_open:
            return
        
        async with self._serial_lock:
            await self._flush_input_buffer_unlocked()
            cmd = command.strip() + "\n"
            await asyncio.to_thread(self._serial.write, cmd.encode())
            await asyncio.sleep(0.1)
    
    async def _flush_input_buffer_unlocked(self) -> None:
        """Input buffer ürítése (lock nélkül - a hívónak kell lockolnia)."""
        if self._serial and self._serial.in_waiting:
            await asyncio.to_thread(self._serial.read, self._serial.in_waiting)
    
    async def _read_response_unlocked(self, timeout: float = None) -> str:
        """
        Válasz olvasása a soros portról (lock nélkül).
        
        A hívónak kell a _serial_lock-ot tartania.
        
        A leszármazott osztályok felülírhatják a protokoll-specifikus
        válasz feldolgozáshoz (pl. GRBL "ok" / "error" detektálás).
        
        Args:
            timeout: Timeout másodpercben (default: self.timeout)
            
        Returns:
            Válasz sorok összefűzve newline-nal
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
                        # Alap implementáció: nincs speciális lezáró karakter
                        # A leszármazottak felülírják
                except Exception:
                    pass
            else:
                # Ha van már válasz és nincs több adat, kész
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
    
    async def _read_response(self, timeout: float = None) -> str:
        """
        Válasz olvasása (lock-ot vesz a biztonság kedvéért).
        
        Args:
            timeout: Timeout másodpercben
            
        Returns:
            Válasz string
        """
        async with self._serial_lock:
            return await self._read_response_unlocked(timeout)
    
    # =========================================
    # DISCONNECT - közös implementáció
    # =========================================
    
    async def disconnect(self) -> None:
        """Kapcsolat bontása - közös serial cleanup."""
        await self._close_serial()
        self._connected = False
        self._set_state(DeviceState.DISCONNECTED)
    
    # =========================================
    # SEGÉD METÓDUSOK
    # =========================================
    
    @staticmethod
    def list_ports() -> list:
        """
        Elérhető serial portok listázása.
        
        Returns:
            Lista dict-ekkel: {'port': str, 'description': str, 'hwid': str}
        """
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
