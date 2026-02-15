#!/usr/bin/env python3
"""
Robot Arm Board Diagnostics - Átfogó hardver diagnosztika
=========================================================

Teszteli az Arduino UNO + CNC Shield V3 vezérlő összes funkcióját:
  - Soros kapcsolat és welcome üzenet
  - Firmware azonosítás
  - Tengely mozgás (J1/X, J2/Y, J3/Z)
  - Gripper szervó (M3 S)
  - Endstop állapot (M119)
  - Szívópumpa relé (M10/M11)
  - Motor enable/disable (M17/M84)
  - Kalibrációs parancs (G92)
  - Kommunikációs latencia
  - Hibakezelés (ismeretlen parancs)

Használat:
  Önálló:       python3 board_diagnostics.py [--port /dev/ttyUSB0] [--auto]
  Importálva:   from board_diagnostics import BoardDiagnostics
"""

import sys
import time
import re
import argparse
import json
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime

try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False


# ============================================================
# Eredmény típusok
# ============================================================

@dataclass
class TestResult:
    """Egyedi teszt eredménye"""
    name: str
    passed: bool
    message: str
    details: Dict[str, Any] = field(default_factory=dict)
    duration_ms: float = 0.0
    skipped: bool = False


@dataclass
class DiagnosticsReport:
    """Teljes diagnosztikai riport"""
    timestamp: str = ""
    port: str = ""
    device_signature: str = ""
    firmware_info: str = ""
    tests: List[TestResult] = field(default_factory=list)
    total_tests: int = 0
    passed_tests: int = 0
    failed_tests: int = 0
    skipped_tests: int = 0
    overall_passed: bool = False

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return d

    def summary(self) -> str:
        lines = [
            "=" * 60,
            "  ROBOT ARM BOARD DIAGNOSZTIKA - RIPORT",
            "=" * 60,
            f"  Időpont:     {self.timestamp}",
            f"  Port:        {self.port}",
            f"  Firmware:    {self.firmware_info or 'N/A'}",
            f"  Eredmény:    {'SIKERES' if self.overall_passed else 'HIBÁS'}",
            f"  Tesztek:     {self.passed_tests}/{self.total_tests} OK"
            + (f", {self.skipped_tests} kihagyva" if self.skipped_tests else ""),
            "-" * 60,
        ]
        for t in self.tests:
            if t.skipped:
                icon = "⏭️ "
                status = "SKIP"
            elif t.passed:
                icon = "✅"
                status = "OK"
            else:
                icon = "❌"
                status = "FAIL"
            lines.append(f"  {icon} [{status:4s}] {t.name}")
            lines.append(f"          {t.message}")
            if t.duration_ms > 0:
                lines.append(f"          ({t.duration_ms:.1f} ms)")
        lines.append("=" * 60)
        return "\n".join(lines)


# ============================================================
# Diagnosztikai motor
# ============================================================

