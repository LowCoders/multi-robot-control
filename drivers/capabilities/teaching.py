"""
Teaching Capability - Pozíciók rögzítése és lejátszása
Multi-Robot Control System

Mixin osztály a teaching mód támogatásához.
A host osztálynak rendelkeznie kell:
- _status.position (Position)
- move_to(x, y, z, speed) metódus
- _set_state(state) metódus
- _running flag
- Opcionálisan: gripper_on/off, sucker_on/off
"""

import asyncio
from typing import List, Dict, Any, Optional, TYPE_CHECKING

try:
    from log_config import get_logger
except ImportError:
    from ..log_config import get_logger

logger = get_logger(__name__)

if TYPE_CHECKING:
    try:
        from base import DeviceState, Position
    except ImportError:
        from ..base import DeviceState, Position


class TeachingCapability:
    """
    Mixin osztály teaching módhoz.
    
    Lehetővé teszi pozíciók rögzítését és visszajátszását.
    Robot karok "betanításához" használható.
    
    Használat:
        class MyRobot(GrblDeviceBase, TeachingCapability):
            def __init__(self, ...):
                GrblDeviceBase.__init__(self, ...)
                TeachingCapability.__init__(self)
    """
    
    def __init__(self):
        """Teaching capability inicializálása."""
        self._taught_positions: List[Dict[str, Any]] = []
    
    async def teach_record_position(self) -> Dict[str, Any]:
        """
        Aktuális pozíció rögzítése teaching módhoz.
        
        Returns:
            Dict a rögzített pozícióval és végeffektor állapottal
        """
        pos = {
            "index": len(self._taught_positions),
            "x": self._status.position.x,
            "y": self._status.position.y,
            "z": self._status.position.z,
        }
        
        # Opcionális végeffektor állapotok
        if hasattr(self, '_gripper_state'):
            pos["gripper"] = self._gripper_state
        if hasattr(self, '_sucker_state'):
            pos["sucker"] = self._sucker_state
        
        self._taught_positions.append(pos)
        logger.info(f"🤖 Pozíció rögzítve #{pos['index']}: "
              f"X={pos['x']:.2f} Y={pos['y']:.2f} Z={pos['z']:.2f}")
        return pos
    
    async def teach_play(self, speed: float = 50.0) -> bool:
        """
        Rögzített pozíciók lejátszása.
        
        Args:
            speed: Mozgási sebesség
            
        Returns:
            True ha sikeres
        """
        if not self._taught_positions:
            return False
        
        # Import itt, hogy elkerüljük a körkörös importot
        try:
            from base import DeviceState
        except ImportError:
            from ..base import DeviceState


        
        self._set_state(DeviceState.RUNNING)
        self._running = True
        
        for pos in self._taught_positions:
            if not self._running:
                break
            
            # Pozícióra mozgás
            await self.move_to(pos['x'], pos['y'], pos['z'], speed)
            
            # Végeffektor állapot beállítása (ha támogatott)
            if pos.get("gripper") == "closed" and hasattr(self, 'gripper_on'):
                await self.gripper_on()
            elif pos.get("gripper") == "open" and hasattr(self, 'gripper_off'):
                await self.gripper_off()
            
            if pos.get("sucker") is True and hasattr(self, 'sucker_on'):
                await self.sucker_on()
            elif pos.get("sucker") is False and hasattr(self, 'sucker_off'):
                await self.sucker_off()
            
            await asyncio.sleep(0.5)
        
        self._running = False
        self._set_state(DeviceState.IDLE)
        return True
    
    def teach_clear(self) -> None:
        """Rögzített pozíciók törlése."""
        self._taught_positions.clear()
        logger.info(f"🤖 Tanított pozíciók törölve")
    
    def teach_get_positions(self) -> List[Dict[str, Any]]:
        """
        Rögzített pozíciók lekérdezése.
        
        Returns:
            Lista a rögzített pozíciókkal
        """
        return self._taught_positions.copy()
    
    def teach_get_count(self) -> int:
        """Rögzített pozíciók száma."""
        return len(self._taught_positions)
