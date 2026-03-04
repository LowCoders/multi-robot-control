"""
Closed Loop Capability - Stall detection alapú kalibráció
Multi-Robot Control System

Mixin osztály closed loop motorok kezeléséhez.
A host osztálynak rendelkeznie kell:
- _send_command(cmd) metódus
- get_grbl_status() metódus
- _set_state(state) metódus
- JOINT_TO_GRBL mapping
"""

import asyncio
from typing import Optional, Dict, Any, List


class ClosedLoopCapability:
    """
    Mixin osztály closed loop motorok kezeléséhez.
    
    Stall detection alapú automatikus végállás kalibráció.
    Closed loop servo driverek (pl. SERVO42C) encoder feedback-et
    adnak, így végálláskapcsolók nélkül is detektálható az elakadás.
    
    Használat:
        class MyRobot(GrblDeviceBase, ClosedLoopCapability):
            def __init__(self, ..., closed_loop=None):
                GrblDeviceBase.__init__(self, ...)
                ClosedLoopCapability.__init__(self, closed_loop)
    """
    
    # Joint-GRBL tengely mapping (felülírható a host osztályban)
    JOINT_TO_GRBL = {'J1': 'Z', 'J2': 'X', 'J3': 'Y'}
    
    def __init__(self, closed_loop_config: Dict[str, Any] = None):
        """
        Closed loop capability inicializálása.
        
        Args:
            closed_loop_config: Konfiguráció a devices.yaml-ból
                {
                    'enabled': bool,
                    'driver_type': 'servo' | 'stepper_encoder',
                    'stall_detection': {
                        'timeout': float,
                        'tolerance': float,
                        'speed': float,
                        'max_search_angle': float,
                        'calibrate_joints': ['J2', 'J3'],  # mely tengelyeket kalibrálja
                    }
                }
        """
        self._closed_loop_enabled = False
        self._stall_detection_config = {
            'timeout': 0.3,
            'tolerance': 0.5,
            'speed': 150.0,  # Kisebb sebesség = kisebb erő
            'max_search_angle': 400.0,
            'calibrate_joints': ['J2', 'J3'],  # J1 (bázis) nincs fizikai végállása
        }
        
        # Kalibráció állapot
        self._calibration_status: Dict[str, Any] = {}
        self._calibration_stop_requested: bool = False
        
        if closed_loop_config:
            self._closed_loop_enabled = closed_loop_config.get('enabled', False)
            stall_cfg = closed_loop_config.get('stall_detection', {})
            if stall_cfg:
                self._stall_detection_config['timeout'] = stall_cfg.get('timeout', 0.3)
                self._stall_detection_config['tolerance'] = stall_cfg.get('tolerance', 0.5)
                self._stall_detection_config['speed'] = stall_cfg.get('speed', 150.0)
                self._stall_detection_config['max_search_angle'] = stall_cfg.get('max_search_angle', 400.0)
                self._stall_detection_config['calibrate_joints'] = stall_cfg.get('calibrate_joints', ['J2', 'J3'])
    
    @property
    def is_closed_loop(self) -> bool:
        """Closed loop mód engedélyezett-e."""
        return self._closed_loop_enabled
    
    def get_calibration_status(self) -> Dict[str, Any]:
        """Kalibráció állapot lekérdezése."""
        return self._calibration_status.copy()
    
    def stop_calibration(self) -> None:
        """Kalibráció leállítása."""
        self._calibration_stop_requested = True
    
    async def calibrate_limits(
        self,
        speed: Optional[float] = None,
        joints: Optional[List[str]] = None,
        stall_timeout: Optional[float] = None,
        stall_tolerance: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Automatikus végállás kalibráció stall detection-nel.
        
        A closed loop driverek (pl. SERVO42C) automatikusan érzékelik
        az elakadást, így végálláskapcsolók nélkül is működik.
        
        Args:
            speed: Keresési sebesség (fok/perc)
            joints: Mely tengelyeket kalibrálja (default: ['J1', 'J2', 'J3'])
            stall_timeout: Mennyi ideig várjon pozíció változásra (mp)
            stall_tolerance: Mekkora elmozdulás számít "nem változásnak" (fok)
        
        Returns:
            {
                'completed': True/False,
                'j1_limits': [min, max],
                'j2_limits': [min, max],
                'j3_limits': [min, max],
                'home_position': {'j1': float, 'j2': float, 'j3': float},
                'error': str (ha volt hiba)
            }
        """
        # Import itt, hogy elkerüljük a körkörös importot
        try:
            from base import DeviceState
        except ImportError:
            from ..base import DeviceState
        
        # Default értékek a konfigurációból
        if speed is None:
            speed = self._stall_detection_config.get('speed', 150.0)
        if stall_timeout is None:
            stall_timeout = self._stall_detection_config.get('timeout', 0.3)
        if stall_tolerance is None:
            stall_tolerance = self._stall_detection_config.get('tolerance', 0.5)
        max_search_angle = self._stall_detection_config.get('max_search_angle', 400.0)
        
        if joints is None:
            # Konfig alapján vagy default: J2, J3 (J1 bázisnak nincs fizikai végállása)
            joints = self._stall_detection_config.get('calibrate_joints', ['J2', 'J3'])
        
        self._calibration_stop_requested = False
        self._calibration_status = {
            'running': True,
            'current_step': 0,
            'total_steps': len(joints) * 2 + 1,
            'current_joint': None,
            'current_direction': None,
            'progress': 0.0,
            'message': 'Kalibráció indítása...',
            'results': {},
        }
        
        results = {
            'completed': False,
            'j1_limits': [None, None],
            'j2_limits': [None, None],
            'j3_limits': [None, None],
            'home_position': {'j1': 0.0, 'j2': 0.0, 'j3': 0.0},
        }
        
        try:
            self._set_state(DeviceState.HOMING)
            print(f"🤖 Automatikus kalibráció indítása (stall detection)...")
            
            # Pozíció nullázása a kezdőponton
            await self._send_command("G92 X0 Y0 Z0")
            await asyncio.sleep(0.3)
            
            step = 0
            
            for joint in joints:
                if self._calibration_stop_requested:
                    raise Exception("Kalibráció leállítva")
                
                joint = joint.upper()
                joint_key = joint.lower()
                
                # Pozitív irány keresése
                step += 1
                self._calibration_status.update({
                    'current_step': step,
                    'current_joint': joint,
                    'current_direction': 'positive',
                    'progress': step / self._calibration_status['total_steps'] * 100,
                    'message': f'{joint} pozitív végállás keresése...',
                })
                
                pos_limit = await self._search_limit_with_stall(
                    joint, +1, speed, stall_timeout, stall_tolerance, max_search_angle
                )
                if pos_limit is not None:
                    results[f'{joint_key}_limits'][1] = pos_limit
                    print(f"  {joint} max: {pos_limit:.1f}°")
                
                if self._calibration_stop_requested:
                    raise Exception("Kalibráció leállítva")
                
                # Negatív irány keresése
                step += 1
                self._calibration_status.update({
                    'current_step': step,
                    'current_joint': joint,
                    'current_direction': 'negative',
                    'progress': step / self._calibration_status['total_steps'] * 100,
                    'message': f'{joint} negatív végállás keresése...',
                })
                
                neg_limit = await self._search_limit_with_stall(
                    joint, -1, speed, stall_timeout, stall_tolerance, max_search_angle
                )
                if neg_limit is not None:
                    results[f'{joint_key}_limits'][0] = neg_limit
                    print(f"  {joint} min: {neg_limit:.1f}°")
            
            # Home pozícióba állás
            step += 1
            self._calibration_status.update({
                'current_step': step,
                'current_joint': None,
                'current_direction': None,
                'progress': step / self._calibration_status['total_steps'] * 100,
                'message': 'Home pozícióba állás...',
            })
            
            # Default home: J1=0, J2=középen, J3=középen
            j2_home = 45.0
            j3_home = 0.0
            if results['j2_limits'][0] is not None and results['j2_limits'][1] is not None:
                j2_home = (results['j2_limits'][0] + results['j2_limits'][1]) / 2
            if results['j3_limits'][0] is not None and results['j3_limits'][1] is not None:
                j3_home = (results['j3_limits'][0] + results['j3_limits'][1]) / 2
            
            await self._send_command("G90")
            await self._send_command(f"G1 X{j2_home:.1f} Y{j3_home:.1f} Z0 F{speed:.0f}")
            await self._wait_for_idle(timeout=30.0)
            
            results['home_position'] = {'j1': 0.0, 'j2': j2_home, 'j3': j3_home}
            results['completed'] = True
            
            self._calibration_status.update({
                'running': False,
                'progress': 100.0,
                'message': 'Kalibráció kész!',
                'results': results,
            })
            
            self._set_state(DeviceState.IDLE)
            print(f"🤖 Automatikus kalibráció kész!")
            return results
            
        except Exception as e:
            results['error'] = str(e)
            self._calibration_status.update({
                'running': False,
                'message': f'Hiba: {str(e)}',
                'results': results,
            })
            try:
                from base import DeviceState
            except ImportError:
                from ..base import DeviceState
            self._set_state(DeviceState.IDLE)
            print(f"🤖 Kalibráció hiba: {e}")
            return results
    
    async def _search_limit_with_stall(
        self,
        joint: str,
        direction: int,
        speed: float = 300.0,
        stall_timeout: float = 0.3,
        stall_tolerance: float = 0.5,
        max_angle: float = 400.0,
    ) -> Optional[float]:
        """
        Végállás keresése stall detection-nel.
        
        Folyamatosan mozog a megadott irányba, és figyeli a pozíció változását.
        Ha a pozíció nem változik stall_timeout ideig, az elakadást jelent.
        
        Args:
            joint: 'J1', 'J2', vagy 'J3'
            direction: +1 (pozitív) vagy -1 (negatív irány)
            speed: Mozgás sebesség (fok/perc)
            stall_timeout: Mennyi ideig várjon (mp)
            stall_tolerance: Mekkora elmozdulás számít változásnak (fok)
            max_angle: Maximum keresési szög
        
        Returns:
            A végállás pozíciója fokban, vagy None ha nem található
        """
        grbl_axis = self.JOINT_TO_GRBL.get(joint.upper())
        if not grbl_axis:
            print(f"  Ismeretlen joint: {joint}")
            return None
        
        direction_name = "pozitív" if direction > 0 else "negatív"
        print(f"  {joint} {direction_name} irány keresése...")
        
        # Kezdő pozíció
        status = await self.get_grbl_status()
        if not status:
            return None
        
        # Joint pozíció kinyerése a státuszból
        wpos = status.get('wpos')
        if not wpos:
            return None
        
        # GRBL tengely -> joint pozíció mapping
        axis_to_pos = {'X': wpos.x, 'Y': wpos.y, 'Z': wpos.z}
        start_pos = axis_to_pos.get(grbl_axis, 0)
        last_pos = start_pos
        stall_start_time = None
        
        # Mozgás indítása (nagy inkrementális lépés)
        move_distance = direction * max_angle
        await self._send_command("G91")
        await self._send_command(f"G1 {grbl_axis}{move_distance:.1f} F{speed:.0f}")
        
        # Polling - stall detection
        poll_interval = 0.05
        timeout = abs(max_angle) / speed * 60 + 10
        elapsed = 0.0
        
        while elapsed < timeout:
            if self._calibration_stop_requested:
                await self._send_command("!")
                await asyncio.sleep(0.1)
                await self._send_command("\x18")
                await self._send_command("$X")
                await self._send_command("G90")
                return None
            
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            
            # Pozíció lekérdezése
            status = await self.get_grbl_status()
            if not status:
                continue
            
            wpos = status.get('wpos')
            if not wpos:
                continue
            
            axis_to_pos = {'X': wpos.x, 'Y': wpos.y, 'Z': wpos.z}
            current_pos = axis_to_pos.get(grbl_axis, 0)
            state = status.get('state', '').lower()
            
            # Ha IDLE, akkor befejeződött a mozgás
            if 'idle' in state:
                await self._send_command("G90")
                return None
            
            # Stall detection
            pos_change = abs(current_pos - last_pos)
            
            if pos_change < stall_tolerance:
                if stall_start_time is None:
                    stall_start_time = asyncio.get_event_loop().time()
                elif asyncio.get_event_loop().time() - stall_start_time > stall_timeout:
                    # Stall detected!
                    print(f"    Stall detected @ {current_pos:.1f}°")
                    
                    # Mozgás leállítása
                    await self._send_command("!")
                    await asyncio.sleep(0.1)
                    await self._send_command("\x18")
                    await asyncio.sleep(0.2)
                    await self._send_command("$X")
                    await asyncio.sleep(0.1)
                    await self._send_command("G90")
                    
                    return current_pos
            else:
                stall_start_time = None
                last_pos = current_pos
        
        # Timeout
        await self._send_command("!")
        await self._send_command("\x18")
        await self._send_command("$X")
        await self._send_command("G90")
        return None
    
    async def _wait_for_idle(self, timeout: float = 10.0) -> bool:
        """Várakozás IDLE állapotra."""
        start = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - start < timeout:
            status = await self.get_grbl_status()
            state = status.get('state', '').lower()
            if 'idle' in state:
                return True
            await asyncio.sleep(0.1)
        return False
