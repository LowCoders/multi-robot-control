#!/usr/bin/env python3
"""
ESP32 GRBL 6-Axis Board Teszt Script
=====================================

Interaktív diagnosztikai és konfigurációs eszköz az ESP32 GRBL 6-Axis
vezérlőkártyához. Segít a tengely irányok, kommunikáció és GRBL
beállítások tesztelésében.

Használat:
    python test_esp32_grbl.py                    # Alapértelmezett port (/dev/ttyUSB0)
    python test_esp32_grbl.py --port /dev/ttyUSB1
    python test_esp32_grbl.py -p COM3            # Windows

Főbb funkciók:
    1. Kommunikáció teszt - serial kapcsolat és GRBL válaszok
    2. Tengely irány teszt - egyesével mozgatja a tengelyeket
    3. GRBL beállítások - $$ lekérdezés és módosítás
    4. Step kalibráció - step/unit érték kiszámítása

GRBL $3 Direction Invert értékek:
    $3=0 - egyik sem invertálva
    $3=1 - X invertálva
    $3=2 - Y invertálva
    $3=3 - X+Y invertálva
    $3=4 - Z invertálva
    $3=5 - X+Z invertálva
    $3=6 - Y+Z invertálva
    $3=7 - mindhárom invertálva

Tengely-Joint mapping (robotkar):
    J1 (bázis)  -> GRBL Z tengely
    J2 (váll)   -> GRBL X tengely
    J3 (könyök) -> GRBL Y tengely
"""

import argparse
import re
import sys
import time
from typing import Optional, Dict, Tuple

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    print("❌ pyserial csomag szükséges: pip install pyserial")
    sys.exit(1)


# GRBL beállítások magyarázata
GRBL_SETTINGS_INFO = {
    0: ("Step pulse", "μs", "Lépés impulzus ideje (min 3μs, ajánlott 10μs)"),
    1: ("Step idle delay", "ms", "Motorok kikapcsolása inaktivitás után (255=mindig aktív)"),
    2: ("Step port invert", "mask", "Lépés impulzus invertálása (bitmask)"),
    3: ("Direction invert", "mask", "Irány invertálása: bit0=X, bit1=Y, bit2=Z"),
    4: ("Step enable invert", "bool", "Enable jel invertálása"),
    5: ("Limit pins invert", "bool", "Végállás kapcsolók invertálása"),
    6: ("Probe pin invert", "bool", "Szonda bemenet invertálása"),
    10: ("Status report", "mask", "Státusz report opciók (16=limit pins)"),
    11: ("Junction deviation", "mm", "Sarok eltérés"),
    12: ("Arc tolerance", "mm", "Ív tolerancia"),
    13: ("Report inches", "bool", "Inch mértékegység (0=mm)"),
    20: ("Soft limits", "bool", "Szoftveres végállások"),
    21: ("Hard limits", "bool", "Hardveres végállások"),
    22: ("Homing cycle", "bool", "Homing engedélyezése"),
    23: ("Homing dir invert", "mask", "Homing irány invertálása"),
    24: ("Homing feed", "mm/min", "Homing lassú sebesség"),
    25: ("Homing seek", "mm/min", "Homing gyors sebesség"),
    26: ("Homing debounce", "ms", "Homing kapcsoló pergésmentesítés"),
    27: ("Homing pull-off", "mm", "Visszahúzás végállásról"),
    30: ("Max spindle speed", "RPM", "Maximum orsó sebesség"),
    31: ("Min spindle speed", "RPM", "Minimum orsó sebesség"),
    32: ("Laser mode", "bool", "Lézer mód"),
    100: ("X steps/mm", "step/mm", "X tengely: lépések per mm (vagy fok)"),
    101: ("Y steps/mm", "step/mm", "Y tengely: lépések per mm (vagy fok)"),
    102: ("Z steps/mm", "step/mm", "Z tengely: lépések per mm (vagy fok)"),
    103: ("A steps/mm", "step/mm", "A tengely: lépések per mm"),
    110: ("X max rate", "mm/min", "X tengely max sebesség"),
    111: ("Y max rate", "mm/min", "Y tengely max sebesség"),
    112: ("Z max rate", "mm/min", "Z tengely max sebesség"),
    113: ("A max rate", "mm/min", "A tengely max sebesség"),
    120: ("X acceleration", "mm/s²", "X tengely gyorsulás"),
    121: ("Y acceleration", "mm/s²", "Y tengely gyorsulás"),
    122: ("Z acceleration", "mm/s²", "Z tengely gyorsulás"),
    123: ("A acceleration", "mm/s²", "A tengely gyorsulás"),
    130: ("X max travel", "mm", "X tengely max út"),
    131: ("Y max travel", "mm", "Y tengely max út"),
    132: ("Z max travel", "mm", "Z tengely max út"),
    133: ("A max travel", "mm", "A tengely max út"),
}


