"""
bridge_server – kompatibilitási shim.

A Python bridge logikája a `bridge/` package-ben él (`app.py`, `state.py`,
`manager.py`, `helpers.py`, `routers/*.py`). Ez a fájl már csak egy
visszafelé kompatibilis belépési pont, hogy a meglévő scriptek
(`uvicorn bridge_server:app`, `from bridge_server import app`)
módosítás nélkül működjenek.

Új kódból kérlek közvetlenül a `bridge.app:app`-ot importáld.
"""

from __future__ import annotations

from bridge.app import app  # noqa: F401 — public entrypoint
from bridge.state import device_manager  # noqa: F401 — backward compat


def main() -> None:
    """Bridge szerver indítása helyi fejlesztéshez."""
    import os
    import uvicorn
    
    from log_config import get_logger
    
    logger = get_logger(__name__)
    host = os.environ.get("BRIDGE_HOST", "0.0.0.0")
    port = int(os.environ.get("BRIDGE_PORT", "4002"))
    logger.info(f"Bridge szerver indítása: http://{host}:{port}")
    uvicorn.run("bridge.app:app", host=host, port=port)


__all__ = ["app", "device_manager", "main"]


if __name__ == "__main__":
    main()
