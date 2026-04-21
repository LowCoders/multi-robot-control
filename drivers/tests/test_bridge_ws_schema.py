"""WebSocket bejövő üzenetek Pydantic validációja."""

import pytest
from pydantic import TypeAdapter, ValidationError

from api_models import WsIncoming

_adapter = TypeAdapter(WsIncoming)


def test_jog_missing_device_id_raises():
    with pytest.raises(ValidationError):
        _adapter.validate_python({"type": "jog"})


def test_jog_valid():
    msg = _adapter.validate_python({"type": "jog", "device_id": "d1", "axis": "Y"})
    assert msg.type == "jog"
    assert msg.device_id == "d1"
    assert msg.axis == "Y"


def test_command_valid():
    msg = _adapter.validate_python({"type": "command", "device_id": "d1", "command": "run"})
    assert msg.command == "run"


def test_unknown_type_raises():
    with pytest.raises(ValidationError):
        _adapter.validate_python({"type": "not_a_real_type", "device_id": "x"})
