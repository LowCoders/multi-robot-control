"""
Base Device Driver Tests
Multi-Robot Control System
"""

import pytest
from dataclasses import dataclass
from typing import Optional, List

from base import (
    DeviceType,
    DeviceState,
    Position,
    DeviceCapabilities,
    DeviceStatus,
    DeviceDriver,
)


class TestPosition:
    """Position dataclass tests"""

    def test_default_values(self):
        pos = Position()
        assert pos.x == 0.0
        assert pos.y == 0.0
        assert pos.z == 0.0
        assert pos.a == 0.0
        assert pos.b == 0.0
        assert pos.c == 0.0

    def test_custom_values(self):
        pos = Position(x=10.5, y=20.3, z=5.0)
        assert pos.x == 10.5
        assert pos.y == 20.3
        assert pos.z == 5.0

    def test_to_dict(self):
        pos = Position(x=100, y=200, z=50)
        d = pos.to_dict()
        assert d["x"] == 100
        assert d["y"] == 200
        assert d["z"] == 50
        assert "a" in d
        assert "b" in d
        assert "c" in d

    def test_from_dict(self):
        data = {"x": 10.0, "y": 20.0, "z": 30.0}
        pos = Position.from_dict(data)
        assert pos.x == 10.0
        assert pos.y == 20.0
        assert pos.z == 30.0

    def test_from_dict_partial(self):
        data = {"x": 10.0}
        pos = Position.from_dict(data)
        assert pos.x == 10.0
        assert pos.y == 0.0
        assert pos.z == 0.0

    def test_from_dict_empty(self):
        pos = Position.from_dict({})
        assert pos.x == 0.0
        assert pos.y == 0.0
        assert pos.z == 0.0


class TestDeviceCapabilities:
    """DeviceCapabilities dataclass tests"""

    def test_default_values(self):
        caps = DeviceCapabilities()
        assert caps.axes == ["X", "Y", "Z"]
        assert caps.has_spindle is False
        assert caps.has_laser is False
        assert caps.max_feed_rate == 1000.0

    def test_custom_values(self):
        caps = DeviceCapabilities(
            axes=["X", "Y", "Z", "A"],
            has_spindle=True,
            has_laser=True,
            max_feed_rate=5000.0,
            max_spindle_speed=24000.0,
        )
        assert len(caps.axes) == 4
        assert caps.has_spindle is True
        assert caps.has_laser is True
        assert caps.max_feed_rate == 5000.0
        assert caps.max_spindle_speed == 24000.0

    def test_to_dict(self):
        caps = DeviceCapabilities(has_probe=True)
        d = caps.to_dict()
        assert d["has_probe"] is True
        assert "axes" in d
        assert "work_envelope" in d


class TestDeviceStatus:
    """DeviceStatus dataclass tests"""

    def test_default_values(self):
        status = DeviceStatus()
        assert status.state == DeviceState.DISCONNECTED
        assert status.position.x == 0.0
        assert status.feed_rate == 0.0
        assert status.progress == 0.0
        assert status.current_file is None
        assert status.error_message is None

    def test_custom_state(self):
        status = DeviceStatus(state=DeviceState.RUNNING)
        assert status.state == DeviceState.RUNNING

    def test_to_dict(self):
        status = DeviceStatus(
            state=DeviceState.IDLE,
            feed_rate=1000.0,
            progress=50.0,
        )
        d = status.to_dict()
        assert d["state"] == "idle"
        assert d["feed_rate"] == 1000.0
        assert d["progress"] == 50.0
        assert "position" in d
        assert "work_position" in d


class TestDeviceType:
    """DeviceType enum tests"""

    def test_cnc_mill_value(self):
        assert DeviceType.CNC_MILL.value == "cnc_mill"

    def test_laser_cutter_value(self):
        assert DeviceType.LASER_CUTTER.value == "laser_cutter"

    def test_all_types_exist(self):
        types = [
            DeviceType.CNC_MILL,
            DeviceType.CNC_LATHE,
            DeviceType.LASER_CUTTER,
            DeviceType.LASER_ENGRAVER,
            DeviceType.PRINTER_3D,
            DeviceType.ROBOT_ARM,
            DeviceType.CONVEYOR,
            DeviceType.ROTARY_TABLE,
            DeviceType.CUSTOM,
        ]
        assert len(types) == 9


class TestDeviceState:
    """DeviceState enum tests"""

    def test_all_states_exist(self):
        states = [
            DeviceState.DISCONNECTED,
            DeviceState.CONNECTING,
            DeviceState.IDLE,
            DeviceState.RUNNING,
            DeviceState.PAUSED,
            DeviceState.ALARM,
            DeviceState.HOMING,
            DeviceState.PROBING,
            DeviceState.JOG,
        ]
        assert len(states) == 9

    def test_state_values(self):
        assert DeviceState.IDLE.value == "idle"
        assert DeviceState.RUNNING.value == "running"
        assert DeviceState.ALARM.value == "alarm"