class ESP32GrblTester:
    """ESP32 GRBL 6-Axis board tesztelő"""
    
    GRBL_OK = re.compile(r"^ok$", re.IGNORECASE)
    GRBL_ERROR = re.compile(r"^error:(\d+)$", re.IGNORECASE)
    GRBL_ALARM = re.compile(r"^ALARM:(\d+)$", re.IGNORECASE)
    GRBL_WELCOME = re.compile(r"Grbl\s+(\S+)")
    GRBL_STATUS = re.compile(r"<(\w+(?::\d+)?)[,|].*>")
    
    def __init__(self, port: str, baudrate: int = 115200, timeout: float = 2.0):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self._serial: Optional[serial.Serial] = None
        self.grbl_version: Optional[str] = None
        self.settings: Dict[int, float] = {}
    
    def connect(self) -> bool:
        """Csatlakozás a board-hoz"""
        print(f"\n{'='*60}")
        print(f"  CSATLAKOZÁS: {self.port}")
        print(f"{'='*60}")
        
        try:
            self._serial = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=self.timeout,
                write_timeout=self.timeout,
            )
            print(f"  ✓ Serial port megnyitva ({self.baudrate} baud)")
            
            # Várakozás az inicializálásra - több iterációban olvassuk a welcome-ot
            print("  Várakozás a firmware inicializálására (3s)...")
            welcome = ""
            start = time.time()
            while time.time() - start < 3.0:
                time.sleep(0.2)
                if self._serial.in_waiting:
                    welcome += self._serial.read(self._serial.in_waiting).decode(errors='replace')
                    if self.GRBL_WELCOME.search(welcome):
                        break
            
            # GRBL verzió keresése
            match = self.GRBL_WELCOME.search(welcome)
            if match:
                self.grbl_version = match.group(1)
                print(f"  ✓ GRBL verzió: {self.grbl_version}")
            else:
                print(f"  ⚠ GRBL welcome nem érkezett")
                if welcome.strip():
                    print(f"    Válasz: {repr(welcome[:200])}")
            
            # Státusz teszt
            response = self.send_command("?")
            status_match = self.GRBL_STATUS.search(response)
            state = status_match.group(1) if status_match else None
            
            if state:
                print(f"  ✓ GRBL státusz: {state}")
            else:
                print(f"  ⚠ Státusz válasz: {repr(response[:80])}")
            
            # Auto-unlock Door/Alarm állapotban
            if state and (state.startswith('Door') or state.startswith('Alarm')):
                print(f"  ⚠ {state} állapot - automatikus unlock...")
                print(f"    Soft reset + $X küldése...")
                if self.unlock():
                    time.sleep(0.3)
                    new_state, _ = self.get_status()
                    print(f"  ✓ Unlock után: {new_state}")
                else:
                    new_state, _ = self.get_status()
                    print(f"  ⚠ Unlock után állapot: {new_state}")
                    if new_state.startswith('Door'):
                        print(f"  ℹ Door állapot nem oldható fel szoftveresen.")
                        print(f"    Lehetséges okok:")
                        print(f"    - Safety door pin (GPIO) lebeg vagy aktív")
                        print(f"    - Próbáld: $5=1 (limit pin invertálás)")
                        print(f"    - Vagy kösd a door pint GND-re/VCC-re")
            
            return True
            
        except serial.SerialException as e:
            print(f"  ❌ Serial hiba: {e}")
            return False
        except Exception as e:
            print(f"  ❌ Hiba: {e}")
            return False
    
    def disconnect(self):
        """Kapcsolat bontása"""
        if self._serial and self._serial.is_open:
            self._serial.close()
            print("  Kapcsolat bontva")
    
    def send_command(self, cmd: str, wait_ok: bool = False, timeout: Optional[float] = None) -> str:
        """Parancs küldése és válasz olvasása"""
        if not self._serial or not self._serial.is_open:
            return "error: not connected"
        
        timeout = timeout or self.timeout
        cmd = cmd.strip()
        
        # Buffer ürítés
        if self._serial.in_waiting:
            self._serial.read(self._serial.in_waiting)
        
        # '?' realtime parancs - nem kell newline
        if cmd == '?':
            self._serial.write(b'?')
        else:
            self._serial.write((cmd + "\n").encode())
        
        # Válasz olvasása
        response_lines = []
        start_time = time.time()
        no_data_count = 0
        
        while time.time() - start_time < timeout:
            if self._serial.in_waiting:
                line = self._serial.readline().decode(errors='replace').strip()
                if line:
                    response_lines.append(line)
                    no_data_count = 0
                    if self.GRBL_OK.match(line) or self.GRBL_ERROR.match(line):
                        if wait_ok:
                            break
            else:
                no_data_count += 1
                if response_lines and not wait_ok and no_data_count > 5:
                    break
                time.sleep(0.02)
        
        return "\n".join(response_lines)
    
    def get_settings(self) -> Dict[int, float]:
        """GRBL beállítások lekérdezése"""
        response = self.send_command("$$", timeout=5.0)
        settings = {}
        
        for line in response.split('\n'):
            match = re.match(r'\$(\d+)=(-?\d+\.?\d*)', line)
            if match:
                settings[int(match.group(1))] = float(match.group(2))
        
        # Ha nem jött semmi, lehet Door/Alarm - próbáljuk unlock után
        if not settings:
            state, _ = self.get_status()
            if state.startswith('Door') or state.startswith('Alarm'):
                self.unlock()
                time.sleep(0.5)
                response = self.send_command("$$", timeout=5.0)
                for line in response.split('\n'):
                    match = re.match(r'\$(\d+)=(-?\d+\.?\d*)', line)
                    if match:
                        settings[int(match.group(1))] = float(match.group(2))
        
        self.settings = settings
        return settings
    
    def set_setting(self, number: int, value: float) -> bool:
        """GRBL beállítás módosítása"""
        cmd = f"${number}={value}"
        response = self.send_command(cmd, wait_ok=True)
        return "ok" in response.lower()
    
    def get_status(self) -> Tuple[str, Dict[str, float]]:
        """GRBL státusz és pozíció lekérdezése"""
        response = self.send_command("?")
        
        # Állapot
        state = "Unknown"
        state_match = self.GRBL_STATUS.search(response)
        if state_match:
            state = state_match.group(1)
        
        # Pozíció (MPos vagy WPos)
        position = {'x': 0.0, 'y': 0.0, 'z': 0.0}
        pos_match = re.search(r'[MW]Pos:(-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*)', response)
        if pos_match:
            position['x'] = float(pos_match.group(1))
            position['y'] = float(pos_match.group(2))
            position['z'] = float(pos_match.group(3))
        
        return state, position
    
    def soft_reset(self):
        """Soft reset küldése (Ctrl-X, 0x18)"""
        if self._serial and self._serial.is_open:
            self._serial.write(b'\x18')
            time.sleep(1.5)
            if self._serial.in_waiting:
                self._serial.read(self._serial.in_waiting)
    
    def unlock(self) -> bool:
        """Alarm/Door unlock - több stratégiával próbálkozik"""
        # 1. próba: $X közvetlenül
        response = self.send_command("$X", wait_ok=True, timeout=3.0)
        if "ok" in response.lower() or "unlocked" in response.lower():
            return True
        
        # 2. próba: soft reset + $X
        self.soft_reset()
        response = self.send_command("$X", wait_ok=True, timeout=3.0)
        if "ok" in response.lower() or "unlocked" in response.lower():
            return True
        
        # 3. próba: állapot ellenőrzése - lehet hogy már Idle
        state, _ = self.get_status()
        if state.lower() == 'idle':
            return True
        
        return False
    
    def reset_position(self):
        """Pozíció nullázása (G92 X0 Y0 Z0)"""
        response = self.send_command("G92 X0 Y0 Z0", wait_ok=True)
        return "ok" in response.lower()
    
    def move_axis(self, axis: str, distance: float, speed: float = 500) -> bool:
        """Egy tengely mozgatása relatívan (G91)"""
        axis = axis.upper()
        if axis not in ['X', 'Y', 'Z', 'A', 'B', 'C']:
            return False
        
        # Inkrementális mód és mozgás
        self.send_command("G91", wait_ok=True)
        response = self.send_command(f"G1 {axis}{distance:.2f} F{speed:.0f}", wait_ok=True)
        self.send_command("G90", wait_ok=True)  # Vissza abszolút módba
        
        return "ok" in response.lower()
    
    def wait_idle(self, timeout: float = 10.0) -> bool:
        """Várakozás Idle állapotra"""
        start = time.time()
        while time.time() - start < timeout:
            state, _ = self.get_status()
            if state.lower() == 'idle':
                return True
            time.sleep(0.1)
        return False


