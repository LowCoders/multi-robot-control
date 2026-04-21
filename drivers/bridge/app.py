"""
FastAPI alkalmazás belépési pont.

A `app` objektum a `uvicorn` parancsnak adható át (`uvicorn bridge.app:app`
vagy a régi shim útján `uvicorn bridge_server:app`). A logikai endpointok
a `bridge.routers.*` modulokban élnek.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from log_config import setup_logging, get_logger
except ImportError:
    from ..log_config import setup_logging, get_logger

from .state import device_manager
from .routers import register_routers

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Indító + leállító életciklus — devices.yaml betöltés és csatlakozás."""
    config_path = os.environ.get(
        "DEVICES_CONFIG",
        str(Path(__file__).parent.parent.parent / "config" / "devices.yaml"),
    )
    await device_manager.load_config(config_path)
    await device_manager.connect_all()
    yield
    await device_manager.disconnect_all()


app = FastAPI(
    title="Multi-Robot Control System - Device Bridge",
    description="Python bridge server for device communication",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Root endpoint."""
    return {"status": "ok", "service": "device-bridge"}


register_routers(app)


__all__ = ["app"]
