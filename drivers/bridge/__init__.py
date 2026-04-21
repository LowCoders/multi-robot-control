"""Bridge package — FastAPI app + DeviceManager + routerek."""

from .app import app  # noqa: F401 — public entrypoint (uvicorn bridge.app:app)
from .state import device_manager  # noqa: F401 — testek és fejlesztői scriptek

__all__ = ["app", "device_manager"]