def test_communication(tester: ESP32GrblTester):
    """Kommunikáció teszt"""
    print(f"\n{'='*60}")
    print("  KOMMUNIKÁCIÓ TESZT")
    print(f"{'='*60}")
    
    # Verzió
    print(f"\n  GRBL verzió: {tester.grbl_version or 'N/A'}")
    
    # Státusz
    state, pos = tester.get_status()
    print(f"  Állapot: {state}")
    print(f"  Pozíció: X={pos['x']:.3f} Y={pos['y']:.3f} Z={pos['z']:.3f}")
    
    # Beállítások
    settings = tester.get_settings()
    print(f"  Beállítások száma: {len(settings)}")
    
    if settings:
        print("\n  Fontos beállítások:")
        important = [3, 100, 101, 102, 110, 111, 112, 120, 121, 122]
        for num in important:
            if num in settings:
                info = GRBL_SETTINGS_INFO.get(num, ("", "", ""))
                print(f"    ${num}={settings[num]:.3f}  ({info[0]})")
    
    print(f"\n  ✓ Kommunikáció OK")


def test_direction(tester: ESP32GrblTester):
    """Tengely irány teszt - interaktív"""
    print(f"\n{'='*60}")
    print("  TENGELY IRÁNY TESZT")
    print(f"{'='*60}")
    print("""
  Ez a teszt egyesével mozgatja a tengelyeket, és megkérdezi,
  hogy a fizikai mozgás irány egyezik-e az elvárttal.

  Robotkar mapping:
    X tengely = J2 (váll)   - pozitív: felfelé
    Y tengely = J3 (könyök) - pozitív: kinyújtás
    Z tengely = J1 (bázis)  - pozitív: óramutató járásával megegyező

  ⚠ FIGYELEM: A tengelyek MOZOGNI FOGNAK!
  Győződj meg róla, hogy a robotkar szabadon mozoghat.
  """)
    
    input("  Nyomj ENTER-t a folytatáshoz (vagy Ctrl+C a kilépéshez)...")
    
    # Aktuális $3 érték
    settings = tester.get_settings()
    current_dir_invert = int(settings.get(3, 0))
    print(f"\n  Jelenlegi $3 (direction invert): {current_dir_invert} (bináris: {current_dir_invert:03b})")
    
    # Pozíció nullázás
    print("\n  Pozíció nullázása...")
    tester.reset_position()
    time.sleep(0.3)
    
    # Eredmények tárolása
    results = {}
    axes = [
        ('X', 'J2 (váll)', 'felfelé'),
        ('Y', 'J3 (könyök)', 'kinyújtás/előre'),
        ('Z', 'J1 (bázis)', 'óramutató járása szerint'),
    ]
    
    distance = 5.0  # Teszt távolság (egység) - rövid mozgás a biztonság kedvéért
    
    for axis, joint_name, expected_dir in axes:
        print(f"\n  --- {axis} tengely ({joint_name}) ---")
        print(f"  Elvárt pozitív irány: {expected_dir}")
        
        # Pozitív irányú mozgás
        print(f"\n  Mozgás: {axis}+{distance:.0f}...")
        tester.move_axis(axis, distance, speed=300)
        tester.wait_idle(timeout=5.0)
        
        # Felhasználói megerősítés
        while True:
            answer = input(f"  A {joint_name} {expected_dir} mozdult? (i/n/s=skip): ").strip().lower()
            if answer in ['i', 'n', 's']:
                break
            print("  Kérlek válaszolj 'i' (igen), 'n' (nem), vagy 's' (skip)!")
        
        if answer == 's':
            results[axis] = None
            print(f"  {axis} átugorva")
        elif answer == 'i':
            results[axis] = True
            print(f"  ✓ {axis} irány OK")
        else:
            results[axis] = False
            print(f"  ❌ {axis} irány FORDÍTOTT")
        
        # Vissza a nullába
        print(f"  Visszamozgás...")
        tester.move_axis(axis, -distance, speed=500)
        tester.wait_idle(timeout=5.0)
    
    # Eredmények összesítése
    print(f"\n{'='*60}")
    print("  EREDMÉNYEK")
    print(f"{'='*60}")
    
    wrong_axes = []
    for axis, correct in results.items():
        if correct is None:
            print(f"  {axis}: átugorva")
        elif correct:
            print(f"  {axis}: ✓ OK")
        else:
            print(f"  {axis}: ❌ FORDÍTOTT")
            wrong_axes.append(axis)
    
    # Javaslat a $3 módosítására
    if wrong_axes:
        print(f"\n  Javítás szükséges a következő tengelyekre: {', '.join(wrong_axes)}")
        
        # Új $3 érték számítása
        new_dir_invert = current_dir_invert
        axis_bits = {'X': 1, 'Y': 2, 'Z': 4}
        
        for axis in wrong_axes:
            bit = axis_bits[axis]
            new_dir_invert ^= bit  # Toggle bit
        
        print(f"\n  Jelenlegi $3={current_dir_invert} (bináris: {current_dir_invert:03b})")
        print(f"  Javasolt  $3={new_dir_invert} (bináris: {new_dir_invert:03b})")
        
        apply = input(f"\n  Alkalmazod az új beállítást? (i/n): ").strip().lower()
        if apply == 'i':
            if tester.set_setting(3, new_dir_invert):
                print(f"  ✓ $3={new_dir_invert} beállítva!")
                print("  Futtasd újra a tesztet az ellenőrzéshez.")
            else:
                print(f"  ❌ Nem sikerült beállítani!")
    else:
        print(f"\n  ✓ Minden tengely irány helyes!")


