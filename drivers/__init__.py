# Multi-Robot Control System - Device Drivers
"""
Device driver modul a különböző CNC vezérlőkhöz.

Támogatott driverek:
- LinuxCNC: linuxcnc_driver.LinuxCNCDevice
- GRBL: grbl_driver.GrblDevice
- Robot Arm: robot_arm_driver.RobotArmDevice

Hierarchia:
- DeviceDriver (abstract base)
  └── JogSafeDeviceDriver
      └── SerialDeviceBase (közös serial kommunikáció)
          └── GrblDeviceBase (GRBL protokoll)
              ├── GrblDevice
              └── RobotArmDevice (+ ClosedLoopCapability, TeachingCapability)

Használat:
    from drivers import LinuxCNCDevice, GrblDevice, RobotArmDevice
    from drivers.base import DeviceState, DeviceStatus
"""

from .base import (
    DeviceType,
    DeviceState,
    DeviceCapabilities,
    DeviceStatus,
    DeviceDriver,
    JogSafeDeviceDriver,
    Position,
)
from .serial_base import SerialDeviceBase
from .grbl_base import GrblDeviceBase, GrblState, GrblSettings
from .grbl_driver import GrblDevice
from .linuxcnc_driver import LinuxCNCDevice
from .robot_arm_driver import RobotArmDevice, ControlMode
from .capabilities import ClosedLoopCapability, TeachingCapability

__all__ = [
    # Base classes
    "DeviceType",
    "DeviceState", 
    "DeviceCapabilities",
    "DeviceStatus",
    "DeviceDriver",
    "JogSafeDeviceDriver",
    "Position",
    # Serial/GRBL base
    "SerialDeviceBase",
    "GrblDeviceBase",
    "GrblState",
    "GrblSettings",
    # Drivers
    "GrblDevice",
    "LinuxCNCDevice",
    "RobotArmDevice",
    "ControlMode",
    # Capabilities
    "ClosedLoopCapability",
    "TeachingCapability",
]
