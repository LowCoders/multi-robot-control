#!/usr/bin/env python3
"""
Endstop Range Finder Test - Végállás teszt és mozgástartomány mérés
====================================================================

Végigmozgatja az összes kart a végállásokig mindkét irányban,
és megméri a teljes mozgástartományt fokokban.

Algoritmus:
  1. G92 X0 Y0 Z0 - aktuális pozíció nullázása
  2. Minden tengelyre (X, Y, Z):
     a. G91 relatív módba kapcsolás
     b. Kis lépésekben pozitív irányba mozgatás
     c. Minden lépés után M119 végállás-lekérdezés
     d. Ha végállás aktiválódik -> pozíció rögzítése
     e. Visszamozgás, majd negatív irányba ugyanez
  3. Eredmény: minden tengely valós mozgástartománya

Biztonság:
  - Alacsony sebesség (F10-F20)
  - Maximum keresés-határ (200 fok)
  - Végállás aktiválásnál azonnali megállás

Használat:
  Önálló:     python3 endstop_test.py [--port /dev/ttyUSB0]
  Importálva: from endstop_test import EndstopTest
"""

import sys
import time
import re
import argparse
import json
import threading
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime

try:
    import serial
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False


# ============================================================
# Eredmény típusok
# ============================================================

@dataclass
class AxisRange:
    """Egy tengely mozgástartománya"""
    axis: str
    axis_name: str  # pl. "J1 (bázis)"
    positive_limit: Optional[float] = None  # Pozitív végállás pozíció (fok)
    negative_limit: Optional[float] = None  # Negatív végállás pozíció (fok)
    total_range: Optional[float] = None     # Teljes tartomány (fok)
    positive_endstop_hit: bool = False
    negative_endstop_hit: bool = False
    positive_max_reached: bool = False      # Maximum keresés-határ elérve
    negative_max_reached: bool = False
    error: Optional[str] = None
    steps_positive: int = 0                 # Lépések száma pozitív irányba
    steps_negative: int = 0


@dataclass
class EndstopTestReport:
    """Végállás teszt riport"""
    timestamp: str = ""
    port: str = ""
    step_size: float = 5.0          # Lépésméret (fok)
    speed: int = 15                  # Sebesség (F paraméter)
    max_search_angle: float = 200.0  # Maximum keresési szög
    axes: List[AxisRange] = field(default_factory=list)
    completed: bool = False
    error: Optional[str] = None
    duration_seconds: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# Endstop Test motor
# ============================================================

