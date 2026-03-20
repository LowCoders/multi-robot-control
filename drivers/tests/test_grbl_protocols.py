"""
Tests for GRBL protocol adapter selection and jog command routing.
"""

import pytest

from grbl_driver import GrblDevice
from grbl_protocols import GrblV09Protocol, GrblV11Protocol, resolve_grbl_protocol


def test_resolve_protocol_v11():
    protocol = resolve_grbl_protocol("1.1h")
    assert isinstance(protocol, GrblV11Protocol)
    assert protocol.supports_streaming_jog is True


def test_resolve_protocol_v09():
    protocol = resolve_grbl_protocol("0.9i")
    assert isinstance(protocol, GrblV09Protocol)
    assert protocol.supports_streaming_jog is False


@pytest.mark.asyncio
async def test_grbl_device_jog_uses_v11_streaming_protocol(monkeypatch):
    device = GrblDevice(device_id="laser_1", device_name="Laser")
    device._serial = object()
    device._connected = True
    device._grbl_version = "1.1h"
    device._protocol = resolve_grbl_protocol(device._grbl_version)

    commands = []

    async def fake_send_command(command, timeout=None):  # noqa: ARG001
        commands.append(command)
        return "ok"

    async def fake_get_status():
        return {"state": "Idle"}

    monkeypatch.setattr(device, "_send_command", fake_send_command)
    monkeypatch.setattr(device, "get_grbl_status", fake_get_status)

    result = await device.jog("X", 10.0, 1000.0)
    assert result is True
    assert commands == ["$J=G91 X10.000 F1000"]
    assert device.get_jog_diagnostics()["protocol"] == "grbl_v11"


@pytest.mark.asyncio
async def test_grbl_device_jog_uses_v09_fallback_protocol(monkeypatch):
    device = GrblDevice(device_id="laser_1", device_name="Laser")
    device._serial = object()
    device._connected = True
    device._grbl_version = "0.9i"
    device._protocol = resolve_grbl_protocol(device._grbl_version)

    commands = []

    async def fake_send_command(command, timeout=None):  # noqa: ARG001
        commands.append(command)
        return "ok"

    async def fake_get_status():
        return {"state": "Idle"}

    monkeypatch.setattr(device, "_send_command", fake_send_command)
    monkeypatch.setattr(device, "get_grbl_status", fake_get_status)

    result = await device.jog("Y", -2.5, 800.0)
    assert result is True
    assert commands == ["G91", "G1 Y-2.500 F800", "G90"]
    assert device.get_jog_diagnostics()["protocol"] == "grbl_v09"


@pytest.mark.asyncio
async def test_grbl_device_jog_state_gate(monkeypatch):
    device = GrblDevice(device_id="laser_1", device_name="Laser")
    device._serial = object()
    device._connected = True
    device._grbl_version = "0.9i"
    device._protocol = resolve_grbl_protocol(device._grbl_version)

    async def fake_send_command(command, timeout=None):  # noqa: ARG001
        return "ok"

    async def fake_get_status():
        return {"state": "Alarm"}

    monkeypatch.setattr(device, "_send_command", fake_send_command)
    monkeypatch.setattr(device, "get_grbl_status", fake_get_status)

    result = await device.jog("X", 1.0, 500.0)
    assert result is False
    trace = device.get_jog_diagnostics()["last_jog_trace"]
    assert trace["error"] == "state_blocked"
