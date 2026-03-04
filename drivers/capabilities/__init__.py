"""
Device Capabilities - Mixin osztályok különböző képességekhez
Multi-Robot Control System

Capability pattern implementáció:
- ClosedLoopCapability: Stall detection alapú kalibráció
- TeachingCapability: Pozíciók rögzítése és lejátszása
"""

from .closed_loop import ClosedLoopCapability
from .teaching import TeachingCapability

__all__ = ['ClosedLoopCapability', 'TeachingCapability']