def show_settings(tester: ESP32GrblTester):
    """GRBL beállítások megjelenítése"""
    print(f"\n{'='*60}")
    print("  GRBL BEÁLLÍTÁSOK")
    print(f"{'='*60}")
    
    settings = tester.get_settings()
    
    if not settings:
        print("  ❌ Nem sikerült lekérdezni a beállításokat!")
        return
    
    print(f"\n  {'$#':<6} {'Érték':<12} {'Név':<20} {'Egység':<10} Leírás")
    print(f"  {'-'*80}")
    
    for num in sorted(settings.keys()):
        value = settings[num]
        info = GRBL_SETTINGS_INFO.get(num, ("???", "", ""))
        name, unit, desc = info
        
        # Kiemelt beállítások
        highlight = ""
        if num == 3:
            highlight = f" <- bináris: {int(value):03b}"
        elif num in [100, 101, 102]:
            highlight = " <- step/egység"
        
        print(f"  ${num:<5} {value:<12.3f} {name:<20} {unit:<10} {highlight}")


def change_setting(tester: ESP32GrblTester):
    """GRBL beállítás módosítása"""
    print(f"\n{'='*60}")
    print("  BEÁLLÍTÁS MÓDOSÍTÁSA")
    print(f"{'='*60}")
    
    print("\n  Gyakori beállítások:")
    print("    $3   - Direction invert (0-7)")
    print("    $100 - X steps/unit")
    print("    $101 - Y steps/unit")
    print("    $102 - Z steps/unit")
    print("    $110 - X max sebesség")
    print("    $120 - X gyorsulás")
    print()
    
    while True:
        cmd = input("  Adj meg beállítást ($N=érték) vagy 'q' a kilépéshez: ").strip()
        
        if cmd.lower() == 'q':
            break
        
        # Parse $N=value
        match = re.match(r'\$(\d+)=(-?\d+\.?\d*)', cmd)
        if not match:
            print("  ❌ Hibás formátum! Használat: $3=5")
            continue
        
        num = int(match.group(1))
        value = float(match.group(2))
        
        # Megerősítés
        info = GRBL_SETTINGS_INFO.get(num, ("Ismeretlen", "", ""))
        print(f"  Beállítás: ${num} ({info[0]}) = {value}")
        
        confirm = input("  Biztosan módosítod? (i/n): ").strip().lower()
        if confirm != 'i':
            print("  Megszakítva")
            continue
        
        if tester.set_setting(num, value):
            print(f"  ✓ ${num}={value} beállítva!")
        else:
            print(f"  ❌ Hiba a beállítás során!")


