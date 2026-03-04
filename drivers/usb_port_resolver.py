"""
USB Port Resolver - Eszközök azonosítása USB attribútumok alapján
Multi-Robot Control System

Támogatott azonosítási módok (prioritási sorrendben):
1. serial_number - Egyedi sorozatszám (ha az eszköz rendelkezik vele)
2. vid:pid + location - VID/PID és USB port pozíció kombinálva
3. vid:pid - Vendor/Product ID alapján (első találat)
4. Statikus port - Fallback a megadott port útvonalra
"""

from dataclasses import dataclass
from typing import Optional, List, Dict, Any

try:
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False


@dataclass
class UsbIdentifier:
    """USB eszköz azonosító adatok"""
    serial_number: Optional[str] = None
    vid: Optional[str] = None  # hex string, pl. "1a86"
    pid: Optional[str] = None  # hex string, pl. "7523"
    location: Optional[str] = None

    def __str__(self) -> str:
        parts = []
        if self.serial_number:
            parts.append(f"serial={self.serial_number}")
        if self.vid and self.pid:
            parts.append(f"vid:pid={self.vid}:{self.pid}")
        if self.location:
            parts.append(f"location={self.location}")
        return ", ".join(parts) if parts else "empty"


def list_usb_devices() -> List[Dict[str, Any]]:
    """
    Összes USB-serial eszköz listázása diagnosztikai célra.
    
    Returns:
        Lista az eszközökről: port, vid, pid, serial_number, location, description, stb.
    """
    if not SERIAL_AVAILABLE:
        return []
    
    devices = []
    for port in serial.tools.list_ports.comports():
        if port.vid is None:
            continue
        
        devices.append({
            "port": port.device,
            "vid": f"{port.vid:04x}" if port.vid else None,
            "pid": f"{port.pid:04x}" if port.pid else None,
            "serial_number": port.serial_number,
            "location": port.location,
            "description": port.description,
            "manufacturer": port.manufacturer,
            "product": port.product,
            "hwid": port.hwid,
        })
    
    return devices


def find_by_serial(serial_number: str) -> Optional[str]:
    """
    Port keresése serial number alapján.
    
    Args:
        serial_number: Az eszköz egyedi sorozatszáma
        
    Returns:
        Port útvonal vagy None ha nem található
    """
    if not SERIAL_AVAILABLE:
        return None
    
    for port in serial.tools.list_ports.comports():
        if port.serial_number == serial_number:
            return port.device
    
    return None


def find_by_vid_pid(vid: str, pid: str, location: Optional[str] = None) -> Optional[str]:
    """
    Port keresése VID:PID alapján, opcionálisan location-nel szűkítve.
    
    Args:
        vid: Vendor ID hex string (pl. "1a86")
        pid: Product ID hex string (pl. "7523")
        location: USB port pozíció (opcionális, pl. "3-3")
        
    Returns:
        Port útvonal vagy None ha nem található
    """
    if not SERIAL_AVAILABLE:
        return None
    
    try:
        vid_int = int(vid, 16)
        pid_int = int(pid, 16)
    except (ValueError, TypeError):
        print(f"⚠️ Érvénytelen VID:PID formátum: {vid}:{pid}")
        return None
    
    matches = []
    for port in serial.tools.list_ports.comports():
        if port.vid == vid_int and port.pid == pid_int:
            if location is None:
                matches.append(port)
            elif port.location == location:
                return port.device
    
    if location is not None:
        return None
    
    if len(matches) == 1:
        return matches[0].device
    elif len(matches) > 1:
        ports_str = ", ".join(m.device for m in matches)
        print(f"⚠️ Több eszköz is egyezik (vid={vid}, pid={pid}): {ports_str}")
        print(f"   Használd a 'location' mezőt a pontos azonosításhoz!")
        return matches[0].device
    
    return None


def resolve_port(
    usb: Optional[UsbIdentifier] = None,
    fallback_port: Optional[str] = None
) -> Optional[str]:
    """
    Port meghatározása USB azonosító vagy fallback port alapján.
    
    Prioritási sorrend:
    1. serial_number alapján (ha megadva)
    2. vid:pid + location alapján (ha mindhárom megadva)
    3. vid:pid alapján (ha megadva, első találat)
    4. fallback_port (statikus port)
    5. None (nem található)
    
    Args:
        usb: USB azonosító adatok
        fallback_port: Statikus port útvonal fallback-ként
        
    Returns:
        Port útvonal vagy None ha nem található
    """
    if usb is None:
        return fallback_port
    
    if usb.serial_number:
        port = find_by_serial(usb.serial_number)
        if port:
            print(f"✓ Port találat serial_number alapján: {port}")
            return port
        print(f"⚠️ Nem található eszköz serial_number={usb.serial_number}")
    
    if usb.vid and usb.pid:
        port = find_by_vid_pid(usb.vid, usb.pid, usb.location)
        if port:
            loc_info = f" (location={usb.location})" if usb.location else ""
            print(f"✓ Port találat vid:pid alapján: {port}{loc_info}")
            return port
        loc_info = f", location={usb.location}" if usb.location else ""
        print(f"⚠️ Nem található eszköz vid={usb.vid}, pid={usb.pid}{loc_info}")
    
    if fallback_port:
        print(f"↪ Fallback port használata: {fallback_port}")
        return fallback_port
    
    return None
