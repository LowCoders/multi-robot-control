"""
GRBL Device Driver Tests
Multi-Robot Control System
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import asyncio

# Conditional import
try:
    from grbl_driver import GrblDevice, GrblSettings, GrblState, SERIAL_AVAILABLE
except ImportError:
    # If serial is not available, create minimal stubs
    SERIAL_AVAILABLE = False
    GrblDevice = None
    GrblSettings = None
    GrblState = None

from base import DeviceState, DeviceType, Position


@pytest.mark.skipif(not SERIAL_AVAILABLE, reason="pyserial not available")
class TestGrblSettings:
    """GrblSettings tests"""

    def test_default_steps_per_mm(self):
        settings = GrblSettings(settings={})
        assert settings.steps_per_mm_x == 250.0
        assert settings.steps_per_mm_y == 250.0
        assert settings.steps_per_mm_z == 250.0

    def test_custom_steps_per_mm(self):
        settings = GrblSettings(settings={100: 800.0, 101: 800.0, 102: 400.0})
        assert settings.steps_per_mm_x == 800.0
        assert settings.steps_per_mm_y == 800.0
        assert settings.steps_per_mm_z == 400.0

    def test_max_rates(self):
        settings = GrblSettings(settings={110: 2000.0, 111: 2000.0, 112: 500.0})
        assert settings.max_rate_x == 2000.0
        assert settings.max_rate_y == 2000.0
        assert settings.max_rate_z == 500.0

    def test_max_travel(self):
        settings = GrblSettings(settings={130: 300.0, 131: 400.0, 132: 100.0})
        assert settings.max_travel_x == 300.0
        assert settings.max_travel_y == 400.0
        assert settings.max_travel_z == 100.0

    def test_laser_mode_off(self):
        settings = GrblSettings(settings={32: 0})
        assert settings.laser_mode is False

    def test_laser_mode_on(self):
        settings = GrblSettings(settings={32: 1})
        assert settings.laser_mode is True


@pytest.mark.skipif(not SERIAL_AVAILABLE, reason="pyserial not available")
class TestGrblState:
    """GrblState enum tests"""

    def test_all_states(self):
        states = [
            GrblState.IDLE,
            GrblState.RUN,
            GrblState.HOLD,
            GrblState.JOG,
            GrblState.ALARM,
            GrblState.DOOR,
            GrblState.CHECK,
            GrblState.HOME,
            GrblState.SLEEP,
        ]
        assert len(states) == 9

    def test_state_values(self):
        assert GrblState.IDLE.value == "Idle"
        assert GrblState.RUN.value == "Run"
        assert GrblState.HOLD.value == "Hold"
        assert GrblState.ALARM.value == "Alarm"


@pytest.mark.skipif(not SERIAL_AVAILABLE, reason="pyserial not available")
class TestGrblDevice:
    """GrblDevice tests"""

    def test_initialization(self):
        device = GrblDevice(
            device_id="laser-1",
            device_name="Laser Cutter",
            port="/dev/ttyUSB0",
            baudrate=115200,
        )
        assert device.device_id == "laser-1"
        assert device.device_name == "Laser Cutter"
        assert device.port == "/dev/ttyUSB0"
        assert device.baudrate == 115200
        assert device.device_type == DeviceType.LASER_CUTTER

    def test_initialization_with_custom_type(self):
        device = GrblDevice(
            device_id="cnc-1",
            device_name="CNC Mill",
            port="/dev/ttyUSB1",
            device_type=DeviceType.CNC_MILL,
        )
        assert device.device_type == DeviceType.CNC_MILL

    def test_status_pattern_matching(self):
        device = GrblDevice(
            device_id="test",
            device_name="Test",
        )
        
        # Test idle state
        response = "<Idle|MPos:10.000,20.000,5.000|WPos:10.000,20.000,5.000>"
        match = device.STATUS_PATTERN.search(response)
        assert match is not None
        assert match.group(1) == "Idle"
        assert match.group(2) == "10.000"
        assert match.group(3) == "20.000"
        assert match.group(4) == "5.000"

    def test_status_pattern_running(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        response = "<Run|MPos:100.500,200.300,50.000>"
        match = device.STATUS_PATTERN.search(response)
        assert match is not None
        assert match.group(1) == "Run"
        assert float(match.group(2)) == 100.500
        assert float(match.group(3)) == 200.300
        assert float(match.group(4)) == 50.000

    def test_status_pattern_alarm(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        response = "<Alarm|MPos:0.000,0.000,0.000>"
        match = device.STATUS_PATTERN.search(response)
        assert match is not None
        assert match.group(1) == "Alarm"

    def test_ok_pattern(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        assert device.OK_PATTERN.match("ok") is not None
        assert device.OK_PATTERN.match("OK") is not None
        assert device.OK_PATTERN.match("error") is None

    def test_error_pattern(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        match = device.ERROR_PATTERN.match("error:22")
        assert match is not None
        assert match.group(1) == "22"

    def test_alarm_pattern(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        match = device.ALARM_PATTERN.match("ALARM:1")
        assert match is not None
        assert match.group(1) == "1"

    def test_setting_pattern(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        match = device.SETTING_PATTERN.match("$100=250.000")
        assert match is not None
        assert match.group(1) == "100"
        assert match.group(2) == "250.000"

    def test_grbl_error_messages(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        assert 1 in device.GRBL_ERRORS
        assert 22 in device.GRBL_ERRORS
        assert "Homing fail" in device.GRBL_ERRORS[22]

    def test_grbl_alarm_messages(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        assert 1 in device.GRBL_ALARMS
        assert "Hard limit" in device.GRBL_ALARMS[1]

    @pytest.mark.asyncio
    async def test_parse_status_idle(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        device._parse_status("<Idle|MPos:10.000,20.000,5.000>")
        
        assert device._grbl_state == GrblState.IDLE
        assert device.state == DeviceState.IDLE
        assert device._status.position.x == 10.0
        assert device._status.position.y == 20.0
        assert device._status.position.z == 5.0

    @pytest.mark.asyncio
    async def test_parse_status_running(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        device._parse_status("<Run|MPos:50.000,100.000,25.000>")
        
        assert device._grbl_state == GrblState.RUN
        assert device.state == DeviceState.RUNNING

    @pytest.mark.asyncio
    async def test_parse_status_hold(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        device._parse_status("<Hold|MPos:50.000,100.000,25.000>")
        
        assert device._grbl_state == GrblState.HOLD
        assert device.state == DeviceState.PAUSED

    @pytest.mark.asyncio
    async def test_parse_status_alarm(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        device._parse_status("<Alarm|MPos:0.000,0.000,0.000>")
        
        assert device._grbl_state == GrblState.ALARM
        assert device.state == DeviceState.ALARM

    @pytest.mark.asyncio
    async def test_parse_status_home(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        device._parse_status("<Home|MPos:0.000,0.000,0.000>")
        
        assert device._grbl_state == GrblState.HOME
        assert device.state == DeviceState.HOMING

    @pytest.mark.asyncio
    async def test_parse_status_with_work_position(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        device._parse_status("<Idle|MPos:10.000,20.000,5.000|WPos:5.000,10.000,2.500>")
        
        assert device._status.position.x == 10.0
        assert device._status.work_position.x == 5.0
        assert device._status.work_position.y == 10.0
        assert device._status.work_position.z == 2.5

    @pytest.mark.asyncio
    async def test_parse_status_invalid(self):
        device = GrblDevice(device_id="test", device_name="Test")
        old_state = device.state
        
        device._parse_status("invalid response")
        
        # State should not change for invalid response
        assert device.state == old_state

    def test_position_callback_on_parse(self):
        device = GrblDevice(device_id="test", device_name="Test")
        
        received_position = None
        
        def on_position_update(pos):
            nonlocal received_position
            received_position = pos
        
        device.on_position_update = on_position_update
        device._parse_status("<Idle|MPos:100.000,200.000,50.000>")
        
        assert received_position is not None
        assert received_position.x == 100.0
        assert received_position.y == 200.0
        assert received_position.z == 50.0


@pytest.mark.skipif(not SERIAL_AVAILABLE, reason="pyserial not available")
class TestGrblDeviceWithMockedSerial:
    """GrblDevice tests with mocked serial port"""

    @pytest.fixture
    def mock_serial(self):
        with patch('grbl_driver.serial.Serial') as mock:
            mock_instance = MagicMock()
            mock_instance.is_open = True
            mock_instance.in_waiting = 0
            mock.return_value = mock_instance
            yield mock_instance

    @pytest.mark.asyncio
    async def test_disconnect(self, mock_serial):
        device = GrblDevice(device_id="test", device_name="Test")
        device._serial = mock_serial
        device._connected = True
        
        await device.disconnect()
        
        mock_serial.close.assert_called_once()
        assert device.is_connected is False
        assert device.state == DeviceState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_jog_x_axis(self, mock_serial):
        device = GrblDevice(device_id="test", device_name="Test")
        device._serial = mock_serial
        device._connected = True
        
        # Setup mock to return ok
        mock_serial.in_waiting = 1
        mock_serial.readline.return_value = b"ok\n"
        
        result = await device.jog("X", 10.0, 1000.0)
        
        # Check command was sent
        mock_serial.write.assert_called()
        call_args = mock_serial.write.call_args[0][0]
        assert b"$J=G91 X10.000 F1000" in call_args

    @pytest.mark.asyncio
    async def test_jog_invalid_axis(self, mock_serial):
        device = GrblDevice(device_id="test", device_name="Test")
        device._serial = mock_serial
        device._connected = True
        
        result = await device.jog("W", 10.0, 1000.0)
        
        assert result is False

    @pytest.mark.asyncio
    async def test_jog_stop(self, mock_serial):
        device = GrblDevice(device_id="test", device_name="Test")
        device._serial = mock_serial
        device._connected = True
        
        result = await device.jog_stop()
        
        mock_serial.write.assert_called_with(b"\x85")
        assert result is True

    @pytest.mark.asyncio
    async def test_pause(self, mock_serial):
        device = GrblDevice(device_id="test", device_name="Test")
        device._serial = mock_serial
        device._connected = True
        device._set_state(DeviceState.RUNNING)
        
        result = await device.pause()
        
        mock_serial.write.assert_called_with(b"!")
        assert result is True
        assert device.state == DeviceState.PAUSED

    @pytest.mark.asyncio
    async def test_resume(self, mock_serial):
        device = GrblDevice(device_id="test", device_name="Test")
        device._serial = mock_serial
        device._connected = True
        device._set_state(DeviceState.PAUSED)
        
        result = await device.resume()
        
        mock_serial.write.assert_called_with(b"~")
        assert result is True
        assert device.state == DeviceState.RUNNING

    @pytest.mark.asyncio
    async def test_stop(self, mock_serial):
        device = GrblDevice(device_id="test", device_name="Test")
        device._serial = mock_serial
        device._connected = True
        device._set_state(DeviceState.RUNNING)
        device._running = True
        
        result = await device.stop()
        
        mock_serial.write.assert_called_with(b"\x18")
        assert result is True
        assert device._running is False
        assert device.state == DeviceState.IDLE

    @pytest.mark.asyncio
    async def test_list_ports(self):
        with patch('grbl_driver.serial.tools.list_ports.comports') as mock_comports:
            mock_port = MagicMock()
            mock_port.device = "/dev/ttyUSB0"
            mock_port.description = "USB Serial"
            mock_port.hwid = "USB VID:PID=1234:5678"
            mock_comports.return_value = [mock_port]
            
            ports = GrblDevice.list_ports()
            
            assert len(ports) == 1
            assert ports[0]["port"] == "/dev/ttyUSB0"
            assert ports[0]["description"] == "USB Serial"


@pytest.mark.skipif(not SERIAL_AVAILABLE, reason="pyserial not available")
class TestGrblDeviceFileOperations:
    """GrblDevice file operation tests"""

    @pytest.fixture
    def device(self):
        return GrblDevice(device_id="test", device_name="Test")

    @pytest.mark.asyncio
    async def test_load_file_success(self, device, tmp_path):
        # Create a temp gcode file
        gcode_file = tmp_path / "test.nc"
        gcode_file.write_text("G0 X0 Y0\nG1 X10 Y10 F1000\nG0 Z5")
        
        result = await device.load_file(str(gcode_file))
        
        assert result is True
        assert device._status.current_file == str(gcode_file)
        assert device._status.total_lines == 3
        assert len(device._gcode_lines) == 3

    @pytest.mark.asyncio
    async def test_load_file_with_comments(self, device, tmp_path):
        # Create a gcode file with comments
        gcode_file = tmp_path / "test.nc"
        gcode_file.write_text("G0 X0 Y0 ; move to origin\nG1 X10 Y10 F1000\n(comment)\nG0 Z5")
        
        result = await device.load_file(str(gcode_file))
        
        assert result is True
        assert len(device._gcode_lines) == 3
        assert ";" not in device._gcode_lines[0]

    @pytest.mark.asyncio
    async def test_load_file_with_empty_lines(self, device, tmp_path):
        # Create a gcode file with empty lines
        gcode_file = tmp_path / "test.nc"
        gcode_file.write_text("G0 X0 Y0\n\n\nG1 X10 Y10 F1000\n")
        
        result = await device.load_file(str(gcode_file))
        
        assert result is True
        assert len(device._gcode_lines) == 2

    @pytest.mark.asyncio
    async def test_load_file_not_found(self, device):
        result = await device.load_file("/nonexistent/path/test.nc")
        
        assert result is False
        assert device.state == DeviceState.ALARM

    @pytest.mark.asyncio
    async def test_run_without_file(self, device):
        result = await device.run()
        
        assert result is False

    @pytest.mark.asyncio
    async def test_run_sets_running_state(self, device, tmp_path):
        gcode_file = tmp_path / "test.nc"
        gcode_file.write_text("G0 X0 Y0")
        
        await device.load_file(str(gcode_file))
        result = await device.run()
        
        assert result is True
        assert device._running is True

    @pytest.mark.asyncio
    async def test_run_from_specific_line(self, device, tmp_path):
        gcode_file = tmp_path / "test.nc"
        gcode_file.write_text("G0 X0 Y0\nG1 X10 Y10\nG0 Z5")
        
        await device.load_file(str(gcode_file))
        result = await device.run(from_line=1)
        
        assert result is True
        assert device._current_line_index == 1
