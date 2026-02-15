#!/usr/bin/env python3
"""
Firmware Parameter Probe - Firmware beállítások felderítése
===========================================================

Megpróbál különböző parancsokat küldeni a firmware-nek, hogy
kiderüljön milyen konfigurálható paraméterek léteznek.

Tesztelt parancscsoportok:
  - GRBL: $$, $0-$132, $I
  - Marlin: M115, M92, M201, M203, M204, M205, M500-M502, M906, M350
  - Egyéb: M503, M114, M119, $H, $X

Használat:
  Önálló:     python3 firmware_probe.py [--port /dev/ttyUSB0]
  Importálva: from firmware_probe import FirmwareProbe
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
class ProbeResult:
    """Egyedi parancs próba eredménye"""
    command: str
    description: str
    response: str
    recognized: bool  # A firmware felismerte-e (nem ERROR)
    duration_ms: float = 0.0


@dataclass
class ProbeReport:
    """Teljes felderítési riport"""
    timestamp: str = ""
    port: str = ""
    firmware_type: str = "unknown"
    recognized_commands: List[ProbeResult] = field(default_factory=list)
    unrecognized_commands: List[ProbeResult] = field(default_factory=list)
    all_results: List[ProbeResult] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# Firmware Probe motor
# ============================================================

class FirmwareProbe:
    """
    Firmware paraméter felderítő.
    Különböző G-code / M-code parancsokat próbál küldeni,
    és figyeli a firmware válaszát.
    """

    ERROR_PATTERN = re.compile(r"ERROR|COMMAND NOT RECOGNIZED", re.IGNORECASE)
    ENDSTOP_PATTERN = re.compile(
        r"INFO:\s*ENDSTOP:\s*\[X:(\d+)\s*Y:(\d+)\s*Z:(\d+)\]"
    )
    MOVE_PATTERN = re.compile(
        r"INFO:\s*LINEAR\s*MOVE:\s*X(-?\d+\.?\d*)\s*Y(-?\d+\.?\d*)\s*Z(-?\d+\.?\d*)"
    )

    # Parancsok csoportosítva
    PROBE_COMMANDS = [
        # -- GRBL parancsok --
        ("$$", "GRBL beállítások listázása"),
        ("$I", "GRBL build info"),
        ("$#", "GRBL paraméterek (G54, G28 stb.)"),
        ("$N", "GRBL startup blokkok"),
        ("$G", "GRBL parser állapot"),

        # -- Firmware info --
        ("M115", "Firmware verzió / azonosítás"),
        ("M503", "Mentett beállítások megjelenítése"),
        ("M114", "Aktuális pozíció lekérdezése"),

        # -- Lépés beállítások --
        ("M92", "Steps/unit (lépés/fok) lekérdezése"),
        ("M92 X100", "Steps/unit X tengely beállítás próba"),

        # -- Gyorsulás beállítások --
        ("M201", "Max gyorsulás lekérdezése"),
        ("M203", "Max előtolás lekérdezése"),
        ("M204", "Gyorsulás beállítás lekérdezése"),
        ("M205", "Jerk beállítás lekérdezése"),

        # -- Motor áram / microstepping --
        ("M906", "TMC driver áram lekérdezése"),
        ("M350", "Microstepping lekérdezése"),
        ("M569", "Stepper driver mód lekérdezése"),

        # -- Mentés / visszaállítás --
        ("M500", "Beállítások mentése EEPROM-ba"),
        ("M501", "Beállítások betöltése EEPROM-ból"),
        ("M502", "Gyári beállítások visszaállítása"),

        # -- GRBL egyedi beállítások --
        ("$0", "GRBL $0 step pulse time"),
        ("$1", "GRBL $1 step idle delay"),
        ("$2", "GRBL $2 step port invert"),
        ("$3", "GRBL $3 direction port invert"),
        ("$4", "GRBL $4 step enable invert"),
        ("$5", "GRBL $5 limit pins invert"),
        ("$6", "GRBL $6 probe pin invert"),
        ("$10", "GRBL $10 status report"),
        ("$11", "GRBL $11 junction deviation"),
        ("$12", "GRBL $12 arc tolerance"),
        ("$13", "GRBL $13 report inches"),
        ("$20", "GRBL $20 soft limits"),
        ("$21", "GRBL $21 hard limits"),
        ("$22", "GRBL $22 homing cycle"),
        ("$23", "GRBL $23 homing dir invert"),
        ("$24", "GRBL $24 homing feed"),
        ("$25", "GRBL $25 homing seek"),
        ("$26", "GRBL $26 homing debounce"),
        ("$27", "GRBL $27 homing pull-off"),
        ("$30", "GRBL $30 max spindle"),
        ("$31", "GRBL $31 min spindle"),
        ("$32", "GRBL $32 laser mode"),
        ("$100", "GRBL $100 X steps/mm"),
        ("$101", "GRBL $101 Y steps/mm"),
        ("$102", "GRBL $102 Z steps/mm"),
        ("$110", "GRBL $110 X max rate"),
        ("$111", "GRBL $111 Y max rate"),
        ("$112", "GRBL $112 Z max rate"),
        ("$120", "GRBL $120 X accel"),
        ("$121", "GRBL $121 Y accel"),
        ("$122", "GRBL $122 Z accel"),
        ("$130", "GRBL $130 X max travel"),
        ("$131", "GRBL $131 Y max travel"),
        ("$132", "GRBL $132 Z max travel"),

        # -- Ismert robot-specifikus --
        ("M119", "Endstop állapot"),
        ("M17", "Motor engedélyezés"),
        ("M84", "Motor letiltás"),
        ("M3 S0", "Szervó / gripper"),
        ("M10", "Szívó be"),
        ("M11", "Szívó ki"),
        ("G92 X0 Y0 Z0", "Pozíció nullázás"),
    ]

    def __init__(
        self,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 2.0,
        stop_event: Optional[threading.Event] = None,
    ):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
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

    def _send(self, command: str, wait: float = 1.5) -> Tuple[str, float]:
        """Parancs küldése, válasz + latencia"""
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

    def _read_response(self, timeout: float = 1.5) -> str:
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
                        # INFO: vagy ERROR: sor = firmware válasz vége
                        if re.match(r"^(INFO|ERROR):", line, re.IGNORECASE):
                            break
                        # GRBL ok / error
                        if line.lower() in ("ok", "error"):
                            break
                        if line.startswith("error:"):
                            break
                        # GRBL $ válasz - vonalak $key=value formátumban
                        # Többet is olvashatunk, ha van
                except Exception:
                    break
            else:
                time.sleep(0.02)

        return "\n".join(lines)

    # ----------------------------------------------------------
    # Probe futtatás
    # ----------------------------------------------------------

    def run_probe(self) -> ProbeReport:
        """Összes parancs kipróbálása"""
        self._start_time = time.perf_counter()
        self._log_entries.clear()

        report = ProbeReport(
            timestamp=datetime.now().isoformat(),
            port=self.port,
        )

        self._log("info", f"Firmware felderítés indítása ({len(self.PROBE_COMMANDS)} parancs)")

        print(f"\n{'='*60}")
        print("  FIRMWARE PARAMÉTER FELDERÍTÉS")
        print(f"{'='*60}")
        print(f"  Port: {self.port}")
        print(f"  Parancsok száma: {len(self.PROBE_COMMANDS)}")
        print(f"{'-'*60}")

        total = len(self.PROBE_COMMANDS)
        for i, (cmd, desc) in enumerate(self.PROBE_COMMANDS):
            # Leállítás ellenőrzése
            if self._stop_event.is_set():
                self._log("warn", "Felderítés leállítva!")
                print("\n  ⛔ Felderítés leállítva!")
                report.summary["cancelled"] = True
                break

            pct = round(((i + 1) / total) * 100)
            self._log("info", f"Próba: {cmd} ({desc})", pct=pct)

            resp, ms = self._send(cmd, wait=1.5)

            recognized = bool(resp) and not self.ERROR_PATTERN.search(resp)

            result = ProbeResult(
                command=cmd,
                description=desc,
                response=resp[:500] if resp else "",
                recognized=recognized,
                duration_ms=ms,
            )

            report.all_results.append(result)

            if recognized and resp:
                report.recognized_commands.append(result)
                icon = "✅"
                self._log("result", f"Felismert: {cmd}", recognized=True)
            else:
                report.unrecognized_commands.append(result)
                icon = "  "

            resp_short = (resp or "nincs válasz")[:80].replace("\n", " | ")
            print(f"  {icon} {cmd:20s} -> {resp_short}")

            # Kis szünet parancsok között
            time.sleep(0.1)

        # Firmware típus meghatározása
        report.firmware_type = self._detect_firmware_type(report)

        # Összesítés
        report.summary = {
            "total_commands": len(report.all_results),
            "recognized": len(report.recognized_commands),
            "unrecognized": len(report.unrecognized_commands),
            "firmware_type": report.firmware_type,
            "configurable_params": self._extract_params(report),
        }

        self._log("info",
                  f"Felderítés befejezve: {len(report.recognized_commands)}/{len(report.all_results)} felismert, "
                  f"firmware: {report.firmware_type}", pct=100)

        print(f"\n{'='*60}")
        print(f"  Felismert parancsok: {len(report.recognized_commands)}/{len(report.all_results)}")
        print(f"  Firmware típus: {report.firmware_type}")
        print(f"{'='*60}")

        return report

    def run_with_serial(
        self,
        ser: serial.Serial,
        stop_event: Optional[threading.Event] = None,
    ) -> ProbeReport:
        """
        Probe futtatása meglévő serial kapcsolaton.
        A bridge server hívja - nem nyit/zár portot.
        """
        self._serial = ser
        if stop_event is not None:
            self._stop_event = stop_event
        report = self.run_probe()
        self._serial = None  # Ne zárd be - a bridge kezeli
        return report

    # ----------------------------------------------------------
    # Analízis
    # ----------------------------------------------------------

    def _detect_firmware_type(self, report: ProbeReport) -> str:
        """Firmware típus meghatározása a válaszok alapján"""
        recognized_cmds = {r.command for r in report.recognized_commands}

        # GRBL-szerű
        if "$$" in recognized_cmds or "$0" in recognized_cmds:
            return "grbl"

        # Marlin-szerű
        marlin_cmds = {"M92", "M201", "M203", "M204", "M503"}
        if len(marlin_cmds & recognized_cmds) >= 2:
            return "marlin"

        # Egyedi firmware (a robotkar firmware-je)
        robot_cmds = {"M119", "M17", "M84", "G92 X0 Y0 Z0"}
        if len(robot_cmds & recognized_cmds) >= 2:
            return "custom_robot_arm"

        return "unknown"

    def _extract_params(self, report: ProbeReport) -> Dict[str, Any]:
        """Konfigurálható paraméterek kinyerése a válaszokból"""
        params = {}

        for result in report.recognized_commands:
            resp = result.response

            # GRBL $key=value
            for match in re.finditer(r"\$(\d+)\s*=\s*([0-9.]+)", resp):
                key = f"${match.group(1)}"
                try:
                    val = float(match.group(2))
                    params[key] = val
                except ValueError:
                    params[key] = match.group(2)

            # Marlin M92 X Y Z
            m92_match = re.search(
                r"M92.*X\s*([0-9.]+).*Y\s*([0-9.]+).*Z\s*([0-9.]+)", resp
            )
            if m92_match:
                params["steps_per_unit"] = {
                    "X": float(m92_match.group(1)),
                    "Y": float(m92_match.group(2)),
                    "Z": float(m92_match.group(3)),
                }

            # Marlin M201 / M203 accel/feedrate
            for prefix, key in [("M201", "max_acceleration"), ("M203", "max_feedrate")]:
                m_match = re.search(
                    rf"{prefix}.*X\s*([0-9.]+).*Y\s*([0-9.]+).*Z\s*([0-9.]+)", resp
                )
                if m_match:
                    params[key] = {
                        "X": float(m_match.group(1)),
                        "Y": float(m_match.group(2)),
                        "Z": float(m_match.group(3)),
                    }

        return params


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Firmware Parameter Probe - Firmware beállítások felderítése",
    )
    parser.add_argument("--port", default="/dev/ttyUSB0", help="Soros port")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate")
    parser.add_argument("--json", metavar="FILE", help="JSON riport mentés")

    args = parser.parse_args()

    if not SERIAL_AVAILABLE:
        print("HIBA: pyserial szükséges: pip install pyserial")
        sys.exit(1)

    try:
        ser = serial.Serial(
            port=args.port,
            baudrate=args.baud,
            timeout=2.0,
            write_timeout=2.0,
        )
    except serial.SerialException as e:
        print(f"HIBA: Nem sikerült megnyitni: {e}")
        sys.exit(1)

    # Arduino reset utáni várakozás
    print("Várakozás Arduino inicializálásra (3 mp)...")
    time.sleep(3.0)
    # Buffer ürítés
    if ser.in_waiting:
        ser.read(ser.in_waiting)

    probe = FirmwareProbe(port=args.port, baudrate=args.baud)
    probe._serial = ser

    try:
        report = probe.run_probe()
    finally:
        ser.close()

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report.to_dict(), f, indent=2, ensure_ascii=False)
        print(f"\nJSON riport mentve: {args.json}")

    sys.exit(0)


if __name__ == "__main__":
    main()
