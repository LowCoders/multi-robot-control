#!/usr/bin/env python3
"""
Motion Quality Test - Mozgásminőség és sebesség teszt
=====================================================

Különböző sebességekkel teszteli a robotkar mozgásminőségét:
  - F10, F20, F30, F50, F70, F100 értékekkel mozgat
  - Méri a válaszidőt és a mozgás időigényét
  - Megállapítja az optimális sebesség-tartományt
  - Oda-vissza mozgásokat végez az egyes tengelyeken

Használat:
  Önálló:     python3 motion_test.py [--port /dev/ttyUSB0]
  Importálva: from motion_test import MotionTest
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
class SpeedTestResult:
    """Egy sebesség-teszt eredménye"""
    speed: int              # F paraméter
    axis: str               # Tesztelt tengely
    angle: float            # Mozgás szöge (fok)
    move_time_ms: float     # Mozgás ideje (ms) - a parancs kiadásától a válaszig
    return_time_ms: float   # Visszamozgás ideje (ms)
    avg_time_ms: float      # Átlagos idő
    response_ok: bool       # Volt-e valid válasz
    response: str = ""      # Nyers válasz


@dataclass
class MotionTestReport:
    """Mozgásteszt riport"""
    timestamp: str = ""
    port: str = ""
    test_angle: float = 30.0       # Teszt szög (fok)
    speeds_tested: List[int] = field(default_factory=list)
    results: List[SpeedTestResult] = field(default_factory=list)
    recommended_speed: Optional[int] = None
    speed_summary: Dict[int, Dict[str, Any]] = field(default_factory=dict)
    completed: bool = False
    error: Optional[str] = None
    duration_seconds: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# Motion Test motor
# ============================================================

class MotionTest:
    """
    Mozgásminőség teszt - különböző sebességekkel teszteli a mozgást.
    """

    MOVE_PATTERN = re.compile(
        r"INFO:\s*LINEAR\s*MOVE:\s*X(-?\d+\.?\d*)\s*Y(-?\d+\.?\d*)\s*Z(-?\d+\.?\d*)"
    )
    ERROR_PATTERN = re.compile(r"ERROR|COMMAND NOT RECOGNIZED", re.IGNORECASE)
    STATUS_PATTERN = re.compile(r"<([^,>]+)")

    # Tesztelt sebességek
    DEFAULT_SPEEDS = [5, 10, 20, 30, 50, 70, 100]

    def __init__(
        self,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 3.0,
        test_angle: float = 30.0,
        speeds: Optional[List[int]] = None,
        stop_event: Optional[threading.Event] = None,
    ):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.test_angle = test_angle
        self.speeds = speeds or self.DEFAULT_SPEEDS
        self._serial: Optional[serial.Serial] = None
        self._stop_event = stop_event or threading.Event()
        self._log_entries: List[dict] = []
        self._start_time: float = 0.0

    # ----------------------------------------------------------
    # Progress napló
    # ----------------------------------------------------------

    def _log(self, entry_type: str, msg: str, **kwargs):
        """Progress napló bejegyzés hozzáadása"""
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
        """Parancs küldése, válasz + idő mérése"""
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
        """Parancs küldése"""
        resp, _ = self._send_timed(command, wait)
        return resp

    def _read_response(self, timeout: float = 8.0) -> str:
        """Válasz olvasása (stop_event-et is figyeli)"""
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
                        # Legacy firmware: INFO/ERROR
                        # GRBL: ok / error:n / <Idle,...> státusz
                        if re.match(r"^(INFO|ERROR):", line, re.IGNORECASE):
                            break
                        if re.match(r"^ok$", line, re.IGNORECASE):
                            break
                        if re.match(r"^error", line, re.IGNORECASE):
                            break
                        if line.startswith("<") and line.endswith(">"):
                            break
                except Exception:
                    break
            else:
                time.sleep(0.02)

        return "\n".join(lines)

    def _wait_grbl_idle(self, timeout: float = 15.0, poll_interval: float = 0.1) -> Tuple[bool, float]:
        """GRBL státusz pollinggal megvárja az Idle állapotot."""
        start = time.perf_counter()
        deadline = start + timeout

        while time.perf_counter() < deadline:
            if self._stop_event.is_set():
                break

            status, _ = self._send_timed("?", wait=0.6)
            state_match = self.STATUS_PATTERN.search(status)
            if state_match:
                state = state_match.group(1).strip().lower()
                if state.startswith("idle"):
                    return True, (time.perf_counter() - start) * 1000.0
                if state.startswith("alarm") or state.startswith("door"):
                    return False, (time.perf_counter() - start) * 1000.0

            time.sleep(poll_interval)

        return False, (time.perf_counter() - start) * 1000.0

    # ----------------------------------------------------------
    # Teszt futtatás
    # ----------------------------------------------------------

    def run_test(self, axes: Optional[List[str]] = None) -> MotionTestReport:
        """
        Mozgásteszt futtatása különböző sebességekkel.

        axes: Tesztelendő tengelyek (None = mind)
        """
        start_time = time.perf_counter()
        self._start_time = start_time
        self._log_entries.clear()

        report = MotionTestReport(
            timestamp=datetime.now().isoformat(),
            port=self.port,
            test_angle=self.test_angle,
            speeds_tested=list(self.speeds),
        )

        test_axes = axes or ["X", "Y", "Z"]

        self._log("info", f"Mozgásminőség teszt indítása (szög: {self.test_angle}°, sebességek: {len(self.speeds)})")

        print(f"\n{'='*60}")
        print("  MOZGÁSMINŐSÉG TESZT")
        print(f"{'='*60}")
        print(f"  Port:        {self.port}")
        print(f"  Teszt szög:  {self.test_angle}°")
        print(f"  Sebességek:  {', '.join(f'F{s}' for s in self.speeds)}")
        print(f"  Tengelyek:   {', '.join(test_axes)}")
        print(f"{'-'*60}")

        # Pozíció nullázás
        self._log("info", "Pozíció nullázása...")
        print("\n  [0] Pozíció nullázása...")
        self._send("G92 X0 Y0 Z0", wait=1.0)
        print("      OK")

        # Teszt végigfuttatása
        cancelled = False
        total_steps = len(self.speeds) * len(test_axes)
        step_count = 0
        for speed in self.speeds:
            if self._stop_event.is_set():
                self._log("warn", "Teszt leállítva!")
                print("\n  ⛔ Teszt leállítva!")
                cancelled = True
                break

            self._log("info", f"Sebesség teszt: F{speed}", pct=round((step_count / total_steps) * 100))
            print(f"\n  --- F{speed} ---")

            for axis in test_axes:
                if self._stop_event.is_set():
                    cancelled = True
                    break

                self._log("info", f"F{speed} - {axis} tengely tesztelése...", axis=axis)
                result = self._test_speed_axis(axis, speed)
                report.results.append(result)
                step_count += 1

                status_icon = "✅" if result.response_ok else "❌"
                result_msg = (
                    f"F{speed} {axis}: oda={result.move_time_ms:.0f}ms, "
                    f"vissza={result.return_time_ms:.0f}ms, átlag={result.avg_time_ms:.0f}ms"
                )
                self._log("result", result_msg, axis=axis,
                          ok=result.response_ok, ms=round(result.avg_time_ms, 1))
                print(
                    f"  {status_icon} {axis} F{speed}: "
                    f"oda={result.move_time_ms:.0f}ms, "
                    f"vissza={result.return_time_ms:.0f}ms, "
                    f"átlag={result.avg_time_ms:.0f}ms"
                )

                # Szünet a mozgások között
                time.sleep(0.3)

        # Összesítés sebességenként
        for speed in self.speeds:
            speed_results = [r for r in report.results if r.speed == speed and r.response_ok]
            if speed_results:
                avg = sum(r.avg_time_ms for r in speed_results) / len(speed_results)
                report.speed_summary[speed] = {
                    "avg_time_ms": round(avg, 1),
                    "min_time_ms": round(min(r.avg_time_ms for r in speed_results), 1),
                    "max_time_ms": round(max(r.avg_time_ms for r in speed_results), 1),
                    "all_ok": all(r.response_ok for r in speed_results),
                    "tests": len(speed_results),
                }

        # Ajánlott sebesség meghatározása
        # Keressük a legjobb sebesség/idő arányt ahol minden működik
        report.recommended_speed = self._find_recommended_speed(report)

        report.completed = not cancelled
        if cancelled:
            report.error = "Felhasználó leállította"
        report.duration_seconds = time.perf_counter() - start_time
        self._log("info",
                  f"Teszt {'befejezve' if not cancelled else 'leállítva'} ({report.duration_seconds:.1f} mp)",
                  pct=100)

        # Kiírás
        print(f"\n{'='*60}")
        print("  ÖSSZESÍTÉS")
        print(f"{'='*60}")
        for speed, summary in report.speed_summary.items():
            status = "✅" if summary["all_ok"] else "⚠️"
            rec = " ← AJÁNLOTT" if speed == report.recommended_speed else ""
            print(
                f"  {status} F{speed:3d}: átlag {summary['avg_time_ms']:7.1f}ms "
                f"(min: {summary['min_time_ms']:.1f}, max: {summary['max_time_ms']:.1f}){rec}"
            )

        if report.recommended_speed:
            print(f"\n  🎯 Ajánlott sebesség: F{report.recommended_speed}")
        print(f"  ⏱️  Időtartam: {report.duration_seconds:.1f} mp")
        print(f"{'='*60}")

        return report

    def _test_speed_axis(self, axis: str, speed: int) -> SpeedTestResult:
        """Egy tengely tesztelése adott sebességgel"""
        angle = self.test_angle

        # Abszolút mozgás az adott szögre
        axes = {"X": 0.0, "Y": 0.0, "Z": 0.0}
        axes[axis] = angle
        cmd = f"G1 X{axes['X']:.2f} Y{axes['Y']:.2f} Z{axes['Z']:.2f} F{speed}"

        # Oda
        resp_fwd, time_fwd = self._send_timed(cmd, wait=15.0)
        is_legacy_move = bool(self.MOVE_PATTERN.search(resp_fwd))
        is_grbl_ok = ("ok" in resp_fwd.lower()) and not bool(self.ERROR_PATTERN.search(resp_fwd))
        ok_fwd = is_legacy_move or is_grbl_ok

        # GRBL esetben az "ok" csak parancs-ack, mozgás végét Idle státusz jelzi
        if is_grbl_ok and not is_legacy_move:
            idle_ok, idle_ms = self._wait_grbl_idle(timeout=20.0)
            time_fwd += idle_ms
            ok_fwd = ok_fwd and idle_ok

        time.sleep(0.2)

        # Vissza
        cmd_back = f"G1 X0.00 Y0.00 Z0.00 F{speed}"
        resp_back, time_back = self._send_timed(cmd_back, wait=15.0)
        is_legacy_back = bool(self.MOVE_PATTERN.search(resp_back))
        is_grbl_back_ok = ("ok" in resp_back.lower()) and not bool(self.ERROR_PATTERN.search(resp_back))
        ok_back = is_legacy_back or is_grbl_back_ok

        if is_grbl_back_ok and not is_legacy_back:
            idle_ok, idle_ms = self._wait_grbl_idle(timeout=20.0)
            time_back += idle_ms
            ok_back = ok_back and idle_ok

        avg = (time_fwd + time_back) / 2.0

        return SpeedTestResult(
            speed=speed,
            axis=axis,
            angle=angle,
            move_time_ms=time_fwd,
            return_time_ms=time_back,
            avg_time_ms=avg,
            response_ok=ok_fwd and ok_back,
            response=resp_fwd[:200],
        )

    def _find_recommended_speed(self, report: MotionTestReport) -> Optional[int]:
        """
        Ajánlott sebesség meghatározása.
        Szempont: közepes sebesség, ahol minden teszt sikeres volt.
        """
        working_speeds = [
            speed for speed, summary in report.speed_summary.items()
            if summary["all_ok"]
        ]

        if not working_speeds:
            return None

        # A közepes sebesség ajánlott (a működők közül)
        working_speeds.sort()
        mid_idx = len(working_speeds) // 2
        return working_speeds[mid_idx]

    def run_with_serial(
        self,
        ser: serial.Serial,
        axes: Optional[List[str]] = None,
        stop_event: Optional[threading.Event] = None,
    ) -> MotionTestReport:
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
        description="Motion Quality Test - Mozgásminőség és sebesség teszt",
    )
    parser.add_argument("--port", default="/dev/ttyUSB0", help="Soros port")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate")
    parser.add_argument("--angle", type=float, default=30.0, help="Teszt szög (fok)")
    parser.add_argument(
        "--speeds", nargs="+", type=int, default=None,
        help="Tesztelt sebességek (F értékek)"
    )
    parser.add_argument("--axes", nargs="+", choices=["X", "Y", "Z"], help="Tengelyek")
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

    test = MotionTest(
        port=args.port,
        baudrate=args.baud,
        test_angle=args.angle,
        speeds=args.speeds,
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
