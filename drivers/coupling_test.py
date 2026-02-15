#!/usr/bin/env python3
"""
Firmware Coupling & Calibration Test
=====================================

Két dolgot vizsgál:

1) CROSS-AXIS COUPLING (csatolás):
   Egyetlen firmware tengelyt mozgat, és figyeli, hogy a firmware válaszában
   a TÖBBI tengely értéke is változik-e.  Ha igen → a firmware beépített
   kinematikai csatolást alkalmaz.

2) KALIBRÁCIÓ (firmware egység → fizikai fok):
   Különböző firmware értékekre mozgat, és a felhasználó megadhatja a
   ténylegesen mért fizikai szöget.  Ebből kiszámolja az axis_scale
   arányt (firmware egység / fizikai fok).

Használat:
  Önálló:     python3 coupling_test.py [--port /dev/ttyUSB0]
  Importálva: from coupling_test import CouplingTest

A bridge servert le kell állítani, mert közvetlenül használja a soros portot.
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
class SingleAxisMove:
    """Egyetlen tengelymozgás eredménye."""
    axis: str                   # Mozgatott tengely (X/Y/Z)
    commanded: Dict[str, float] # Parancsolt értékek {'X': .., 'Y': .., 'Z': ..}
    reported: Dict[str, float]  # Firmware válasz értékei {'X': .., 'Y': .., 'Z': ..}
    deviations: Dict[str, float]  # Eltérés a nem-mozgatott tengelyeken
    has_coupling: bool          # Van-e cross-axis eltérés?
    response_ok: bool
    response: str = ""
    duration_ms: float = 0.0


@dataclass
class CalibrationPoint:
    """Kalibrációs mérési pont."""
    axis: str
    firmware_value: float       # Parancsolt firmware érték
    reported_value: float       # Firmware által visszajelzett érték
    physical_degrees: Optional[float] = None  # Felhasználó által mért fizikai szög
    scale: Optional[float] = None  # physical / firmware arány


@dataclass
class CouplingTestReport:
    """Teljes teszt riport."""
    timestamp: str = ""
    port: str = ""
    # Coupling teszt
    coupling_moves: List[SingleAxisMove] = field(default_factory=list)
    coupling_detected: Dict[str, bool] = field(default_factory=dict)
    coupling_summary: str = ""
    # Kalibráció
    calibration_points: List[CalibrationPoint] = field(default_factory=list)
    calculated_scales: Dict[str, float] = field(default_factory=dict)
    # Meta
    completed: bool = False
    error: Optional[str] = None
    duration_seconds: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# Coupling Test motor
# ============================================================

DEVIATION_THRESHOLD = 0.5  # Firmware egység – ez felett "csatolásnak" számít

class CouplingTest:
    """
    Firmware coupling és kalibrációs teszt.
    Közvetlenül firmware szinten dolgozik (nincs axis mapping).
    """

    MOVE_PATTERN = re.compile(
        r"INFO:\s*LINEAR\s*MOVE:\s*X(-?\d+\.?\d*)\s*Y(-?\d+\.?\d*)\s*Z(-?\d+\.?\d*)"
    )
    ERROR_PATTERN = re.compile(r"ERROR|COMMAND NOT RECOGNIZED", re.IGNORECASE)

    # Firmware értékek amiket tesztelünk (nem fizikai fok!)
    DEFAULT_TEST_VALUES = [30, 60, 100, 150]

    def __init__(
        self,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 3.0,
        test_values: Optional[List[float]] = None,
        stop_event: Optional[threading.Event] = None,
    ):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.test_values = test_values or self.DEFAULT_TEST_VALUES
        self._serial: Optional[serial.Serial] = None
        self._stop_event = stop_event or threading.Event()
        self._log_entries: List[dict] = []
        self._start_time: float = 0.0

    # ----------------------------------------------------------
    # Progress napló
    # ----------------------------------------------------------

    def _log(self, entry_type: str, msg: str, **kwargs):
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

    def _send_timed(self, command: str, wait: float = 8.0) -> Tuple[str, float]:
        """Parancs küldése, válasz + idő mérése."""
        if not self._serial or not self._serial.is_open:
            return "", 0.0
        if self._stop_event.is_set():
            return "", 0.0

        self._serial.reset_input_buffer()
        cmd = command.strip() + "\r\n"

        start = time.perf_counter()
        self._serial.write(cmd.encode())
        self._serial.flush()

        response = self._read_response(wait)
        elapsed_ms = (time.perf_counter() - start) * 1000.0

        self._log("cmd", command.strip(),
                  gcode=command.strip(),
                  response=(response or "")[:200],
                  ms=round(elapsed_ms, 1))
        return response, elapsed_ms

    def _send(self, command: str, wait: float = 2.0) -> str:
        resp, _ = self._send_timed(command, wait)
        return resp

    def _read_response(self, timeout: float = 8.0) -> str:
        if not self._serial:
            return ""

        lines = []
        deadline = time.perf_counter() + timeout

        while time.perf_counter() < deadline:
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

    def _parse_move(self, response: str) -> Optional[Dict[str, float]]:
        """Firmware válaszból X,Y,Z értékek kinyerése."""
        match = self.MOVE_PATTERN.search(response)
        if match:
            return {
                'X': float(match.group(1)),
                'Y': float(match.group(2)),
                'Z': float(match.group(3)),
            }
        return None

    # ----------------------------------------------------------
    # 1) COUPLING TESZT
    # ----------------------------------------------------------

    def _test_single_axis(self, axis: str, value: float) -> SingleAxisMove:
        """
        Egyetlen tengelyt mozgat a megadott firmware értékre,
        a többi tengely 0-n marad.  Ellenőrzi a firmware válaszát.
        """
        commanded = {'X': 0.0, 'Y': 0.0, 'Z': 0.0}
        commanded[axis] = value

        cmd = f"G1 X{commanded['X']:.2f} Y{commanded['Y']:.2f} Z{commanded['Z']:.2f} F30"
        resp, ms = self._send_timed(cmd, wait=15.0)

        reported = self._parse_move(resp)
        if reported is None:
            return SingleAxisMove(
                axis=axis,
                commanded=commanded,
                reported={'X': 0, 'Y': 0, 'Z': 0},
                deviations={},
                has_coupling=False,
                response_ok=False,
                response=resp[:200],
                duration_ms=ms,
            )

        # Eltérés számítás a NEM mozgatott tengelyeken
        other_axes = [a for a in ['X', 'Y', 'Z'] if a != axis]
        deviations = {}
        has_coupling = False
        for other in other_axes:
            dev = abs(reported[other] - commanded[other])
            deviations[other] = round(dev, 3)
            if dev > DEVIATION_THRESHOLD:
                has_coupling = True

        # Mozgatott tengely eltérés (informatív – nem coupling, de érdekes)
        deviations[f"{axis}_self"] = round(
            abs(reported[axis] - commanded[axis]), 3
        )

        return SingleAxisMove(
            axis=axis,
            commanded=commanded,
            reported=reported,
            deviations=deviations,
            has_coupling=has_coupling,
            response_ok=True,
            response=resp[:200],
            duration_ms=ms,
        )

    def _return_home(self) -> bool:
        """Visszatérés nullára."""
        resp, _ = self._send_timed("G1 X0 Y0 Z0 F30", wait=15.0)
        ok = bool(self.MOVE_PATTERN.search(resp))
        time.sleep(0.3)
        return ok

    def run_coupling_test(self, report: CouplingTestReport) -> None:
        """Coupling teszt: minden tengely, minden teszt értékkel."""
        print(f"\n{'─'*60}")
        print("  1. RÉSZ: CROSS-AXIS COUPLING TESZT")
        print(f"{'─'*60}")
        print(f"  Teszt értékek (firmware egység): {self.test_values}")
        print(f"  Küszöb: >{DEVIATION_THRESHOLD} fw egység = csatolás")
        print()

        axes_with_coupling = {'X': False, 'Y': False, 'Z': False}

        for axis in ['X', 'Y', 'Z']:
            if self._stop_event.is_set():
                break

            print(f"  --- {axis} tengely ---")
            self._log("info", f"Coupling teszt: {axis} tengely")

            for value in self.test_values:
                if self._stop_event.is_set():
                    break

                # Nullázás minden teszt előtt
                self._return_home()

                result = self._test_single_axis(axis, value)
                report.coupling_moves.append(result)

                if not result.response_ok:
                    print(f"    {axis}={value:6.1f}  ❌ Nincs valid válasz")
                    continue

                # Eredmény kiírás
                coupling_flag = "⚠️  CSATOLÁS!" if result.has_coupling else "✅ Tiszta"
                dev_parts = []
                for other in ['X', 'Y', 'Z']:
                    if other == axis:
                        continue
                    dev = result.deviations.get(other, 0)
                    if dev > DEVIATION_THRESHOLD:
                        dev_parts.append(f"{other}={result.reported[other]:+.2f} (Δ{dev:.2f})")
                    else:
                        dev_parts.append(f"{other}={result.reported[other]:.2f}")

                dev_str = ", ".join(dev_parts)
                print(
                    f"    {axis}={value:6.1f} → válasz: "
                    f"{axis}={result.reported[axis]:.2f}  "
                    f"többi: [{dev_str}]  {coupling_flag}"
                )

                if result.has_coupling:
                    axes_with_coupling[axis] = True

                time.sleep(0.3)

        # Visszatérés home-ra
        self._return_home()

        # Összesítés
        report.coupling_detected = axes_with_coupling
        any_coupling = any(axes_with_coupling.values())

        print(f"\n  {'='*50}")
        if any_coupling:
            coupled = [a for a, c in axes_with_coupling.items() if c]
            report.coupling_summary = (
                f"CSATOLÁS ÉSZLELVE a következő tengelye(ke)n: {', '.join(coupled)}. "
                f"A firmware beépített kinematikai csatolást alkalmaz!"
            )
            print(f"  ⚠️  {report.coupling_summary}")
        else:
            report.coupling_summary = (
                "Nincs cross-axis csatolás a firmware-ben. "
                "A tengelyek függetlenül mozognak firmware szinten."
            )
            print(f"  ✅ {report.coupling_summary}")
        print(f"  {'='*50}")

    # ----------------------------------------------------------
    # 2) KALIBRÁCIÓS TESZT
    # ----------------------------------------------------------

    def run_calibration_test(
        self,
        report: CouplingTestReport,
        interactive: bool = True,
    ) -> None:
        """
        Kalibrációs teszt: firmware érték vs. fizikai szög mérése.

        Ha interactive=True, minden mozgás után megkérdezi a felhasználótól
        a ténylegesen mért fizikai szöget.
        Ha interactive=False, csak a firmware válaszokat rögzíti.
        """
        print(f"\n{'─'*60}")
        print("  2. RÉSZ: KALIBRÁCIÓ (firmware egység → fizikai fok)")
        print(f"{'─'*60}")

        if interactive:
            print("  Minden mozgás után kérem a ténylegesen mért fizikai szöget.")
            print("  Szögmérővel vagy szemmel becsülve mérje meg a tényleges elfordulást.")
            print("  Enter = kihagyás (nem mér)")
            print()

        # Pozíció nullázás
        self._send("G92 X0 Y0 Z0", wait=1.0)
        time.sleep(0.3)

        cal_values = [50, 100, 200]  # Firmware egységek kalibrációhoz

        for axis in ['X', 'Y', 'Z']:
            if self._stop_event.is_set():
                break

            axis_name = {'X': 'J1 (bázis)', 'Y': 'J2 (váll)', 'Z': 'J3 (könyök)'}
            print(f"\n  --- {axis} tengely – {axis_name.get(axis, axis)} ---")

            for fw_value in cal_values:
                if self._stop_event.is_set():
                    break

                # Nullázás
                self._return_home()
                time.sleep(0.5)

                # Mozgatás
                commanded = {'X': 0.0, 'Y': 0.0, 'Z': 0.0}
                commanded[axis] = float(fw_value)
                cmd = (
                    f"G1 X{commanded['X']:.2f} Y{commanded['Y']:.2f} "
                    f"Z{commanded['Z']:.2f} F30"
                )
                resp, ms = self._send_timed(cmd, wait=15.0)
                reported = self._parse_move(resp)

                reported_val = reported[axis] if reported else 0.0

                point = CalibrationPoint(
                    axis=axis,
                    firmware_value=fw_value,
                    reported_value=reported_val,
                )

                if interactive and reported:
                    print(
                        f"    Parancs: {axis}={fw_value}  →  "
                        f"Firmware válasz: {axis}={reported_val:.2f}"
                    )
                    try:
                        user_input = input(
                            f"    Mért fizikai szög (fok)? [Enter=kihagyás]: "
                        ).strip()
                        if user_input:
                            phys = float(user_input)
                            point.physical_degrees = phys
                            if abs(reported_val) > 0.01:
                                point.scale = round(phys / reported_val, 5)
                                print(
                                    f"    → Arány: {phys}° / {reported_val} fw = "
                                    f"{point.scale:.4f} fok/fw_egység"
                                )
                    except (ValueError, EOFError):
                        pass
                elif reported:
                    print(
                        f"    {axis}={fw_value} → válasz: {axis}={reported_val:.2f} "
                        f"({ms:.0f}ms)"
                    )

                report.calibration_points.append(point)
                time.sleep(0.3)

        # Visszatérés home-ra
        self._return_home()

        # Skálák kiszámítása
        for axis in ['X', 'Y', 'Z']:
            points = [
                p for p in report.calibration_points
                if p.axis == axis and p.scale is not None
            ]
            if points:
                avg_scale = sum(p.scale for p in points) / len(points)
                report.calculated_scales[axis] = round(avg_scale, 5)

        if report.calculated_scales:
            print(f"\n  {'='*50}")
            print("  KALIBRÁCIÓS EREDMÉNYEK")
            print(f"  {'='*50}")
            for axis, scale in report.calculated_scales.items():
                print(f"  {axis} tengely: 1 firmware egység = {scale:.4f} fizikai fok")
            print()
            print("  Javasolt devices.yaml konfiguráció:")
            print("  axis_scale:")
            for axis, scale in report.calculated_scales.items():
                print(f"    {axis}: {scale}   # 1 fw egység = {scale} fok")
            print(f"  {'='*50}")

    # ----------------------------------------------------------
    # Teljes teszt futtatás
    # ----------------------------------------------------------

    def run_test(
        self,
        coupling: bool = True,
        calibration: bool = True,
        interactive: bool = True,
    ) -> CouplingTestReport:
        """Teljes teszt futtatása."""
        start_time = time.perf_counter()
        self._start_time = start_time
        self._log_entries.clear()

        report = CouplingTestReport(
            timestamp=datetime.now().isoformat(),
            port=self.port,
        )

        self._log("info", "Coupling & Calibration teszt indítása")

        print(f"\n{'='*60}")
        print("  FIRMWARE COUPLING & CALIBRATION TESZT")
        print(f"{'='*60}")
        print(f"  Port:          {self.port}")
        print(f"  Teszt értékek: {self.test_values}")
        print(f"  Coupling:      {'Igen' if coupling else 'Nem'}")
        print(f"  Kalibráció:    {'Igen (interaktív)' if calibration and interactive else 'Igen (auto)' if calibration else 'Nem'}")
        print(f"{'='*60}")

        # Pozíció nullázás
        print("\n  [0] Pozíció nullázás (G92 X0 Y0 Z0)...")
        self._send("G92 X0 Y0 Z0", wait=1.0)
        time.sleep(0.3)
        print("      OK")

        # 1) Coupling teszt
        if coupling:
            self.run_coupling_test(report)

        # 2) Kalibrációs teszt
        if calibration:
            self.run_calibration_test(report, interactive=interactive)

        # Lezárás
        report.completed = True
        report.duration_seconds = time.perf_counter() - start_time

        print(f"\n{'='*60}")
        print(f"  TESZT BEFEJEZVE ({report.duration_seconds:.1f} mp)")
        if report.coupling_summary:
            print(f"  Coupling: {report.coupling_summary}")
        if report.calculated_scales:
            scales_str = ", ".join(
                f"{a}={s:.4f}" for a, s in report.calculated_scales.items()
            )
            print(f"  Skálák: {scales_str}")
        print(f"{'='*60}")

        self._log("info",
                  f"Teszt befejezve ({report.duration_seconds:.1f} mp)",
                  pct=100)

        return report

    def run_with_serial(
        self,
        ser: serial.Serial,
        coupling: bool = True,
        calibration: bool = True,
        interactive: bool = False,
        stop_event: Optional[threading.Event] = None,
    ) -> CouplingTestReport:
        """
        Teszt futtatása meglévő serial kapcsolaton.
        A bridge server hívja.
        """
        self._serial = ser
        if stop_event is not None:
            self._stop_event = stop_event
        report = self.run_test(
            coupling=coupling,
            calibration=calibration,
            interactive=interactive,
        )
        self._serial = None
        return report


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Firmware Coupling & Calibration Test",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Példák:
  python3 coupling_test.py                           # Teljes teszt (interaktív)
  python3 coupling_test.py --coupling-only           # Csak coupling teszt
  python3 coupling_test.py --calibration-only        # Csak kalibráció
  python3 coupling_test.py --no-interactive          # Nincs felhasználói input
  python3 coupling_test.py --values 30 60 100 200    # Egyedi teszt értékek
  python3 coupling_test.py --json report.json        # JSON riport mentés
        """,
    )
    parser.add_argument("--port", default="/dev/ttyUSB0", help="Soros port")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate")
    parser.add_argument("--values", nargs="+", type=float, default=None,
                        help="Teszt firmware értékek (pl. 30 60 100 200)")
    parser.add_argument("--coupling-only", action="store_true",
                        help="Csak coupling teszt (kalibráció nélkül)")
    parser.add_argument("--calibration-only", action="store_true",
                        help="Csak kalibrációs teszt (coupling nélkül)")
    parser.add_argument("--no-interactive", action="store_true",
                        help="Nem kér fizikai szög inputot (csak firmware értékek)")
    parser.add_argument("--json", metavar="FILE", help="JSON riport mentés")

    args = parser.parse_args()

    if not SERIAL_AVAILABLE:
        print("HIBA: pyserial szükséges: pip install pyserial")
        sys.exit(1)

    do_coupling = not args.calibration_only
    do_calibration = not args.coupling_only
    interactive = not args.no_interactive

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

    test = CouplingTest(
        port=args.port,
        baudrate=args.baud,
        test_values=args.values,
    )
    test._serial = ser

    try:
        report = test.run_test(
            coupling=do_coupling,
            calibration=do_calibration,
            interactive=interactive,
        )
    finally:
        ser.close()

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report.to_dict(), f, indent=2, ensure_ascii=False)
        print(f"\nJSON riport mentve: {args.json}")

    sys.exit(0 if report.completed else 1)


if __name__ == "__main__":
    main()
