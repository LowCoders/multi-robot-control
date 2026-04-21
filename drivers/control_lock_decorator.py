"""
Control lock decorator for host/panel ownership.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional

try:
    from base import DeviceDriver, DeviceCapabilities, DeviceState, DeviceStatus, Position
except ImportError:
    from .base import DeviceDriver, DeviceCapabilities, DeviceState, DeviceStatus, Position

try:
    from log_config import get_logger
except ImportError:
    from .log_config import get_logger

logger = get_logger(__name__)



class ControlOwner(str, Enum):
    HOST = "host"
    PANEL = "panel"
    NONE = "none"


class ControlLockState(str, Enum):
    GRANTED = "granted"
    REQUESTED = "requested"
    DENIED = "denied"


@dataclass
class ControlState:
    owner: ControlOwner = ControlOwner.NONE
    lock_state: ControlLockState = ControlLockState.GRANTED
    reason: Optional[str] = None
    version: int = 0
    last_changed_by: str = "init"
    requested_owner: Optional[str] = None
    can_take_control: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "owner": self.owner.value,
            "lock_state": self.lock_state.value,
            "reason": self.reason,
            "version": self.version,
            "last_changed_by": self.last_changed_by,
            "requested_owner": self.requested_owner,
            "can_take_control": self.can_take_control,
        }


class ControlLockDecorator(DeviceDriver):
    """
    Decorator that enforces control ownership for host-originated commands.
    """

    def __init__(self, inner: DeviceDriver, supports_panel_controller: bool = False):
        super().__init__(
            device_id=inner.device_id,
            device_name=inner.device_name,
            device_type=inner.device_type,
        )
        self._inner = inner
        self._supports_panel_controller = bool(supports_panel_controller)
        self._control = ControlState()
        self._sync_from_inner()
        self._wire_inner_callbacks()

    def _sync_from_inner(self) -> None:
        self._connected = self._inner.is_connected
        self._status = self._inner._status
        self._capabilities = self._inner._capabilities

    def _wire_inner_callbacks(self) -> None:
        self._inner.on_state_change = self._forward_state_change
        self._inner.on_position_update = self._forward_position_update
        self._inner.on_error = self._forward_error
        self._inner.on_job_complete = self._forward_job_complete
        self._inner.on_job_progress = self._forward_job_progress

    def _forward_state_change(self, old_state: DeviceState, new_state: DeviceState) -> None:
        self._status.state = new_state
        if self.on_state_change:
            self.on_state_change(old_state, new_state)

    def _forward_position_update(self, pos: Position) -> None:
        if self.on_position_update:
            self.on_position_update(pos)

    def _forward_error(self, message: str) -> None:
        if self.on_error:
            self.on_error(message)

    def _forward_job_complete(self, filename: str) -> None:
        if self.on_job_complete:
            self.on_job_complete(filename)

    def _forward_job_progress(self, progress: float, current_line: int, total_lines: int) -> None:
        if self.on_job_progress:
            self.on_job_progress(progress, current_line, total_lines)

    def _is_program_running(self) -> bool:
        if self._inner.state in (DeviceState.RUNNING, DeviceState.PAUSED):
            return True
        if getattr(self._inner, "_running", False):
            return True
        run_task = getattr(self._inner, "_run_task", None)
        if run_task is not None and not run_task.done():
            return True
        return False

    def _is_busy(self) -> bool:
        return self._inner.state in (
            DeviceState.RUNNING,
            DeviceState.PAUSED,
            DeviceState.HOMING,
            DeviceState.PROBING,
            DeviceState.JOG,
        )

    def _compute_can_take_control(self) -> bool:
        if not self._supports_panel_controller:
            return False
        if self._control.owner == ControlOwner.HOST:
            return False
        if self._is_busy():
            return False
        return True

    def _refresh_control_state(self) -> None:
        self._control.can_take_control = self._compute_can_take_control()

    def sync_firmware_owner(
        self,
        owner: Optional[str],
        reason: Optional[str] = None,
        version: Optional[int] = None,
        changed_by: str = "firmware_status",
    ) -> Dict[str, Any]:
        owner_value = (owner or "none").strip().lower()
        if owner_value == ControlOwner.HOST.value:
            mapped_owner = ControlOwner.HOST
        elif owner_value == ControlOwner.PANEL.value:
            mapped_owner = ControlOwner.PANEL
        else:
            mapped_owner = ControlOwner.NONE

        self._control.owner = mapped_owner
        self._control.lock_state = ControlLockState.GRANTED
        self._control.reason = (reason or "").strip().lower() or None
        self._control.requested_owner = mapped_owner.value
        self._control.last_changed_by = changed_by
        if version is not None:
            self._control.version = max(0, int(version))
        else:
            self._control.version += 1
        self._refresh_control_state()
        return self._control.to_dict()

    def _sync_owner_from_inner(self) -> None:
        owner_getter = getattr(self._inner, "get_control_owner", None)
        if not callable(owner_getter):
            return
        reason_getter = getattr(self._inner, "get_control_owner_reason", None)
        version_getter = getattr(self._inner, "get_control_owner_version", None)
        owner = owner_getter()
        reason = reason_getter() if callable(reason_getter) else ""
        version = version_getter() if callable(version_getter) else None
        self.sync_firmware_owner(owner=owner, reason=reason, version=version)

    def _set_owner(self, owner: ControlOwner, changed_by: str) -> Dict[str, Any]:
        self._control.owner = owner
        self._control.lock_state = ControlLockState.GRANTED
        self._control.reason = None
        self._control.requested_owner = owner.value
        self._control.last_changed_by = changed_by
        self._control.version += 1
        self._refresh_control_state()
        return {"granted": True, "state": self._control.to_dict()}

    def get_control_state(self) -> Dict[str, Any]:
        self._sync_owner_from_inner()
        self._refresh_control_state()
        return self._control.to_dict()

    def get_control_owner(self) -> str:
        self._sync_owner_from_inner()
        return self._control.owner.value

    def get_control_owner_reason(self) -> str:
        self._sync_owner_from_inner()
        return self._control.reason or ""

    def get_control_owner_version(self) -> int:
        self._sync_owner_from_inner()
        return int(self._control.version)

    def request_control(self, requested_owner: str, requested_by: str = "host_request") -> Dict[str, Any]:
        owner = (requested_owner or "").strip().lower()
        self._control.requested_owner = owner or None
        self._control.last_changed_by = requested_by

        if owner not in (ControlOwner.HOST.value, ControlOwner.PANEL.value):
            self._control.lock_state = ControlLockState.DENIED
            self._control.reason = "invalid_owner"
            self._refresh_control_state()
            return {"granted": False, "reason": self._control.reason, "state": self._control.to_dict()}

        if owner == ControlOwner.PANEL.value and not self._supports_panel_controller:
            self._control.lock_state = ControlLockState.DENIED
            self._control.reason = "panel_not_supported"
            self._refresh_control_state()
            return {"granted": False, "reason": self._control.reason, "state": self._control.to_dict()}

        if self._is_program_running():
            self._control.lock_state = ControlLockState.DENIED
            self._control.reason = "command_running"
            self._refresh_control_state()
            return {"granted": False, "reason": self._control.reason, "state": self._control.to_dict()}

        target_owner = ControlOwner.HOST if owner == ControlOwner.HOST.value else ControlOwner.PANEL
        if self._control.owner == target_owner:
            self._control.lock_state = ControlLockState.GRANTED
            self._control.reason = None
            self._refresh_control_state()
            return {"granted": True, "state": self._control.to_dict()}

        return self._set_owner(target_owner, requested_by)

    def release_control(self, requested_by: str = "release") -> Dict[str, Any]:
        self._control.requested_owner = ControlOwner.NONE.value
        return self._set_owner(ControlOwner.NONE, requested_by)

    def reload_machine_config(self, driver_cfg: Dict[str, Any]) -> Dict[str, Any]:
        self._supports_panel_controller = bool(driver_cfg.get("supports_panel_controller", False))
        self._refresh_control_state()
        return {
            "supports_panel_controller": self._supports_panel_controller,
            "control": self._control.to_dict(),
        }

    def _is_locked_for_host(self) -> bool:
        if not self._supports_panel_controller:
            return False
        return self._control.owner == ControlOwner.PANEL

    def _host_command_allowed(self) -> bool:
        self._sync_owner_from_inner()
        return not self._is_locked_for_host()

    async def connect(self) -> bool:
        result = await self._inner.connect()
        self._sync_from_inner()
        self._sync_owner_from_inner()
        self._refresh_control_state()
        return result

    async def disconnect(self) -> None:
        await self._inner.disconnect()
        self._sync_from_inner()
        self._refresh_control_state()

    async def get_status(self) -> DeviceStatus:
        status = await self._inner.get_status()
        self._status = status
        self._sync_owner_from_inner()
        self._refresh_control_state()
        return status

    async def get_capabilities(self) -> DeviceCapabilities:
        caps = await self._inner.get_capabilities()
        caps.supports_panel_controller = self._supports_panel_controller
        self._capabilities = caps
        return caps

    async def home(self, axes: Optional[List[str]] = None) -> bool:
        if not self._host_command_allowed():
            return False
        return await self._inner.home(axes)

    async def jog(self, axis: str, distance: float, feed_rate: float) -> bool:
        if not self._host_command_allowed():
            return False
        return await self._inner.jog(axis, distance, feed_rate)

    async def jog_joint(self, joint_index: Any, delta: float, speed: float) -> bool:
        if not self._host_command_allowed():
            return False
        if hasattr(self._inner, "jog_joint"):
            return await self._inner.jog_joint(joint_index, delta, speed)
        return False

    async def jog_cartesian(self, axis: Any, delta: float, speed: float) -> bool:
        if not self._host_command_allowed():
            return False
        if hasattr(self._inner, "jog_cartesian"):
            return await self._inner.jog_cartesian(axis, delta, speed)
        return False

    async def jog_stop(self) -> bool:
        return await self._inner.jog_stop()

    async def send_gcode(self, gcode: str) -> str:
        if not self._host_command_allowed():
            return "error: control locked by panel"
        return await self._inner.send_gcode(gcode)

    async def load_file(self, filepath: str) -> bool:
        if not self._host_command_allowed():
            return False
        return await self._inner.load_file(filepath)

    async def run(self, from_line: int = 0) -> bool:
        if not self._host_command_allowed():
            return False
        return await self._inner.run(from_line)

    async def pause(self) -> bool:
        return await self._inner.pause()

    async def resume(self) -> bool:
        if not self._host_command_allowed():
            return False
        return await self._inner.resume()

    async def stop(self) -> bool:
        return await self._inner.stop()

    async def reset(self) -> bool:
        return await self._inner.reset()

    async def set_feed_override(self, percent: float) -> bool:
        return await self._inner.set_feed_override(percent)

    async def set_spindle_override(self, percent: float) -> bool:
        return await self._inner.set_spindle_override(percent)

    async def set_laser_power(self, percent: float) -> bool:
        return await self._inner.set_laser_power(percent)

    async def spindle_on(self, speed: float, clockwise: bool = True) -> bool:
        return await self._inner.spindle_on(speed, clockwise)

    async def spindle_off(self) -> bool:
        return await self._inner.spindle_off()

    async def coolant_on(self, flood: bool = True, mist: bool = False) -> bool:
        return await self._inner.coolant_on(flood, mist)

    async def coolant_off(self) -> bool:
        return await self._inner.coolant_off()

    async def start_jog_session(
        self,
        axis: str,
        direction: float,
        feed_rate: float,
        heartbeat_timeout: float = 0.5,
        tick_ms: int = 40,
        mode: Optional[str] = None,
    ) -> bool:
        if not self._host_command_allowed():
            return False
        return await self._inner.start_jog_session(
            axis=axis,
            direction=direction,
            feed_rate=feed_rate,
            heartbeat_timeout=heartbeat_timeout,
            tick_ms=tick_ms,
            mode=mode,
        )

    async def update_jog_session(
        self,
        axis: Optional[str] = None,
        direction: Optional[float] = None,
        feed_rate: Optional[float] = None,
        mode: Optional[str] = None,
    ) -> bool:
        if not self._host_command_allowed():
            return False
        return await self._inner.update_jog_session(
            axis=axis,
            direction=direction,
            feed_rate=feed_rate,
            mode=mode,
        )

    async def stop_jog_session(self, hard_stop: bool = False) -> bool:
        return await self._inner.stop_jog_session(hard_stop=hard_stop)

    async def hard_jog_stop(self) -> bool:
        return await self._inner.hard_jog_stop()

    async def send_realtime_command(self, command: int) -> bool:
        return await self._inner.send_realtime_command(command)

    async def get_grbl_settings(self) -> Dict[int, float]:
        if hasattr(self._inner, "get_grbl_settings"):
            return await self._inner.get_grbl_settings()
        return {}

    async def set_grbl_setting(self, setting: int, value) -> bool:
        if not self._host_command_allowed():
            return False
        if hasattr(self._inner, "set_grbl_setting"):
            return await self._inner.set_grbl_setting(setting, value)
        return False

    def get_info(self) -> Dict[str, Any]:
        info = self._inner.get_info()
        info["control"] = self.get_control_state()
        return info

    def __getattr__(self, item: str) -> Any:
        return getattr(self._inner, item)