def test_step_calibration(tester: ESP32GrblTester):
    """Step kalibráció teszt"""
    print(f"\n{'='*60}")
    print("  STEP KALIBRÁCIÓ")
    print(f"{'='*60}")
    print("""
  Ez a teszt segít meghatározni a helyes step/unit értéket.
  
  1. Mozgatjuk a tengelyt egy ismert távolságra
  2. Te megméred a valós távolságot
  3. Kiszámoljuk a helyes step/unit értéket
  """)
    
    settings = tester.get_settings()
    
    # Tengely kiválasztása
    print("\n  Melyik tengelyt kalibráljuk?")
    print("    X - J2 (váll)")
    print("    Y - J3 (könyök)")
    print("    Z - J1 (bázis)")
    
    axis = input("  Tengely (X/Y/Z): ").strip().upper()
    if axis not in ['X', 'Y', 'Z']:
        print("  ❌ Érvénytelen tengely!")
        return
    
    # Aktuális step/unit
    step_setting = {'X': 100, 'Y': 101, 'Z': 102}[axis]
    current_steps = settings.get(step_setting, 640.0)
    print(f"\n  Jelenlegi ${step_setting}={current_steps:.3f} step/unit")
    
    # Parancsolt távolság
    try:
        commanded = float(input("  Parancsolt távolság (pl. 90 fok): ") or "90")
    except ValueError:
        print("  ❌ Érvénytelen szám!")
        return
    
    # Pozíció nullázás
    print("\n  Pozíció nullázása...")
    tester.reset_position()
    time.sleep(0.3)
    
    # Mozgás
    print(f"  Mozgás: {axis}+{commanded:.1f}...")
    input("  Nyomj ENTER-t a mozgás indításához...")
    
    tester.move_axis(axis, commanded, speed=200)
    tester.wait_idle(timeout=30.0)
    
    # Valós távolság mérése
    try:
        measured = float(input(f"\n  Mért valós távolság (fok vagy mm): "))
    except ValueError:
        print("  ❌ Érvénytelen szám!")
        return
    
    if measured <= 0:
        print("  ❌ A mért érték pozitív kell legyen!")
        return
    
    # Számítás
    # Ha commanded = 90, measured = 45, current_steps = 640
    # Akkor új_steps = current_steps * (commanded / measured)
    new_steps = current_steps * (commanded / measured)
    
    print(f"\n  Eredmény:")
    print(f"    Parancsolt: {commanded:.1f}")
    print(f"    Mért:       {measured:.1f}")
    print(f"    Arány:      {commanded/measured:.3f}")
    print(f"    Jelenlegi:  ${step_setting}={current_steps:.3f}")
    print(f"    Számított:  ${step_setting}={new_steps:.3f}")
    
    apply = input(f"\n  Alkalmazod az új értéket? (i/n): ").strip().lower()
    if apply == 'i':
        if tester.set_setting(step_setting, new_steps):
            print(f"  ✓ ${step_setting}={new_steps:.3f} beállítva!")
        else:
            print(f"  ❌ Hiba!")
    
    # Visszamozgás
    print("\n  Visszamozgás a kiindulási pozícióba...")
    state, pos = tester.get_status()
    current_pos = pos[axis.lower()]
    tester.move_axis(axis, -current_pos, speed=300)
    tester.wait_idle(timeout=30.0)


