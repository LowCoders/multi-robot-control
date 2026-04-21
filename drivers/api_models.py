"""
Központi API modellek a Python bridge-hez.

Az itt definiált Pydantic modellek a HTTP réteg request/response sémái.
A FastAPI ezekből generálja az OpenAPI schemát (`/openapi.json`), amelyből
a `scripts/generate-api-types.sh` TypeScript típusokat csinál a backend és
a frontend számára.

Az igazság forrása az eszköz-szintű állapotnak továbbra is a `base.py`-beli
dataclassek (`DeviceStatus`, `DeviceCapabilities`, `Position`); ezek a
modellek csak a "hálózati alak"-ot rögzítik, nem új source of truth.

NE szerkeszd a request modelleket úgy, hogy közben a bridge_server.py
megmaradt másolatait is változtatnád — a bridge_server csak importálja
őket innen, hogy egy helyen legyen a definíció.
"""

from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel


# =========================================
# DEVICE / KONFIGURÁCIÓ
# =========================================


class DeviceConfig(BaseModel):
    """Eszköz konfiguráció (devices.yaml egy bejegyzése)."""

    id: str
    name: str
    driver: str  # "grbl" | "linuxcnc" | "robot_arm" | "tube_bender" | "simulated"
    type: str
    enabled: bool = True
    simulated: bool = True
    config: Dict[str, Any] = {}


# =========================================
# JOG
# =========================================


class JogRequest(BaseModel):
    """Egyszeri jog mozgás (relatív elmozdulás)."""

    axis: str
    distance: float
    feed_rate: float
    mode: Optional[str] = None  # 'jog' | 'joint' | 'cartesian' (robot arm)


class JogSessionStartRequest(BaseModel):
    """Folyamatos jog session indítása (heartbeat-alapú)."""

    axis: str
    direction: float
    feed_rate: float
    mode: Optional[str] = None
    heartbeat_timeout: float = 0.5
    tick_ms: int = 40


class JogSessionBeatRequest(BaseModel):
    """Heartbeat üzenet egy aktív jog session-höz."""

    axis: Optional[str] = None
    direction: Optional[float] = None
    feed_rate: Optional[float] = None
    mode: Optional[str] = None


class JogSessionStopRequest(BaseModel):
    """Jog session leállítása."""

    hard_stop: bool = False


# =========================================
# G-CODE / FILE / OVERRIDE
# =========================================


class GCodeRequest(BaseModel):
    """Egyetlen G-code parancs küldése."""

    gcode: str


class FileRequest(BaseModel):
    """G-code fájl betöltési kérés (a vezérlőre)."""

    filepath: str


class OverrideRequest(BaseModel):
    """Feed / spindle override beállítás (százalékban)."""

    percent: float


# =========================================
# CONTROL OWNERSHIP (host vs. panel)
# =========================================


class ControlRequest(BaseModel):
    """Ownership váltási kérés ('host' vagy 'panel' a tulajdonos)."""

    requested_owner: str
    requested_by: Optional[str] = None


class ControlReleaseRequest(BaseModel):
    """Aktív control elengedése."""

    requested_by: Optional[str] = None


# =========================================
# HOMING
# =========================================


class HomeRequest(BaseModel):
    """Tengely vagy összes tengely homingolása."""

    axes: Optional[List[str]] = None
    feed_rate: Optional[float] = None


# =========================================
# CALIBRATION (robot arm)
# =========================================


class CalibrateLimitsRequest(BaseModel):
    """Stall-detection alapú végállás kalibráció."""

    speed: float = 300.0
    joints: Optional[List[str]] = None
    stall_timeout: float = 0.3
    stall_tolerance: float = 0.5


class SaveCalibrationRequest(BaseModel):
    """Kalibrált tengely-limitek mentése."""

    j1_limits: Optional[List[float]] = None
    j2_limits: Optional[List[float]] = None
    j3_limits: Optional[List[float]] = None


class SetHomePositionRequest(BaseModel):
    """Home pozíció beállítás (abszolút vagy aktuális mentése)."""

    mode: str = "absolute"  # "absolute" | "query"
    X: Optional[float] = None
    Y: Optional[float] = None
    Z: Optional[float] = None
    save_current: bool = False


# =========================================
# GRBL SETTINGS
# =========================================


class GrblSettingRequest(BaseModel):
    """Egyetlen GRBL beállítás módosítása ($N=value)."""

    setting: int
    value: Union[float, str]


class GrblSettingsBatchRequest(BaseModel):
    """Több GRBL beállítás egyszerre.

    A networking paraméterek (pl. $71 hostname, $73-$76 SSID/jelszó) string
    értékűek a grblHAL-ban; ezért a value típus `Union[float, str]`.
    """

    settings: Dict[int, Union[float, str]]
