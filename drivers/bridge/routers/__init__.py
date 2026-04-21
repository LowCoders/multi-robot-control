"""Bridge router-csomag.

Minden router egy logikai domain endpointjait tartalmazza. A `register_routers`
az `app.py`-ból hívva regisztrálja őket az `app`-on. Ez a szervezés azt teszi
lehetővé, hogy egy-egy 200-300 soros file-ban legyen egy domain (jog,
diagnostics, GRBL settings stb.), nem pedig egy 2400 soros monolit.
"""

from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    """Az összes domain router regisztrálása az adott FastAPI app-on."""
    from . import (
        usb,
        devices,
        control,
        connect,
        motion,
        robot,
        diagnostics,
        grbl,
        ws,
    )

    app.include_router(usb.router)
    app.include_router(devices.router)
    app.include_router(control.router)
    app.include_router(connect.router)
    app.include_router(motion.router)
    app.include_router(robot.router)
    app.include_router(diagnostics.router)
    app.include_router(grbl.router)
    app.include_router(ws.router)


__all__ = ["register_routers"]