# Concrete implementation of DeviceDriver for testing
class MockDeviceDriver(DeviceDriver):
    """Mock implementation of DeviceDriver for testing"""

    def __init__(self, device_id: str, device_name: str):
        super().__init__(device_id, device_name, DeviceType.CUSTOM)
        self._connect_result = True
        self._home_result = True
        self._jog_result = True
        self._gcode_response = "ok"

    async def connect(self) -> bool:
        if self._connect_result:
            self._connected = True
            self._set_state(DeviceState.IDLE)
        return self._connect_result

    async def disconnect(self) -> None:
        self._connected = False
        self._set_state(DeviceState.DISCONNECTED)

    async def get_status(self) -> DeviceStatus:
        return self._status

    async def get_capabilities(self) -> DeviceCapabilities:
        return self._capabilities

    async def home(self, axes: Optional[List[str]] = None) -> bool:
        if self._home_result:
            self._set_state(DeviceState.HOMING)
            self._set_state(DeviceState.IDLE)
        return self._home_result

    async def jog(self, axis: str, distance: float, feed_rate: float) -> bool:
        return self._jog_result

    async def jog_stop(self) -> bool:
        return True

    async def send_gcode(self, gcode: str) -> str:
        return self._gcode_response

    async def load_file(self, filepath: str) -> bool:
        self._status.current_file = filepath
        return True

    async def run(self, from_line: int = 0) -> bool:
        self._set_state(DeviceState.RUNNING)
        return True

    async def pause(self) -> bool:
        self._set_state(DeviceState.PAUSED)
        return True

    async def resume(self) -> bool:
        self._set_state(DeviceState.RUNNING)
        return True

    async def stop(self) -> bool:
        self._set_state(DeviceState.IDLE)
        return True

    async def reset(self) -> bool:
        self._status.error_message = None
        self._set_state(DeviceState.IDLE)
        return True


class TestDeviceDriver:
    """DeviceDriver abstract class tests"""

    def test_initialization(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        assert driver.device_id == "test-1"
        assert driver.device_name == "Test Device"
        assert driver.device_type == DeviceType.CUSTOM
        assert driver.is_connected is False

    def test_initial_state(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        assert driver.state == DeviceState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_connect(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        result = await driver.connect()
        assert result is True
        assert driver.is_connected is True
        assert driver.state == DeviceState.IDLE

    @pytest.mark.asyncio
    async def test_disconnect(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        await driver.disconnect()
        assert driver.is_connected is False
        assert driver.state == DeviceState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_connect_failure(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        driver._connect_result = False
        result = await driver.connect()
        assert result is False
        assert driver.is_connected is False

    @pytest.mark.asyncio
    async def test_get_status(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        status = await driver.get_status()
        assert status.state == DeviceState.IDLE

    @pytest.mark.asyncio
    async def test_home(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        result = await driver.home()
        assert result is True

    @pytest.mark.asyncio
    async def test_jog(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        result = await driver.jog("X", 10.0, 1000.0)
        assert result is True

    @pytest.mark.asyncio
    async def test_send_gcode(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        response = await driver.send_gcode("G0 X0 Y0")
        assert response == "ok"

    @pytest.mark.asyncio
    async def test_load_file(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        result = await driver.load_file("/path/to/test.nc")
        assert result is True
        status = await driver.get_status()
        assert status.current_file == "/path/to/test.nc"

    @pytest.mark.asyncio
    async def test_run(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        result = await driver.run()
        assert result is True
        assert driver.state == DeviceState.RUNNING

    @pytest.mark.asyncio
    async def test_pause(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        await driver.run()
        result = await driver.pause()
        assert result is True
        assert driver.state == DeviceState.PAUSED

    @pytest.mark.asyncio
    async def test_resume(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        await driver.run()
        await driver.pause()
        result = await driver.resume()
        assert result is True
        assert driver.state == DeviceState.RUNNING

    @pytest.mark.asyncio
    async def test_stop(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        await driver.run()
        result = await driver.stop()
        assert result is True
        assert driver.state == DeviceState.IDLE

    def test_state_change_callback(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        callback_called = False
        old_state_received = None
        new_state_received = None

        def on_state_change(old_state, new_state):
            nonlocal callback_called, old_state_received, new_state_received
            callback_called = True
            old_state_received = old_state
            new_state_received = new_state

        driver.on_state_change = on_state_change
        driver._set_state(DeviceState.IDLE)

        assert callback_called is True
        assert old_state_received == DeviceState.DISCONNECTED
        assert new_state_received == DeviceState.IDLE

    def test_state_change_callback_not_called_for_same_state(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        driver._set_state(DeviceState.IDLE)

        callback_count = 0

        def on_state_change(old_state, new_state):
            nonlocal callback_count
            callback_count += 1

        driver.on_state_change = on_state_change
        driver._set_state(DeviceState.IDLE)  # Same state

        assert callback_count == 0

    def test_error_callback(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        error_received = None

        def on_error(message):
            nonlocal error_received
            error_received = message

        driver.on_error = on_error
        driver._set_error("Test error message")

        assert error_received == "Test error message"
        assert driver.state == DeviceState.ALARM
        assert driver._status.error_message == "Test error message"

    def test_get_info(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        info = driver.get_info()
        assert info["id"] == "test-1"
        assert info["name"] == "Test Device"
        assert info["type"] == "custom"
        assert info["connected"] is False
        assert info["state"] == "disconnected"

    @pytest.mark.asyncio
    async def test_get_capabilities(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        caps = await driver.get_capabilities()
        assert caps.axes == ["X", "Y", "Z"]

    @pytest.mark.asyncio
    async def test_reset(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()
        driver._set_error("Test error")
        assert driver.state == DeviceState.ALARM

        result = await driver.reset()
        assert result is True
        assert driver.state == DeviceState.IDLE
        assert driver._status.error_message is None

    @pytest.mark.asyncio
    async def test_optional_methods_return_false_by_default(self):
        driver = MockDeviceDriver("test-1", "Test Device")
        await driver.connect()

        assert await driver.set_feed_override(100) is False
        assert await driver.set_spindle_override(100) is False
        assert await driver.set_laser_power(50) is False
        assert await driver.spindle_on(1000) is False
        assert await driver.spindle_off() is False
        assert await driver.coolant_on() is False
        assert await driver.coolant_off() is False
        assert await driver.probe("Z", -1, 100) is None
        assert await driver.set_work_offset("G54") is False
