"""FastAPI Depends(get_device_or_404) viselkedés."""

from unittest.mock import MagicMock, patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from bridge.dependencies import get_device_or_404

app = FastAPI()


@app.get("/t/{device_id}")
async def probe(device=Depends(get_device_or_404)):
    return {"ok": True}


def test_get_device_or_404_returns_404_when_missing():
    with patch("bridge.dependencies.device_manager.get_device", return_value=None):
        client = TestClient(app)
        res = client.get("/t/no-such-device")
        assert res.status_code == 404
        detail = str(res.json().get("detail", "")).lower()
        assert "található" in detail or "not found" in detail


def test_get_device_or_404_returns_device():
    dev = MagicMock()
    with patch("bridge.dependencies.device_manager.get_device", return_value=dev):
        client = TestClient(app)
        res = client.get("/t/cnc-1")
        assert res.status_code == 200
        assert res.json() == {"ok": True}
