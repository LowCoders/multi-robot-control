"""
Tube Bender Driver - GRBL adapter a csőhajlítóhoz.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from base import DeviceCapabilities, DeviceType
    from grbl_driver import GrblDevice
except ImportError:
    from .base import DeviceCapabilities, DeviceType
    from .grbl_driver import GrblDevice



try:
    from log_config import get_logger
except ImportError:
    from .log_config import get_logger

logger = get_logger(__name__)
class TubeBenderDriver(GrblDevice):
    """
    GRBL-alapú csőhajlító driver.

    A külső API továbbra is tube bender szemantikát használ:
    - tengely aliasok: push/bend/rot
    - step alapú programkezelés (JSON), amit futáskor G-code sorokká fordítunk
    """

    device_type = DeviceType.TUBE_BENDER

    AXIS_ALIASES = {
        "X": "X",
        "Y": "Y",
        "Z": "Z",
        "PUSH": "X",
        "BEND": "Y",
        "ROT": "Z",
    }

    DEFAULT_AXIS_LIMITS = {
        "X": (0.0, 500.0),      # push mm
        "Y": (0.0, 180.0),      # bend deg
        "Z": (-360.0, 360.0),   # rotate deg
    }

    def __init__(
        self,
        device_id: str,
        device_name: str,
        port: str = "/dev/ttyUSB0",
        baudrate: int = 115200,
        timeout: float = 2.0,
        max_feed_rate: float = 1000.0,
        axis_limits: Optional[Dict[str, List[float]]] = None,
        protocol: str = "grbl",
        grbl_settings: Optional[Dict[str, float]] = None,
        program_dir: Optional[str] = None,
        **kwargs,
    ):
        self.protocol = (protocol or "grbl").lower()
        if self.protocol != "grbl":
            raise ValueError("TubeBenderDriver supports only 'grbl' protocol")

        super().__init__(
            device_id=device_id,
            device_name=device_name,
            port=port,
            baudrate=baudrate,
            device_type=DeviceType.TUBE_BENDER,
            timeout=timeout,
            max_feed_rate=max_feed_rate,
        )

        self._axis_limits = self._normalize_axis_limits(axis_limits)
        self._startup_grbl_settings = self._normalize_grbl_settings(grbl_settings)
        self._steps: List[Dict[str, float]] = []
        self._loaded_program_name: str = ""
        self._programs_dir = (
            Path(program_dir)
            if program_dir
            else Path(__file__).resolve().parent.parent / "config" / "tube_bender_programs"
        )
        self._programs_dir.mkdir(parents=True, exist_ok=True)

        self._set_tube_bender_capabilities(max_feed_rate=max_feed_rate)

    async def connect(self) -> bool:
        connected = await super().connect()
        if not connected:
            return False

        if self._startup_grbl_settings:
            await self._apply_startup_grbl_settings()

        await self.get_status()
        return True

    async def get_capabilities(self) -> DeviceCapabilities:
        self._set_tube_bender_capabilities(max_feed_rate=self._capabilities.max_feed_rate)
        return self._capabilities

    async def home(self, axes: Optional[List[str]] = None) -> bool:
        # GRBL alapból teljes homing ciklust futtat.
        return await super().home()

    async def jog(self, axis: str, distance: float, feed_rate: float) -> bool:
        mapped_axis = self._map_axis(axis)
        if not mapped_axis:
            return False
        return await super().jog(mapped_axis, distance, feed_rate)

    async def load_file(self, filepath: str) -> bool:
        path = Path(filepath)
        if path.suffix.lower() != ".json":
            return await super().load_file(filepath)

        try:
            with path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as exc:
            self._set_error(f"Program betöltési hiba: {exc}")
            return False

        steps = payload.get("steps", [])
        if not isinstance(steps, list):
            self._set_error("Érvénytelen program formátum: 'steps' mező hiányzik vagy nem lista")
            return False

        self._steps = [self._normalize_step(step) for step in steps]
        self._loaded_program_name = payload.get("name", path.stem)
        self._gcode_lines = self._steps_to_gcode(self._steps)
        self._current_line_index = 0
        self._status.current_file = str(path)
        self._status.total_lines = len(self._gcode_lines)
        self._status.current_line = 0
        self._status.progress = 0.0
        return True

    async def run(self, from_line: int = 0) -> bool:
        if not self._gcode_lines and self._steps:
            self._gcode_lines = self._steps_to_gcode(self._steps)
            self._status.total_lines = len(self._gcode_lines)
        return await super().run(from_line=from_line)

    async def add_bend_step(self, push: float, angle: float, rotation: float = 0.0) -> bool:
        step = self._normalize_step({"push": push, "angle": angle, "rotation": rotation})
        self._steps.append(step)
        self._gcode_lines = self._steps_to_gcode(self._steps)
        self._status.total_lines = len(self._gcode_lines)
        return True

    async def clear_steps(self) -> bool:
        self._steps = []
        self._gcode_lines = []
        self._current_line_index = 0
        self._status.current_line = 0
        self._status.total_lines = 0
        self._status.progress = 0.0
        return True

    async def get_steps(self) -> List[Dict[str, float]]:
        return list(self._steps)

    async def list_programs(self) -> List[str]:
        return sorted([p.stem for p in self._programs_dir.glob("*.json")])

    async def load_program(self, name: str) -> bool:
        path = self._programs_dir / f"{name}.json"
        if not path.exists():
            self._set_error(f"Program nem található: {name}")
            return False
        return await self.load_file(str(path))

    async def save_program(self, name: str) -> bool:
        if not name:
            self._set_error("Program név nem lehet üres")
            return False

        data = {
            "name": name,
            "steps": [self._normalize_step(step) for step in self._steps],
        }
        path = self._programs_dir / f"{name}.json"
        try:
            with path.open("w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            self._loaded_program_name = name
            self._status.current_file = str(path)
            return True
        except Exception as exc:
            self._set_error(f"Program mentési hiba: {exc}")
            return False

    async def delete_program(self, name: str) -> bool:
        path = self._programs_dir / f"{name}.json"
        if not path.exists():
            return False
        try:
            path.unlink()
            return True
        except Exception as exc:
            self._set_error(f"Program törlési hiba: {exc}")
            return False

    async def enable_motors(self) -> bool:
        # GRBL-ben dedikált "motor enable" parancs nincs.
        return await self.set_grbl_setting(1, 255)

    async def disable_motors(self) -> bool:
        # Visszaállítjuk default idle delay-re.
        return await self.set_grbl_setting(1, 25)

    def _normalize_axis_limits(
        self, axis_limits: Optional[Dict[str, List[float]]]
    ) -> Dict[str, tuple]:
        limits = dict(self.DEFAULT_AXIS_LIMITS)
        if not axis_limits:
            return limits

        for axis, values in axis_limits.items():
            axis_key = axis.upper()
            if axis_key in limits and isinstance(values, (list, tuple)) and len(values) == 2:
                limits[axis_key] = (float(values[0]), float(values[1]))
        return limits

    def _normalize_grbl_settings(
        self, settings: Optional[Dict[str, float]]
    ) -> Dict[int, float]:
        normalized: Dict[int, float] = {}
        if not settings:
            return normalized
        for key, value in settings.items():
            try:


                normalized[int(key)] = float(value)
            except (TypeError, ValueError):
                continue
        return normalized

    async def _apply_startup_grbl_settings(self) -> None:
        for setting, value in self._startup_grbl_settings.items():
            await self.set_grbl_setting(setting, value)
            if setting in (1, 4):
                logger.info(f"[TubeBender] startup GRBL ${setting} applied: {value}")
        current = await self.get_grbl_settings()
        if current:
            s1 = current.get(1)
            s4 = current.get(4)
            if s1 is not None:
                logger.info(f"[TubeBender] startup verify $1={s1}")
            if s4 is not None:
                logger.info(f"[TubeBender] startup verify $4={s4}")

    def _set_tube_bender_capabilities(self, max_feed_rate: float) -> None:
        self._capabilities = DeviceCapabilities(
            axes=["X", "Y", "Z"],
            has_spindle=False,
            has_laser=False,
            has_coolant=False,
            has_probe=False,
            has_gripper=False,
            has_endstops=True,
            supports_motion_test=False,
            supports_firmware_probe=False,
            supports_soft_limits=True,
            supports_streaming_jog=self._protocol.supports_streaming_jog,
            supports_hard_jog_stop=True,
            max_feed_rate=max_feed_rate,
            work_envelope={
                "x": self._axis_limits["X"][1] - self._axis_limits["X"][0],
                "y": self._axis_limits["Y"][1] - self._axis_limits["Y"][0],
                "z": self._axis_limits["Z"][1] - self._axis_limits["Z"][0],
            },
            axis_limits=self._axis_limits,
        )

    def _map_axis(self, axis: str) -> Optional[str]:
        return self.AXIS_ALIASES.get(str(axis).upper())

    def _normalize_step(self, raw: Dict[str, Any]) -> Dict[str, float]:
        return {
            "push": float(raw.get("push", 0.0)),
            "angle": float(raw.get("angle", 0.0)),
            "rotation": float(raw.get("rotation", 0.0)),
        }

    def _steps_to_gcode(self, steps: List[Dict[str, float]]) -> List[str]:
        if not steps:
            return []

        # A firmware eredeti logikáját követjük:
        # 1) push abszolút pozícióra (X)
        # 2) bend abszolút szögre (Y)
        # 3) bend vissza 0-ra
        # 4) opcionális rotáció relatív lépésként (Z)
        lines = ["G21", "G90", "G94"]
        feed_push = min(self._capabilities.max_feed_rate, 1000.0)
        feed_bend = min(self._capabilities.max_feed_rate, 600.0)
        feed_rot = min(self._capabilities.max_feed_rate, 600.0)

        for step in steps:
            lines.append(f"G1 X{step['push']:.3f} F{feed_push:.3f}")
            lines.append(f"G1 Y{step['angle']:.3f} F{feed_bend:.3f}")
            lines.append(f"G1 Y0.000 F{feed_bend:.3f}")
            if abs(step["rotation"]) > 0.0001:
                lines.append("G91")
                lines.append(f"G1 Z{step['rotation']:.3f} F{feed_rot:.3f}")
                lines.append("G90")

        lines.append("M400")
        return lines