class BoardDiagnostics:
    """
    Arduino UNO + CNC Shield V3 robotkar vezérlő diagnosztika.
    
    Közvetlenül a soros porton kommunikál - a bridge servert
    le kell állítani használat előtt, VAGY az API-n keresztül
    hívandó (ami a meglévő kapcsolatot használja).
    """

    MOVE_RESPONSE = re.compile(
        r"INFO:\s*LINEAR\s*MOVE:\s*X(-?\d+\.?\d*)\s*Y(-?\d+\.?\d*)\s*Z(-?\d+\.?\d*)"
    )
    ENDSTOP_PATTERN = re.compile(
        r"INFO:\s*ENDSTOP:\s*\[X:(\d+)\s*Y:(\d+)\s*Z:(\d+)\]"
    )
    WELCOME_MSG = "Connected, please calibrate the mechanical coordinates"

    def __init__(
        self,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 3.0,
        interactive: bool = True,
    ):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.interactive = interactive
        self._serial: Optional[serial.Serial] = None
        self.report = DiagnosticsReport(
            timestamp=datetime.now().isoformat(),
            port=port,
        )

    # ----------------------------------------------------------
    # Soros kommunikáció alap
    # ----------------------------------------------------------

    def _open(self) -> bool:
        """Soros port megnyitása"""
        try:
            self._serial = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=self.timeout,
                write_timeout=self.timeout,
            )
            return True
        except serial.SerialException as e:
            print(f"  HIBA: Nem sikerült megnyitni a portot: {e}")
            return False

    def _close(self):
        """Soros port bezárása"""
        if self._serial and self._serial.is_open:
            self._serial.close()
            self._serial = None

    def _send(self, command: str, wait: float = 1.0) -> str:
        """Parancs küldése és válasz olvasása"""
        if not self._serial or not self._serial.is_open:
            return ""
        
        # Buffer ürítés
        self._serial.reset_input_buffer()
        
        # Küldés (a firmware \r\n-t vár)
        cmd = command.strip() + "\r\n"
        self._serial.write(cmd.encode())
        self._serial.flush()
        
        # Válasz olvasása readline-nal (ez blokkol a timeout-ig)
        return self._read_response(wait)

    def _read_response(self, timeout: float = 2.0) -> str:
        """Válasz olvasása a soros portról (readline alapú, mint a driver)"""
        if not self._serial:
            return ""
        
        lines = []
        deadline = time.perf_counter() + timeout
        
        while time.perf_counter() < deadline:
            if self._serial.in_waiting > 0:
                try:
                    line_bytes = self._serial.readline()
                    line = line_bytes.decode(errors='replace').strip()
                    if line:
                        lines.append(line)
                        # INFO: vagy ERROR: sor = teljes válasz
                        if re.match(r"^(INFO|ERROR):", line, re.IGNORECASE):
                            break
                except Exception:
                    break
            else:
                time.sleep(0.02)
        
        return "\n".join(lines)

    def _send_timed(self, command: str, wait: float = 2.0) -> Tuple[str, float]:
        """Parancs küldése, válasz + latencia mérése"""
        if not self._serial or not self._serial.is_open:
            return "", 0.0
        
        self._serial.reset_input_buffer()
        cmd = command.strip() + "\r\n"
        
        start = time.perf_counter()
        self._serial.write(cmd.encode())
        self._serial.flush()
        
        response = self._read_response(wait)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        
        return response, elapsed_ms

    def _confirm(self, prompt: str) -> bool:
        """Felhasználó jóváhagyás kérése interaktív módban"""
        if not self.interactive:
            return True
        answer = input(f"  ❓ {prompt} (i/n): ").strip().lower()
        return answer in ("i", "y", "igen", "yes", "")

    # ----------------------------------------------------------
    # Egyedi tesztek
    # ----------------------------------------------------------

    def test_connection(self) -> TestResult:
        """1. Soros kapcsolat teszt"""
        start = time.perf_counter()
        
        if not SERIAL_AVAILABLE:
            return TestResult(
                name="Soros kapcsolat",
                passed=False,
                message="pyserial nincs telepítve!",
            )
        
        # Port létezik?
        ports = [p.device for p in serial.tools.list_ports.comports()]
        if self.port not in ports:
            return TestResult(
                name="Soros kapcsolat",
                passed=False,
                message=f"Port nem található: {self.port}. Elérhető portok: {ports}",
                details={"available_ports": ports},
            )
        
        # Port megnyitás
        if not self._open():
            return TestResult(
                name="Soros kapcsolat",
                passed=False,
                message=f"Nem sikerült megnyitni: {self.port}",
            )
        
        elapsed = (time.perf_counter() - start) * 1000.0
        return TestResult(
            name="Soros kapcsolat",
            passed=True,
            message=f"Port megnyitva: {self.port} @ {self.baudrate} baud",
            details={"port": self.port, "baudrate": self.baudrate},
            duration_ms=elapsed,
        )

    def test_welcome(self) -> TestResult:
        """2. Welcome üzenet teszt - firmware felismerés"""
        start = time.perf_counter()
        
        if not self._serial:
            return TestResult(
                name="Welcome üzenet",
                passed=False,
                message="Nincs soros kapcsolat",
            )
        
        # Arduino UNO reset után 2-3 mp-et kell várni
        print("    Várakozás Arduino inicializálásra (3 mp)...")
        time.sleep(3.0)
        
        # Buffer olvasás
        welcome = ""
        if self._serial.in_waiting:
            data = self._serial.read(self._serial.in_waiting)
            welcome = data.decode(errors='replace').strip()
        
        elapsed = (time.perf_counter() - start) * 1000.0
        
        if self.WELCOME_MSG in welcome:
            self.report.firmware_info = welcome
            return TestResult(
                name="Welcome üzenet",
                passed=True,
                message=f"Firmware felismertve: {welcome}",
                details={"raw": welcome},
                duration_ms=elapsed,
            )
        elif welcome:
            self.report.firmware_info = f"Ismeretlen: {welcome[:100]}"
            return TestResult(
                name="Welcome üzenet",
                passed=False,
                message=f"Ismeretlen válasz: {welcome[:100]}",
                details={"raw": welcome},
                duration_ms=elapsed,
            )
        else:
            return TestResult(
                name="Welcome üzenet",
                passed=False,
                message="Nem érkezett welcome üzenet (üres buffer). Lehet, hogy a firmware nincs feltöltve.",
                duration_ms=elapsed,
            )

    def test_firmware_version(self) -> TestResult:
        """3. Firmware verzió lekérés (M115)"""
        resp, ms = self._send_timed("M115", wait=2.0)
        
        if resp and "ERROR" not in resp.upper():
            return TestResult(
                name="Firmware verzió (M115)",
                passed=True,
                message=f"Válasz: {resp[:200]}",
                details={"response": resp},
                duration_ms=ms,
            )
        elif "ERROR" in resp.upper() or "COMMAND NOT RECOGNIZED" in resp.upper():
            return TestResult(
                name="Firmware verzió (M115)",
                passed=True,
                message="M115 nem támogatott (ez normális az egyedi firmware-nél)",
                details={"response": resp},
                duration_ms=ms,
            )
        else:
            return TestResult(
                name="Firmware verzió (M115)",
                passed=True,
                message="Nincs válasz az M115-re (nem támogatott)",
                duration_ms=ms,
            )

    def test_endstops(self) -> TestResult:
        """4. Endstop állapot (M119)"""
        resp, ms = self._send_timed("M119", wait=2.0)
        
        match = self.ENDSTOP_PATTERN.search(resp)
        if match:
            x, y, z = match.group(1), match.group(2), match.group(3)
            return TestResult(
                name="Endstop állapot (M119)",
                passed=True,
                message=f"Endstopok: X={x} Y={y} Z={z} (0=szabad, 1=nyomva)",
                details={"x": int(x), "y": int(y), "z": int(z), "raw": resp},
                duration_ms=ms,
            )
        elif resp:
            return TestResult(
                name="Endstop állapot (M119)",
                passed=False,
                message=f"Váratlan válasz: {resp[:200]}",
                details={"raw": resp},
                duration_ms=ms,
            )
        else:
            return TestResult(
                name="Endstop állapot (M119)",
                passed=False,
                message="Nincs válasz az M119-re",
                duration_ms=ms,
            )

    def test_calibration(self) -> TestResult:
        """5. Kalibráció / pozíció nullázás (G92)"""
        resp, ms = self._send_timed("G92 X0 Y0 Z0", wait=1.5)
        
        # G92 általában nem ad választ, vagy OK-t ad
        if "ERROR" in resp.upper():
            return TestResult(
                name="Kalibrációs parancs (G92)",
                passed=False,
                message=f"Hiba: {resp}",
                details={"raw": resp},
                duration_ms=ms,
            )
        
        return TestResult(
            name="Kalibrációs parancs (G92)",
            passed=True,
            message=f"Pozíció nullázva (G92 X0 Y0 Z0). Válasz: '{resp or 'nincs'}'",
            details={"raw": resp},
            duration_ms=ms,
        )

    def test_axis_movement(self, axis: str, angle: float) -> TestResult:
        """6. Tengely mozgás teszt"""
        axis_name = {"X": "J1 (bázis)", "Y": "J2 (váll)", "Z": "J3 (könyök)"}
        label = axis_name.get(axis, axis)
        
        # A firmware minden tengelyt vár a parancsban
        axes = {"X": 0, "Y": 0, "Z": 0}
        axes[axis] = angle
        cmd = f"G1 X{axes['X']} Y{axes['Y']} Z{axes['Z']} F30"
        resp, ms = self._send_timed(cmd, wait=4.0)
        
        match = self.MOVE_RESPONSE.search(resp)
        if match:
            x_val, y_val, z_val = match.group(1), match.group(2), match.group(3)
            return TestResult(
                name=f"Tengely mozgás: {label}",
                passed=True,
                message=f"Mozgatás {cmd} -> X={x_val} Y={y_val} Z={z_val}",
                details={"command": cmd, "x": float(x_val), "y": float(y_val), "z": float(z_val), "raw": resp},
                duration_ms=ms,
            )
        elif "ERROR" in resp.upper():
            return TestResult(
                name=f"Tengely mozgás: {label}",
                passed=False,
                message=f"Hiba: {resp}",
                details={"command": cmd, "raw": resp},
                duration_ms=ms,
            )
        elif resp:
            return TestResult(
                name=f"Tengely mozgás: {label}",
                passed=False,
                message=f"Váratlan válasz: {resp[:200]}",
                details={"command": cmd, "raw": resp},
                duration_ms=ms,
            )
        else:
            return TestResult(
                name=f"Tengely mozgás: {label}",
                passed=False,
                message=f"Nincs válasz a mozgatásra ({cmd})",
                details={"command": cmd},
                duration_ms=ms,
            )

    def test_return_home(self) -> TestResult:
        """7. Visszatérés home pozícióba"""
        cmd = "G1 X0 Y0 Z0 F30"
        resp, ms = self._send_timed(cmd, wait=3.0)
        
        match = self.MOVE_RESPONSE.search(resp)
        if match:
            return TestResult(
                name="Home pozíció (G1 X0 Y0 Z0)",
                passed=True,
                message=f"Visszatérés sikerült: {resp}",
                details={"raw": resp},
                duration_ms=ms,
            )
        else:
            return TestResult(
                name="Home pozíció (G1 X0 Y0 Z0)",
                passed=not bool("ERROR" in resp.upper()),
                message=f"Válasz: '{resp or 'nincs'}'",
                details={"raw": resp},
                duration_ms=ms,
            )

    def test_gripper(self) -> TestResult:
        """8. Gripper szervó teszt"""
        results = []
        
        # Zárás
        resp_close, ms1 = self._send_timed("M3 S90", wait=1.5)
        results.append(("Zárás (M3 S90)", resp_close, ms1))
        time.sleep(0.5)
        
        # Nyitás
        resp_open, ms2 = self._send_timed("M3 S0", wait=1.5)
        results.append(("Nyitás (M3 S0)", resp_open, ms2))
        
        errors = [r for r in results if "ERROR" in (r[1] or "").upper()]
        total_ms = ms1 + ms2
        
        if errors:
            return TestResult(
                name="Gripper szervó",
                passed=False,
                message=f"Hiba: {errors[0][1]}",
                details={"close_resp": resp_close, "open_resp": resp_open},
                duration_ms=total_ms,
            )
        
        return TestResult(
            name="Gripper szervó",
            passed=True,
            message=f"Zárás: '{resp_close or 'ok'}', Nyitás: '{resp_open or 'ok'}'",
            details={"close_resp": resp_close, "open_resp": resp_open},
            duration_ms=total_ms,
        )

    def test_sucker(self) -> TestResult:
        """9. Szívópumpa relé teszt"""
        # Bekapcsolás
        resp_on, ms1 = self._send_timed("M10", wait=1.5)
        time.sleep(0.5)
        
        # Kikapcsolás
        resp_off, ms2 = self._send_timed("M11", wait=1.5)
        total_ms = ms1 + ms2
        
        errors = [r for r in [resp_on, resp_off] if "ERROR" in (r or "").upper()]
        if errors:
            return TestResult(
                name="Szívópumpa (relé)",
                passed=False,
                message=f"Hiba: {errors[0]}",
                details={"on_resp": resp_on, "off_resp": resp_off},
                duration_ms=total_ms,
            )
        
        return TestResult(
            name="Szívópumpa (relé)",
            passed=True,
            message=f"Be (M10): '{resp_on or 'ok'}', Ki (M11): '{resp_off or 'ok'}'",
            details={"on_resp": resp_on, "off_resp": resp_off},
            duration_ms=total_ms,
        )

    def test_enable_disable(self) -> TestResult:
        """10. Motor enable/disable (M17/M84)"""
        resp_en, ms1 = self._send_timed("M17", wait=1.0)
        time.sleep(0.3)
        resp_dis, ms2 = self._send_timed("M84", wait=1.0)
        time.sleep(0.3)
        # Újra engedélyezés
        self._send("M17", wait=0.5)
        
        total_ms = ms1 + ms2
        
        errors = [r for r in [resp_en, resp_dis] if "ERROR" in (r or "").upper()]
        if errors:
            return TestResult(
                name="Motor enable/disable",
                passed=False,
                message=f"Hiba: {errors[0]}",
                details={"enable_resp": resp_en, "disable_resp": resp_dis},
                duration_ms=total_ms,
            )
        
        return TestResult(
            name="Motor enable/disable",
            passed=True,
            message=f"Enable (M17): '{resp_en or 'ok'}', Disable (M84): '{resp_dis or 'ok'}'",
            details={"enable_resp": resp_en, "disable_resp": resp_dis},
            duration_ms=total_ms,
        )

    def test_latency(self) -> TestResult:
        """11. Kommunikációs latencia mérés"""
        latencies = []
        
        for i in range(5):
            resp, ms = self._send_timed("M119", wait=2.0)
            if resp:
                latencies.append(ms)
            time.sleep(0.1)
        
        if not latencies:
            return TestResult(
                name="Kommunikációs latencia",
                passed=False,
                message="Nem sikerült latenciát mérni (nincs válasz)",
            )
        
        avg = sum(latencies) / len(latencies)
        min_l = min(latencies)
        max_l = max(latencies)
        
        return TestResult(
            name="Kommunikációs latencia",
            passed=avg < 500.0,  # 500ms alatt elfogadható
            message=f"Átlag: {avg:.1f} ms, Min: {min_l:.1f} ms, Max: {max_l:.1f} ms ({len(latencies)} mérés)",
            details={
                "avg_ms": round(avg, 1),
                "min_ms": round(min_l, 1),
                "max_ms": round(max_l, 1),
                "samples": len(latencies),
                "values": [round(l, 1) for l in latencies],
            },
            duration_ms=avg,
        )

    def test_error_handling(self) -> TestResult:
        """12. Hibakezelés - ismeretlen parancs"""
        resp, ms = self._send_timed("XYZINVALID123", wait=2.0)
        
        if "ERROR" in resp.upper() or "COMMAND NOT RECOGNIZED" in resp.upper():
            return TestResult(
                name="Hibakezelés (ismeretlen parancs)",
                passed=True,
                message=f"Helyes hibaválasz: {resp}",
                details={"raw": resp},
                duration_ms=ms,
            )
        elif resp:
            return TestResult(
                name="Hibakezelés (ismeretlen parancs)",
                passed=False,
                message=f"Nem kaptunk hibaüzenetet, válasz: {resp[:200]}",
                details={"raw": resp},
                duration_ms=ms,
            )
        else:
            return TestResult(
                name="Hibakezelés (ismeretlen parancs)",
                passed=False,
                message="Nincs válasz az ismeretlen parancsra",
                duration_ms=ms,
            )

    # ----------------------------------------------------------
    # Teljes diagnosztika futtatás
    # ----------------------------------------------------------

    def run_all(self, move_test: bool = True) -> DiagnosticsReport:
        """Összes diagnosztikai teszt futtatása"""
        print("\n" + "=" * 60)
        print("  ROBOT ARM BOARD DIAGNOSZTIKA INDÍTÁSA")
        print("=" * 60)
        print(f"  Port: {self.port}")
        print(f"  Baud: {self.baudrate}")
        print(f"  Mód:  {'Interaktív' if self.interactive else 'Automatikus'}")
        print("-" * 60)

        # 1. Kapcsolat
        print("\n[1/12] Soros kapcsolat teszt...")
        result = self.test_connection()
        self.report.tests.append(result)
        self._print_result(result)
        if not result.passed:
            return self._finalize()

        # 2. Welcome
        print("\n[2/12] Welcome üzenet (firmware felismerés)...")
        result = self.test_welcome()
        self.report.tests.append(result)
        self._print_result(result)
        
        if not result.passed:
            print("  ⚠️  A firmware nem ismerhető fel. A további tesztek valószínűleg nem működnek.")
            if self.interactive:
                if not self._confirm("Folytatod a teszteket?"):
                    self._close()
                    return self._finalize()

        # 3. Firmware verzió
        print("\n[3/12] Firmware verzió (M115)...")
        result = self.test_firmware_version()
        self.report.tests.append(result)
        self._print_result(result)

        # 4. Endstop
        print("\n[4/12] Endstop állapot (M119)...")
        result = self.test_endstops()
        self.report.tests.append(result)
        self._print_result(result)

        # 5. Kalibráció
        print("\n[5/12] Kalibrációs parancs (G92 X0 Y0 Z0)...")
        result = self.test_calibration()
        self.report.tests.append(result)
        self._print_result(result)

        # 6-8. Tengely mozgás (felhasználó jóváhagyás kell)
        if move_test:
            do_move = True
            if self.interactive:
                print("\n  ⚠️  A következő tesztek mozgatják a robotkart!")
                print("     Győződj meg róla, hogy a munkaterület szabad.")
                do_move = self._confirm("Indulhat a mozgásteszt?")
            
            if do_move:
                for idx, (axis, angle, label) in enumerate([
                    ("X", 10, "J1 bázis"),
                    ("Y", 10, "J2 váll"),
                    ("Z", 10, "J3 könyök"),
                ], start=6):
                    print(f"\n[{idx}/12] Tengely mozgás: {label} ({axis}{angle}°)...")
                    result = self.test_axis_movement(axis, angle)
                    self.report.tests.append(result)
                    self._print_result(result)
                    time.sleep(0.5)
                
                # Home
                print("\n[9/12] Visszatérés home pozícióba...")
                result = self.test_return_home()
                self.report.tests.append(result)
                self._print_result(result)
            else:
                for name in [
                    "Tengely mozgás: J1 (bázis)",
                    "Tengely mozgás: J2 (váll)",
                    "Tengely mozgás: J3 (könyök)",
                    "Home pozíció (G1 X0 Y0 Z0)",
                ]:
                    self.report.tests.append(TestResult(
                        name=name, passed=True, message="Kihagyva (felhasználó döntése)", skipped=True,
                    ))
        else:
            for name in [
                "Tengely mozgás: J1 (bázis)",
                "Tengely mozgás: J2 (váll)",
                "Tengely mozgás: J3 (könyök)",
                "Home pozíció (G1 X0 Y0 Z0)",
            ]:
                self.report.tests.append(TestResult(
                    name=name, passed=True, message="Kihagyva (--no-move)", skipped=True,
                ))

        # 10. Gripper
        print("\n[10/12] Gripper szervó teszt...")
        if self.interactive:
            if self._confirm("Gripper tesztelése (mozgó alkatrész)?"):
                result = self.test_gripper()
            else:
                result = TestResult(name="Gripper szervó", passed=True, message="Kihagyva", skipped=True)
        else:
            result = self.test_gripper()
        self.report.tests.append(result)
        self._print_result(result)

        # 11. Szívópumpa
        print("\n[11/12] Szívópumpa (relé) teszt...")
        if self.interactive:
            if self._confirm("Szívópumpa tesztelése?"):
                result = self.test_sucker()
            else:
                result = TestResult(name="Szívópumpa (relé)", passed=True, message="Kihagyva", skipped=True)
        else:
            result = self.test_sucker()
        self.report.tests.append(result)
        self._print_result(result)

        # 12. Enable/disable
        print("\n[12/12] Motor enable/disable + latencia + hibakezelés...")
        result = self.test_enable_disable()
        self.report.tests.append(result)
        self._print_result(result)

        # Extra: Latencia
        print("\n[+] Kommunikációs latencia mérés...")
        result = self.test_latency()
        self.report.tests.append(result)
        self._print_result(result)

        # Extra: Hibakezelés
        print("\n[+] Hibakezelés teszt...")
        result = self.test_error_handling()
        self.report.tests.append(result)
        self._print_result(result)

        # Lezárás
        self._close()
        return self._finalize()

    # ----------------------------------------------------------
    # API-kompatibilis futtatás (nem nyit új soros portot)
    # ----------------------------------------------------------

    def run_with_serial(self, ser: serial.Serial, move_test: bool = False) -> DiagnosticsReport:
        """
        Diagnosztika futtatása meglévő serial kapcsolaton.
        A bridge server hívja - nem nyit/zár portot.
        """
        self._serial = ser
        self.interactive = False
        self.report.timestamp = datetime.now().isoformat()

        tests = []

        # Firmware verzió
        result = self.test_firmware_version()
        tests.append(result)

        # Endstop
        result = self.test_endstops()
        tests.append(result)

        # Kalibráció
        result = self.test_calibration()
        tests.append(result)

        # Tengely mozgás (opcionális)
        if move_test:
            for axis, angle in [("X", 10), ("Y", 10), ("Z", 10)]:
                result = self.test_axis_movement(axis, angle)
                tests.append(result)
                time.sleep(0.5)
            result = self.test_return_home()
            tests.append(result)

        # Gripper
        result = self.test_gripper()
        tests.append(result)

        # Sucker
        result = self.test_sucker()
        tests.append(result)

        # Enable/disable
        result = self.test_enable_disable()
        tests.append(result)

        # Latencia
        result = self.test_latency()
        tests.append(result)

        # Hibakezelés
        result = self.test_error_handling()
        tests.append(result)

        self.report.tests = tests
        self._serial = None  # Ne zárd be - a bridge kezeli
        return self._finalize()

    # ----------------------------------------------------------
    # Segédfüggvények
    # ----------------------------------------------------------

    def _print_result(self, result: TestResult):
        if result.skipped:
            print(f"    ⏭️  KIHAGYVA - {result.message}")
        elif result.passed:
            print(f"    ✅ OK - {result.message}")
        else:
            print(f"    ❌ HIBA - {result.message}")

    def _finalize(self) -> DiagnosticsReport:
        self.report.total_tests = len(self.report.tests)
        self.report.passed_tests = sum(1 for t in self.report.tests if t.passed and not t.skipped)
        self.report.failed_tests = sum(1 for t in self.report.tests if not t.passed)
        self.report.skipped_tests = sum(1 for t in self.report.tests if t.skipped)
        self.report.overall_passed = self.report.failed_tests == 0
        
        print("\n" + self.report.summary())
        return self.report


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Robot Arm Board Diagnosztika",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Példák:
  python3 board_diagnostics.py                        # Interaktív mód
  python3 board_diagnostics.py --auto                 # Automatikus (nincs megerősítés)
  python3 board_diagnostics.py --auto --no-move       # Mozgás nélkül
  python3 board_diagnostics.py --port /dev/ttyUSB1    # Másik port
  python3 board_diagnostics.py --json report.json     # JSON riport mentés
        """,
    )
    parser.add_argument("--port", default="/dev/ttyUSB0", help="Soros port (default: /dev/ttyUSB0)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")
    parser.add_argument("--auto", action="store_true", help="Automatikus mód (nincs megerősítés)")
    parser.add_argument("--no-move", action="store_true", help="Mozgástesztek kihagyása")
    parser.add_argument("--json", metavar="FILE", help="JSON riport mentés fájlba")
    
    args = parser.parse_args()

    diag = BoardDiagnostics(
        port=args.port,
        baudrate=args.baud,
        interactive=not args.auto,
    )

    report = diag.run_all(move_test=not args.no_move)

    # JSON export
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report.to_dict(), f, indent=2, ensure_ascii=False)
        print(f"\nJSON riport mentve: {args.json}")

    # Exit kód
    sys.exit(0 if report.overall_passed else 1)


if __name__ == "__main__":
    main()