class EndstopTest:
    """
    Végállás teszt - végigmozgatja a robotkar tengelyeit
    a végállásokig mindkét irányban.
    
    Támogatja az axis_mapping konfigurációt, hogy a firmware tengelyeket
    helyesen azonosítsa a logikai tengelyekkel (J1/J2/J3).
    """

    MOVE_PATTERN = re.compile(
        r"INFO:\s*LINEAR\s*MOVE:\s*X(-?\d+\.?\d*)\s*Y(-?\d+\.?\d*)\s*Z(-?\d+\.?\d*)"
    )
    ENDSTOP_PATTERN = re.compile(
        r"INFO:\s*ENDSTOP:\s*\[X:(\d+)\s*Y:(\d+)\s*Z:(\d+)\]"
    )
    ERROR_PATTERN = re.compile(r"ERROR|COMMAND NOT RECOGNIZED", re.IGNORECASE)

    # Alapértelmezett nevek (identitás mapping esetén: firmware X = logikai X = J1)
    DEFAULT_AXIS_NAMES = {
        "X": "J1 (bázis)",
        "Y": "J2 (váll)",
        "Z": "J3 (könyök)",
    }
    
    # Logikai tengely -> ízület név
    LOGICAL_JOINT_NAMES = {
        "X": "J1 (bázis)",
        "Y": "J2 (váll)",
        "Z": "J3 (könyök)",
    }

    AXIS_ENDSTOP_INDEX = {"X": 0, "Y": 1, "Z": 2}

    def __init__(
        self,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 3.0,
        step_size: float = 5.0,
        speed: int = 15,
        max_search_angle: float = 200.0,
        stop_event: Optional[threading.Event] = None,
        axis_mapping: Optional[Dict[str, str]] = None,
    ):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.step_size = step_size
        self.speed = speed
        self.max_search_angle = max_search_angle
        self._serial: Optional[serial.Serial] = None
        self._stop_event = stop_event or threading.Event()
        self._log_entries: List[dict] = []
        self._start_time: float = 0.0
        
        # Axis mapping: logikai -> firmware (pl. {'X': 'Y', 'Y': 'X', 'Z': 'Z'})
        # Reverse: firmware -> logikai
        self._axis_mapping = axis_mapping or {'X': 'X', 'Y': 'Y', 'Z': 'Z'}
        self._axis_map_reverse = {v: k for k, v in self._axis_mapping.items()}
        
        # Firmware tengely nevek kiszámítása a mapping alapján
        # Ha axis_mapping: {'X': 'Y', 'Y': 'X'}, akkor:
        #   firmware X -> logikai Y -> "J2 (váll)"
        #   firmware Y -> logikai X -> "J1 (bázis)"
        self.AXIS_NAMES = {}
        for fw_axis in ["X", "Y", "Z"]:
            logical_axis = self._axis_map_reverse.get(fw_axis, fw_axis)
            self.AXIS_NAMES[fw_axis] = self.LOGICAL_JOINT_NAMES.get(
                logical_axis, f"{fw_axis} tengely"
            )

    # ----------------------------------------------------------
    # Progress napló
    # ----------------------------------------------------------

    def _log(self, entry_type: str, msg: str, **kwargs):
        """Progress napló bejegyzés hozzáadása (a frontend valós időben olvassa)"""
        entry = {
            "t": round(time.perf_counter() - self._start_time, 2),
            "type": entry_type,
            "msg": msg,
        }
        entry.update(kwargs)
        self._log_entries.append(entry)

    # ----------------------------------------------------------
    # Soros kommunikáció
    # ----------------------------------------------------------

    def _send(self, command: str, wait: float = 2.0) -> str:
        """Parancs küldése és válasz olvasása"""
        if not self._serial or not self._serial.is_open:
            return ""
        # Ha leállítás kérve, ne küldjünk már parancsot
        if self._stop_event.is_set():
            return ""

        self._serial.reset_input_buffer()
        cmd = command.strip() + "\r\n"
        self._serial.write(cmd.encode())
        self._serial.flush()

        response = self._read_response(wait)
        self._log("cmd", command.strip(),
                  gcode=command.strip(),
                  response=(response or "")[:200])
        return response

    def _read_response(self, timeout: float = 2.0) -> str:
        """Válasz olvasása (stop_event-et is figyeli)"""
        if not self._serial:
            return ""

        lines = []
        deadline = time.perf_counter() + timeout

        while time.perf_counter() < deadline:
            # Leállítás ellenőrzése a várakozási ciklusban
            if self._stop_event.is_set():
                break
            if self._serial.in_waiting > 0:
                try:
                    line_bytes = self._serial.readline()
                    line = line_bytes.decode(errors='replace').strip()
                    if line:
                        lines.append(line)
                        if re.match(r"^(INFO|ERROR):", line, re.IGNORECASE):
                            break
                except Exception:
                    break
            else:
                time.sleep(0.02)

        return "\n".join(lines)

    def _check_endstops(self) -> Dict[str, bool]:
        """Végállások lekérdezése, visszaadja melyik aktív"""
        resp = self._send("M119", wait=1.5)
        match = self.ENDSTOP_PATTERN.search(resp)
        if match:
            return {
                "X": match.group(1) == "1",
                "Y": match.group(2) == "1",
                "Z": match.group(3) == "1",
            }
        return {"X": False, "Y": False, "Z": False}

    def _move_relative(self, axis: str, angle: float) -> str:
        """Relatív mozgás egy tengelyen (a firmware minden tengelyt vár)"""
        axes = {"X": 0.0, "Y": 0.0, "Z": 0.0}
        axes[axis] = angle
        cmd = f"G1 X{axes['X']:.2f} Y{axes['Y']:.2f} Z{axes['Z']:.2f} F{self.speed}"
        return self._send(cmd, wait=5.0)

    def _move_absolute(self, x: float, y: float, z: float) -> str:
        """Abszolút mozgás"""
        cmd = f"G1 X{x:.2f} Y{y:.2f} Z{z:.2f} F{self.speed}"
        return self._send(cmd, wait=8.0)

    # ----------------------------------------------------------
    # Teszt futtatás
    # ----------------------------------------------------------

    def run_test(self, axes: Optional[List[str]] = None) -> EndstopTestReport:
        """
        Végállás teszt futtatása.
        
        axes: Opcionális tengelylista (pl. ["X", "Y"]). None = mind.
        """
        start_time = time.perf_counter()
        self._start_time = start_time
        self._log_entries.clear()
        self._log("info", "Végállás teszt indítása...")

        report = EndstopTestReport(
            timestamp=datetime.now().isoformat(),
            port=self.port,
            step_size=self.step_size,
            speed=self.speed,
            max_search_angle=self.max_search_angle,
        )

        test_axes = axes or ["X", "Y", "Z"]

        print(f"\n{'='*60}")
        print("  VÉGÁLLÁS TESZT - MOZGÁSTARTOMÁNY MÉRÉS")
        print(f"{'='*60}")
        print(f"  Port:        {self.port}")
        print(f"  Lépésméret:  {self.step_size}°")
        print(f"  Sebesség:    F{self.speed}")
        print(f"  Max szög:    {self.max_search_angle}°")
        print(f"  Tengelyek:   {', '.join(test_axes)}")
        print(f"{'-'*60}")

        # 1. Pozíció nullázás
        self._log("info", "Pozíció nullázása...")
        print("\n  [1] Pozíció nullázása (G92 X0 Y0 Z0)...")
        resp = self._send("G92 X0 Y0 Z0", wait=1.0)
        if self.ERROR_PATTERN.search(resp):
            self._log("error", f"Kalibráció hiba: {resp}")
            report.error = f"Kalibráció hiba: {resp}"
            return report
        print("      OK")

        # 2. Relatív mód
        self._log("info", "Relatív mód bekapcsolása")
        self._send("G91", wait=0.5)
        print("  [2] Relatív mód (G91) bekapcsolva")

        # 3. Tengelyek tesztelése
        cancelled = False
        for i, axis in enumerate(test_axes):
            if self._stop_event.is_set():
                self._log("warn", "Teszt leállítva!")
                print("\n  ⛔ Teszt leállítva!")
                report.error = "Felhasználó leállította"
                cancelled = True
                break
            pct = (i / len(test_axes)) * 100
            self._log("info", f"{axis} tengely ({self.AXIS_NAMES.get(axis, axis)}) tesztelése...",
                       axis=axis, pct=round(pct))
            axis_range = self._test_axis(axis)
            report.axes.append(axis_range)

        # 4. Visszatérés home-ba (abszolút módban)
        self._log("info", "Visszatérés home pozícióba...", pct=95)
        print(f"\n  [*] Visszatérés home pozícióba...")
        self._send("G90", wait=0.5)  # Abszolút mód
        resp = self._move_absolute(0, 0, 0)
        print("      OK")

        report.completed = not cancelled
        report.duration_seconds = time.perf_counter() - start_time
        self._log("info",
                  f"Teszt {'befejezve' if not cancelled else 'leállítva'} ({report.duration_seconds:.1f} mp)",
                  pct=100)

        # Összesítés
        print(f"\n{'='*60}")
        print("  EREDMÉNYEK")
        print(f"{'='*60}")
        for ax in report.axes:
            pos = f"+{ax.positive_limit:.1f}°" if ax.positive_limit is not None else "N/A"
            neg = f"{ax.negative_limit:.1f}°" if ax.negative_limit is not None else "N/A"
            total = f"{ax.total_range:.1f}°" if ax.total_range is not None else "N/A"
            pos_es = " (endstop)" if ax.positive_endstop_hit else " (max limit)" if ax.positive_max_reached else ""
            neg_es = " (endstop)" if ax.negative_endstop_hit else " (max limit)" if ax.negative_max_reached else ""
            print(f"  {ax.axis} ({ax.axis_name}):")
            print(f"    Pozitív: {pos}{pos_es}")
            print(f"    Negatív: {neg}{neg_es}")
            print(f"    Teljes:  {total}")
            if ax.error:
                print(f"    HIBA:    {ax.error}")
        print(f"\n  Időtartam: {report.duration_seconds:.1f} mp")
        print(f"{'='*60}")

        return report

    def _test_axis(self, axis: str) -> AxisRange:
        """Egy tengely végállás tesztje mindkét irányban"""
        axis_name = self.AXIS_NAMES.get(axis, axis)
        result = AxisRange(axis=axis, axis_name=axis_name)

        print(f"\n  [{axis}] {axis_name} tesztelése...")

        # Pozitív irány
        self._log("info", f"{axis} pozitív irány keresése ({self.step_size}° lépésekkel)...", axis=axis)
        print(f"      Pozitív irány keresése ({self.step_size}° lépésekkel)...")
        current_pos = 0.0
        steps = 0

        while current_pos < self.max_search_angle:
            # Leállítás ellenőrzése
            if self._stop_event.is_set():
                result.error = "Leállítva"
                result.positive_limit = current_pos
                result.steps_positive = steps
                print(f"      ⛔ Leállítva: +{current_pos:.1f}°")
                break

            # Mozgás
            resp = self._move_relative(axis, self.step_size)
            if self.ERROR_PATTERN.search(resp):
                result.error = f"Mozgás hiba: {resp}"
                break

            current_pos += self.step_size
            steps += 1

            # Végállás ellenőrzés
            endstops = self._check_endstops()
            if endstops.get(axis, False):
                result.positive_limit = current_pos
                result.positive_endstop_hit = True
                result.steps_positive = steps
                self._log("result", f"{axis} pozitív végállás: +{current_pos:.1f}° ({steps} lépés)",
                          axis=axis, value=current_pos)
                print(f"      ✅ Végállás: +{current_pos:.1f}° ({steps} lépés)")
                break

            # Progress jelzés
            if steps % 5 == 0:
                self._log("progress", f"{axis}+ keresés: {current_pos:.1f}°", axis=axis, value=current_pos)
                print(f"         ... {current_pos:.1f}°")

            time.sleep(0.1)
        else:
            result.positive_limit = current_pos
            result.positive_max_reached = True
            result.steps_positive = steps
            self._log("warn", f"{axis} max limit elérve: +{current_pos:.1f}° (nincs végállás)", axis=axis)
            print(f"      ⚠️  Maximum elérve: +{current_pos:.1f}° (nincs végállás)")

        # Visszamozgás 0-ra
        if self._stop_event.is_set():
            # Leállítva: gyors abszolút mozgás home-ba
            self._log("warn", f"{axis} leállítva - gyors visszamozgás home-ba", axis=axis)
            print(f"      Gyors visszamozgás (abszolút)...")
            self._send("G90", wait=0.5)
            self._move_absolute(0, 0, 0)
            self._send("G91", wait=0.5)
            return result
        else:
            print(f"      Visszamozgás 0-ra...")
            for _ in range(steps):
                if self._stop_event.is_set():
                    # Leállítva közben: gyors abszolút home
                    print(f"      ⛔ Gyors visszamozgás (abszolút)...")
                    self._send("G90", wait=0.5)
                    self._move_absolute(0, 0, 0)
                    self._send("G91", wait=0.5)
                    return result
                self._move_relative(axis, -self.step_size)
                time.sleep(0.05)

        # Rövid szünet
        time.sleep(0.5)

        # Negatív irány
        self._log("info", f"{axis} negatív irány keresése ({self.step_size}° lépésekkel)...", axis=axis)
        print(f"      Negatív irány keresése ({self.step_size}° lépésekkel)...")
        current_pos = 0.0
        steps = 0

        while abs(current_pos) < self.max_search_angle:
            # Leállítás ellenőrzése
            if self._stop_event.is_set():
                result.error = "Leállítva"
                result.negative_limit = current_pos
                result.steps_negative = steps
                print(f"      ⛔ Leállítva: {current_pos:.1f}°")
                break

            resp = self._move_relative(axis, -self.step_size)
            if self.ERROR_PATTERN.search(resp):
                result.error = f"Mozgás hiba: {resp}"
                break

            current_pos -= self.step_size
            steps += 1

            endstops = self._check_endstops()
            if endstops.get(axis, False):
                result.negative_limit = current_pos
                result.negative_endstop_hit = True
                result.steps_negative = steps
                self._log("result", f"{axis} negatív végállás: {current_pos:.1f}° ({steps} lépés)",
                          axis=axis, value=current_pos)
                print(f"      ✅ Végállás: {current_pos:.1f}° ({steps} lépés)")
                break

            if steps % 5 == 0:
                self._log("progress", f"{axis}- keresés: {current_pos:.1f}°", axis=axis, value=current_pos)
                print(f"         ... {current_pos:.1f}°")

            time.sleep(0.1)
        else:
            result.negative_limit = current_pos
            result.negative_max_reached = True
            result.steps_negative = steps
            self._log("warn", f"{axis} max limit elérve: {current_pos:.1f}° (nincs végállás)", axis=axis)
            print(f"      ⚠️  Maximum elérve: {current_pos:.1f}° (nincs végállás)")

        # Visszamozgás 0-ra
        if self._stop_event.is_set():
            print(f"      Gyors visszamozgás (abszolút)...")
            self._send("G90", wait=0.5)
            self._move_absolute(0, 0, 0)
            self._send("G91", wait=0.5)
        else:
            print(f"      Visszamozgás 0-ra...")
            for _ in range(steps):
                if self._stop_event.is_set():
                    print(f"      ⛔ Gyors visszamozgás (abszolút)...")
                    self._send("G90", wait=0.5)
                    self._move_absolute(0, 0, 0)
                    self._send("G91", wait=0.5)
                    break
                self._move_relative(axis, self.step_size)
                time.sleep(0.05)

        # Teljes tartomány számítás
        if result.positive_limit is not None and result.negative_limit is not None:
            result.total_range = result.positive_limit - result.negative_limit

        time.sleep(0.5)
        return result

    def run_with_serial(
        self,
        ser: serial.Serial,
        axes: Optional[List[str]] = None,
        stop_event: Optional[threading.Event] = None,
    ) -> EndstopTestReport:
        """
        Teszt futtatása meglévő serial kapcsolaton.
        A bridge server hívja.
        """
        self._serial = ser
        if stop_event is not None:
            self._stop_event = stop_event
        report = self.run_test(axes)
        self._serial = None
        return report


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Endstop Range Finder - Végállás teszt és mozgástartomány mérés",
    )
    parser.add_argument("--port", default="/dev/ttyUSB0", help="Soros port")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate")
    parser.add_argument("--step", type=float, default=5.0, help="Lépésméret (fok)")
    parser.add_argument("--speed", type=int, default=15, help="Sebesség (F paraméter)")
    parser.add_argument("--max-angle", type=float, default=200.0, help="Max keresési szög")
    parser.add_argument("--axes", nargs="+", choices=["X", "Y", "Z"], help="Tesztelendő tengelyek")
    parser.add_argument("--json", metavar="FILE", help="JSON riport mentés")

    args = parser.parse_args()

    if not SERIAL_AVAILABLE:
        print("HIBA: pyserial szükséges: pip install pyserial")
        sys.exit(1)

    try:
        ser = serial.Serial(
            port=args.port,
            baudrate=args.baud,
            timeout=3.0,
            write_timeout=3.0,
        )
    except serial.SerialException as e:
        print(f"HIBA: Nem sikerült megnyitni: {e}")
        sys.exit(1)

    print("Várakozás Arduino inicializálásra (3 mp)...")
    time.sleep(3.0)
    if ser.in_waiting:
        ser.read(ser.in_waiting)

    test = EndstopTest(
        port=args.port,
        baudrate=args.baud,
        step_size=args.step,
        speed=args.speed,
        max_search_angle=args.max_angle,
    )
    test._serial = ser

    try:
        report = test.run_test(axes=args.axes)
    finally:
        ser.close()

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report.to_dict(), f, indent=2, ensure_ascii=False)
        print(f"\nJSON riport mentve: {args.json}")

    sys.exit(0 if report.completed else 1)


if __name__ == "__main__":
    main()
