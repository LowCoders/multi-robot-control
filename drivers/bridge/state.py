"""
Bridge globális állapot.

Itt élnek a teljes process-ben megosztott objektumok (DeviceManager singleton,
aktív tesztek leállítási flagjei és progress logok). Külön modulban tartjuk,
hogy minden router (devices, control, motion, ...) ugyanarra a példányra
hivatkozhasson körkörös import nélkül.
"""

from __future__ import annotations

import threading
from typing import Dict

from .manager import DeviceManager
from .helpers import (  # noqa: F401 — re-export kompatibilitás miatt
    RT_OWN_CLAIM_HOST,
    RT_OWN_REQUEST_PANEL,
    RT_OWN_RELEASE,
    RT_OWN_QUERY,
)

# Singleton DeviceManager — minden router és lifespan ezt használja.
device_manager: DeviceManager = DeviceManager()

# Aktív tesztek leállítási jelzői (device_id -> threading.Event)
active_test_events: Dict[str, threading.Event] = {}

# Aktív tesztek progress logok (device_id -> list[dict])
active_test_progress: Dict[str, list] = {}
