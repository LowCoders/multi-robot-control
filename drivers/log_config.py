"""
Egységesített logging konfiguráció a Python bridge-hez és a driverekhez.

A szintet a BRIDGE_LOG_LEVEL környezeti változó határozza meg, amennyiben
nincs megadva, a globális LOG_LEVEL-t használja, alapértelmezett: 'INFO'.

Használat:
    from log_config import setup_logging, get_logger

    setup_logging()  # bridge_server.py startup elején, EGYSZER hívni
    logger = get_logger(__name__)
    logger.info("Bridge started")
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Optional

_LEVEL_MAP = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARN": logging.WARNING,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
}

_DEFAULT_FORMAT = "%(asctime)s [%(levelname)s] [%(name)s] %(message)s"
_DATE_FORMAT = "%Y-%m-%dT%H:%M:%S"

_initialized = False


def _resolve_level() -> int:
    raw = (
        os.environ.get("BRIDGE_LOG_LEVEL")
        or os.environ.get("LOG_LEVEL")
        or "INFO"
    ).upper().strip()
    return _LEVEL_MAP.get(raw, logging.INFO)


def setup_logging(level: Optional[int] = None) -> int:
    """
    Konfigurálja a root logger-t és az uvicorn/fastapi logger-eket.

    Idempotens: ismételt hívás nem ad hozzá újabb handler-t.
    Returns:
        A beállított log level (logging.* konstans).
    """
    global _initialized

    resolved_level = level if level is not None else _resolve_level()

    root = logging.getLogger()

    if not _initialized:
        # Eltávolítjuk a default handlereket, hogy ne duplikáljuk a kimenetet
        for h in list(root.handlers):
            root.removeHandler(h)

        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(_DEFAULT_FORMAT, datefmt=_DATE_FORMAT))
        root.addHandler(handler)
        _initialized = True

    root.setLevel(resolved_level)

    # Uvicorn/FastAPI logger-ek ráhangolása ugyanarra a szintre,
    # hogy konzisztens képet kapjunk.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        lg = logging.getLogger(name)
        lg.setLevel(resolved_level)
        # propagate=True hagyjuk, hogy a root handler kezelje a kimenetet
        lg.handlers.clear()
        lg.propagate = True

    return resolved_level


def get_logger(name: str) -> logging.Logger:
    """
    Modul-szintű logger lekérdezése. Tipikus használat:
        logger = get_logger(__name__)
    """
    return logging.getLogger(name)