def send_gcode(tester: ESP32GrblTester):
    """Egyedi G-code küldése"""
    print(f"\n{'='*60}")
    print("  G-CODE KONZOL")
    print(f"{'='*60}")
    print("""
  Parancsok:
    ?          - Státusz lekérdezés
    $$         - Beállítások listázása
    $X         - Alarm unlock
    G92 X0...  - Pozíció nullázás
    G1 X10 F500 - Mozgás
    q          - Kilépés
  """)
    
    while True:
        cmd = input("  GCODE> ").strip()
        
        if cmd.lower() == 'q':
            break
        
        if not cmd:
            continue
        
        response = tester.send_command(cmd, wait_ok=True)
        
        # Több soros válasz formázása
        for line in response.split('\n'):
            print(f"    {line}")


def list_ports():
    """Elérhető portok listázása"""
    print(f"\n{'='*60}")
    print("  ELÉRHETŐ PORTOK")
    print(f"{'='*60}")
    
    ports = serial.tools.list_ports.comports()
    
    if not ports:
        print("  Nincs elérhető soros port!")
        return
    
    for port in ports:
        print(f"\n  {port.device}")
        print(f"    Leírás: {port.description}")
        if port.hwid:
            print(f"    HWID: {port.hwid}")


def main_menu(tester: ESP32GrblTester):
    """Főmenü"""
    while True:
        print(f"\n{'='*60}")
        print("  ESP32 GRBL TESZT - FŐMENÜ")
        print(f"{'='*60}")
        print("  1: Kommunikáció teszt")
        print("  2: Tengely irány teszt")
        print("  3: GRBL beállítások megjelenítése")
        print("  4: Beállítás módosítása")
        print("  5: Step kalibráció")
        print("  6: G-code konzol")
        print("  7: Státusz")
        print("  8: Pozíció nullázása")
        print("  q: Kilépés")
        
        cmd = input("\n  Válassz: ").strip().lower()
        
        if cmd == 'q':
            break
        elif cmd == '1':
            test_communication(tester)
        elif cmd == '2':
            test_direction(tester)
        elif cmd == '3':
            show_settings(tester)
        elif cmd == '4':
            change_setting(tester)
        elif cmd == '5':
            test_step_calibration(tester)
        elif cmd == '6':
            send_gcode(tester)
        elif cmd == '7':
            state, pos = tester.get_status()
            print(f"\n  Állapot: {state}")
            print(f"  Pozíció: X={pos['x']:.3f} Y={pos['y']:.3f} Z={pos['z']:.3f}")
        elif cmd == '8':
            tester.reset_position()
            print("  ✓ Pozíció nullázva (G92 X0 Y0 Z0)")
        else:
            print("  Ismeretlen parancs!")


