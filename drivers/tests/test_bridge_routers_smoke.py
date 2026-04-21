"""Minimális HTTP smoke: motion router + mockolt device_manager."""

from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from bridge.routers.motion import router as motion_router


def test_jog_unknown_device_returns_404():
    app = FastAPI()
    app.include_router(motion_router)
    with patch("bridge.dependencies.device_manager.get_device", return_value=None):
        client = TestClient(app)
        res = client.post(
            "/devices/ghost/jog",
            json={"axis": "X", "distance": 1.0, "feed_rate": 100.0},
        )
        assert res.status_code == 404
