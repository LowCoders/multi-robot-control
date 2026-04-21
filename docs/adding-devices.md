# Új Eszköz Hozzáadása

## 1. Eszköz konfiguráció

### Általános — `config/devices.yaml`

```yaml
devices:
  - id: my_device
    name: "Új Eszköz"
    driver: grbl                # grbl | linuxcnc | robot_arm | tube_bender | ...
    type: cnc_mill
    enabled: true
    config:
      port: /dev/ttyUSB1
      baudrate: 115200
```

### Gép-specifikus runtime konfig — `config/machines/<id>.json`

A `config/machines/<deviceId>.json` tartja a futás közbeni paramétereket
(axis limits, scale, home pozíció, work envelope, ...). A
`config/machines/_defaults/<type>.json` fájlok adják az eszköz-típushoz
tartozó alapokat. Új gép esetén másold a megfelelő default-ot, és tedd a
`<deviceId>.json` mellé.

## 2. Meglévő Driver Használata

### GRBL / grblHAL eszközök

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

### Robotkar (jog session-nel)

```yaml
- id: arm_1
  name: "Robotkar #1"
  driver: robot_arm
  type: robot_arm
  config:
    port: /dev/ttyACM0
    baudrate: 115200
```

## 3. Új Driver Implementálása

### 3.1 Hozz létre új driver fájlt

`drivers/my_driver.py`:

```python
from device_driver import (
    DeviceDriver,
    DeviceType,
    DeviceState,
    DeviceStatus,
    DeviceCapabilities,
    Position,
)
# Ha a drivered jog session-t is támogat (start/stop start_jog mintával),
# örökölj a JogSafeDeviceDriver mixinből — ez egy helyen kezeli a session
# state-et és a polling-szinkronizálást:
from jog_safe_mixin import JogSafeDeviceDriver


class MyDriver(JogSafeDeviceDriver):
    """Custom driver implementáció."""

    device_type = DeviceType.CUSTOM

    def __init__(self, device_id: str, device_name: str, **config):
        super().__init__(device_id, device_name, DeviceType.CUSTOM)
        self.config = config

    async def connect(self) -> bool:
        try:
            self._connected = True
            self._set_state(DeviceState.IDLE)
            return True
        except Exception as exc:
            self._set_error(str(exc))
            return False

    async def disconnect(self) -> None:
        self._connected = False
        self._set_state(DeviceState.DISCONNECTED)

    async def get_status(self) -> DeviceStatus:
        return self._status

    async def get_capabilities(self) -> DeviceCapabilities:
        return DeviceCapabilities(
            axes=["X", "Y", "Z"],
            has_spindle=True,
            max_feed_rate=5000,
        )

    # home / jog / send_gcode / load_file / run / pause / resume / stop / reset
    # — implementáld a hardware-specifikus részt.
```

### 3.2 Regisztráld a drivert

A `DeviceManager.add_device()` (`drivers/bridge/manager.py`) elágazásában:

```python
elif driver == "my_driver":
    from my_driver import MyDriver
    device = MyDriver(
        device_id=config.id,
        device_name=config.name,
        **config.config,
    )
```

### 3.3 Eszköz-specifikus REST végpont (opcionális)

Ha új REST végpontot kell kihirdetni:

1. Hozz létre egy új router fájlt: `drivers/bridge/routers/my_router.py`:

```python
from fastapi import APIRouter, HTTPException
from ..state import device_manager

router = APIRouter()


@router.post("/devices/{device_id}/my-action")
async def my_action(device_id: str):
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    return {"success": await device.my_action()}
```

2. Kösd be a `drivers/bridge/routers/__init__.py`-ban:

```python
from . import my_router
app.include_router(my_router.router, tags=["my"])
```

3. Ha van új request body, vedd fel az `api_models.py`-ba (Pydantic).

4. Generáld újra a típusokat:

```bash
bash scripts/generate-api-types.sh
```

A backend és frontend `bridge-types.ts` automatikusan frissül; a
TypeScript fordítás azonnal jelzi a nem-megfelelő hívásokat.

### 3.4 Diagnosztikai teszt (opcionális)

Ha a driverhez thread-alapú diagnosztikai tesztet kell kiajánlani
(firmware-probe / endstop / motion mintára), használd a közös runner-t:

```python
from .._runner import run_serial_test

@router.post("/devices/{device_id}/my-test")
async def my_test(device_id: str):
    device = _get_device_or_404(device_id)
    return await run_serial_test(
        device=device,
        device_id=device_id,
        runner_factory=lambda: MyTestRunner(device.serial),
        blocking_call=lambda runner, stop: runner.run(stop),
    )
```

A runner cleanup-ja (polling újraindítás, cancel-event eltávolítás)
automatikus.

## 4. Eszköz Típusok

| Típus | Leírás |
|-------|--------|
| cnc_mill | CNC maró |
| cnc_lathe | CNC eszterga |
| laser_cutter | Lézervágó |
| laser_engraver | Lézer gravírozó |
| printer_3d | 3D nyomtató |
| robot_arm | Robot kar |
| tube_bender | Csőhajlító |
| conveyor | Szállítószalag |
| rotary_table | Forgóasztal |
| custom | Egyéb |

## 5. Tesztelés

1. Indítsd újra a bridge szervert: `./scripts/start-all.sh` (vagy
   közvetlenül `uvicorn bridge_server:app`).
2. Ellenőrizd a logokat (`drivers/bridge/manager.py` írja az init-et).
3. Nyisd meg a dashboardot — az új eszköznek meg kell jelennie.
4. Futtasd a contract tesztet, hogy a publikus API ne romoljon el:

```bash
cd backend && npm test
```

Ha kontrolt is adsz a frontendnek (panel komponens), használd a
`frontend/src/utils/apiClient.ts` típusos wrapperet:

```ts
import { apiPost } from '../../utils/apiClient'

await apiPost('/devices/{device_id}/my-action', {
  path: { device_id: deviceId },
})
```

## 6. Manuális diagnosztika

A `drivers/scripts/` mappa interaktív, manuális diagnosztikai scripteket
tartalmaz (`coupling_test.py`, `test_esp32_grbl.py`, `test_robot.py`).
Ezeket csak akkor szabad futtatni, ha a bridge szerver **nem fut**, mert
közvetlenül foglalják a soros portot. Részletek:
`drivers/scripts/README.md`.