def main():
    parser = argparse.ArgumentParser(
        description='ESP32 GRBL 6-Axis Board Teszt Script',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Példák:
  python test_esp32_grbl.py                    # /dev/ttyUSB0
  python test_esp32_grbl.py -p /dev/ttyUSB1
  python test_esp32_grbl.py --list             # Portok listázása
        """
    )
    
    parser.add_argument(
        '-p', '--port',
        default='/dev/ttyUSB0',
        help='Serial port (default: /dev/ttyUSB0)'
    )
    parser.add_argument(
        '-b', '--baudrate',
        type=int,
        default=115200,
        help='Baud rate (default: 115200)'
    )
    parser.add_argument(
        '--list',
        action='store_true',
        help='Elérhető portok listázása és kilépés'
    )
    
    args = parser.parse_args()
    
    if args.list:
        list_ports()
        return
    
    # Teszter létrehozása és csatlakozás
    tester = ESP32GrblTester(port=args.port, baudrate=args.baudrate)
    
    try:
        if not tester.connect():
            print("\n❌ Nem sikerült csatlakozni!")
            print("   Ellenőrizd:")
            print("   - A port helyes-e (használd --list)")
            print("   - A kábel csatlakoztatva van-e")
            print("   - A board kap-e tápot")
            return
        
        main_menu(tester)
        
    except KeyboardInterrupt:
        print("\n\n  Megszakítva (Ctrl+C)")
    finally:
        tester.disconnect()


if __name__ == "__main__":
    main()
