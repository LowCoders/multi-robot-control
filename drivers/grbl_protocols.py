"""
GRBL protocol adapters.

Provides version-specific command strategies so the driver can keep one
high-level flow while handling GRBL 0.9x and 1.1+ differences.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple


def _parse_version(version: Optional[str]) -> Tuple[int, int]:
    """
    Parse a GRBL version string into (major, minor).

    Supported examples:
    - "1.1h" -> (1, 1)
    - "0.9i" -> (0, 9)
    - None / unknown -> (0, 0)
    """
    if not version:
        return (0, 0)

    raw = version.strip().lower()
    parts = raw.split(".")
    if len(parts) < 2:
        return (0, 0)

    try:


        major = int(parts[0])
    except ValueError:
        return (0, 0)

    minor_digits = ""
    for ch in parts[1]:
        if ch.isdigit():
            minor_digits += ch
        else:
            break

    if not minor_digits:
        return (0, 0)

    return (major, int(minor_digits))


@dataclass(frozen=True)
class GrblProtocol:
    """Base protocol strategy for GRBL motion commands."""

    name: str

    def build_jog_commands(self, axis: str, distance: float, feed_rate: float) -> List[str]:
        raise NotImplementedError()

    @property
    def supports_streaming_jog(self) -> bool:
        return False


@dataclass(frozen=True)
class GrblV11Protocol(GrblProtocol):
    """GRBL 1.1+ protocol ($J streaming jog)."""

    name: str = "grbl_v11"

    def build_jog_commands(self, axis: str, distance: float, feed_rate: float) -> List[str]:
        return [f"$J=G91 {axis}{distance:.3f} F{feed_rate:.0f}"]

    @property
    def supports_streaming_jog(self) -> bool:
        return True


@dataclass(frozen=True)
class GrblV09Protocol(GrblProtocol):
    """GRBL 0.9x-compatible protocol (relative G1 fallback)."""

    name: str = "grbl_v09"

    def build_jog_commands(self, axis: str, distance: float, feed_rate: float) -> List[str]:
        # GRBL 0.9 does not support $J, so we emulate jog via relative move.
        return [
            "G91",
            f"G1 {axis}{distance:.3f} F{feed_rate:.0f}",
            "G90",
        ]


def resolve_grbl_protocol(version: Optional[str]) -> GrblProtocol:
    """
    Resolve protocol by firmware version.

    Rules:
    - 1.1+ -> streaming jog protocol
    - 0.9x / unknown older -> fallback relative move protocol
    """
    major, minor = _parse_version(version)
    if major > 1 or (major == 1 and minor >= 1):
        return GrblV11Protocol()
    return GrblV09Protocol()
