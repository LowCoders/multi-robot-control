# Új Eszköz Hozzáadása

## 1. Konfiguráció

Szerkeszd a `config/devices.yaml` fájlt:

```yaml
devices:
  - id: my_device
    name: "Új Eszköz"
    driver: grbl  # vagy linuxcnc, marlin, stb.
    type: cnc_mill
    enabled: true
    config:
      port: /dev/ttyUSB1
      baudrate: 115200
```

## 2. Meglévő Driver Használata

### GRBL eszközök
```yaml
- id: laser_2
  name: "Második Lézer"
  driver: grbl
  type: laser_engraver
  config:
    port: /dev/ttyUSB1
    baudrate: 115200
```

### LinuxCNC eszközök
```yaml
- id: cnc_2
  name: "Második CNC"
  driver: linuxcnc
  type: cnc_lathe
  config:
    ini_file: /home/user/linuxcnc/configs/lathe/lathe.ini
```

## 3. Új Driver Implementálása

Ha teljesen új protokollt kell támogatni:

### 3.1 Hozz létre új driver fájlt

`drivers/plugins/my_driver.py`:

```python
from drivers.base import (
    DeviceDriver,
    DeviceType,
    DeviceState,
    DeviceStatus,
    DeviceCapabilities,
    Position,
)

class MyDriver(DeviceDriver):
    """Custom driver implementáció"""
    
    device_type = DeviceType.CUSTOM
    
    def __init__(self, device_id: str, device_name: str, **config):
        super().__init__(device_id, device_name, DeviceType.CUSTOM)
        self.config = config
    
    async def connect(self) -> bool:
        """Kapcsolat létrehozása"""
        try:
            # Implementáld a kapcsolódást
            self._connected = True
            self._set_state(DeviceState.IDLE)
            return True
        except Exception as e:
            self._set_error(str(e))
            return False
    
    async def disconnect(self) -> None:
        """Kapcsolat bontása"""
        self._connected = False
        self._set_state(DeviceState.DISCONNECTED)
    
    async def get_status(self) -> DeviceStatus:
        """Állapot lekérdezése"""
        # Implementáld az állapot lekérdezést
        return self._status
    
    async def get_capabilities(self) -> DeviceCapabilities:
        """Képességek lekérdezése"""
        return DeviceCapabilities(
            axes=["X", "Y", "Z"],
            has_spindle=True,
            max_feed_rate=5000,
        )
    
    async def home(self, axes=None) -> bool:
        """Homing"""
        # Implementáció
        return True
    
    async def jog(self, axis, distance, feed_rate) -> bool:
        """Jog mozgás"""
        # Implementáció
        return True
    
    async def jog_stop(self) -> bool:
        """Jog leállítás"""
        return True
    
    async def send_gcode(self, gcode: str) -> str:
        """G-code küldés"""
        # Implementáció
        return "ok"
    
    async def load_file(self, filepath: str) -> bool:
        """Fájl betöltés"""
        return True
    
    async def run(self, from_line=0) -> bool:
        """Program indítás"""
        return True
    
    async def pause(self) -> bool:
        """Szüneteltetés"""
        return True
    
    async def resume(self) -> bool:
        """Folytatás"""
        return True
    
    async def stop(self) -> bool:
        """Leállítás"""
        return True
    
    async def reset(self) -> bool:
        """Reset"""
        return True
```

### 3.2 Regisztráld a drivert

`drivers/bridge_server.py` - DeviceManager.add_device():

```python
elif driver == "my_driver":
    from .plugins.my_driver import MyDriver
    device = MyDriver(
        device_id=config.id,
        device_name=config.name,
        **config.config,
    )
```

### 3.3 Konfiguráld

```yaml
- id: custom_device
  name: "Egyedi Eszköz"
  driver: my_driver
  type: custom
  config:
    custom_param: "value"
```

## 4. Eszköz Típusok

| Típus | Leírás |
|-------|--------|
| cnc_mill | CNC maró |
| cnc_lathe | CNC eszterga |
| laser_cutter | Lézervágó |
| laser_engraver | Lézer gravírozó |
| printer_3d | 3D nyomtató |
| robot_arm | Robot kar |
| conveyor | Szállítószalag |
| rotary_table | Forgóasztal |
| custom | Egyéb |

## 5. Tesztelés

1. Indítsd újra a bridge szervert
2. Ellenőrizd a logokat
3. Nyisd meg a dashboardot
4. Az új eszköznek meg kell jelennie
