# API Referencia

> **Single source of truth:** A Python bridge (`drivers/bridge/`) FastAPI
> alkalmazás OpenAPI sémája. Az alábbi dokumentum kézi összefoglaló a
> főbb végpontokról; a teljes, mindig naprakész lista a gépileg
> generált `backend/src/api/bridge-openapi.json` (és a belőle készülő
> `bridge-types.ts`) fájlokban van.
>
> Frissítés: `bash scripts/generate-api-types.sh` (a backend és a frontend
> oldalon is létrejön a típusos `bridge-types.ts`).

## REST API

Base URL: `http://localhost:3001/api`

A Node backend a `/api/...` útvonalakat 1:1 továbbítja a Python bridge
felé, ezért a path-ok megegyeznek a FastAPI router-eken kihirdetett
útvonalakkal.

### Eszközök

#### GET /devices
Összes eszköz listázása.

**Response:**
```json
{
  "devices": [
    {
      "id": "cnc_main",
      "name": "CNC Maró",
      "type": "cnc_mill",
      "connected": true,
      "state": "idle"
    }
  ]
}
```

#### GET /devices/:id
Eszköz részletek.

#### GET /devices/:id/status
Eszköz aktuális állapota.

**Response:**
```json
{
  "state": "idle",
  "position": { "x": 0, "y": 0, "z": 0 },
  "work_position": { "x": 0, "y": 0, "z": 0 },
  "feed_rate": 0,
  "spindle_speed": 0,
  "laser_power": 0,
  "progress": 0,
  "current_line": 0,
  "total_lines": 0,
  "current_file": null,
  "error_message": null,
  "feed_override": 100,
  "spindle_override": 100
}
```

#### POST /devices/:id/connect
Csatlakozás az eszközhöz.

#### POST /devices/:id/disconnect
Lecsatlakozás.

### Parancsok

#### POST /devices/:id/home
Homing végrehajtása.

**Body:**
```json
{
  "axes": ["X", "Y", "Z"]  // opcionális
}
```

#### POST /devices/:id/jog
Jog mozgás.

**Body:**
```json
{
  "axis": "X",
  "distance": 10,
  "feed_rate": 1000
}
```

#### POST /devices/:id/gcode
G-code parancs küldése (MDI).

**Body:**
```json
{
  "gcode": "G0 X0 Y0"
}
```

#### POST /devices/:id/load
G-code fájl betöltése.

**Body:**
```json
{
  "filepath": "/path/to/file.nc"
}
```

#### POST /devices/:id/run
Program futtatás indítása.

#### POST /devices/:id/pause
Program megállítása.

#### POST /devices/:id/resume
Program folytatása.

#### POST /devices/:id/stop
Program leállítása.

#### POST /devices/:id/reset
Eszköz reset (alarm törlése).

### GRBL beállítások

#### GET /devices/:id/grbl-settings
GRBL `$$` lekérdezés. Válasz: `{ "settings": { "0": 10.0, ... } }`.

#### POST /devices/:id/grbl-settings/batch
Több setting mentése egyetlen kérésben:

```json
{ "settings": { "100": 80.0, "110": 5000.0 } }
```

### Diagnosztika

A diagnosztikai endpointok (firmware-probe, endstop-test, motion-test)
ugyanazt a koreográfiát használják: leállítják a polling-ot, regisztrálnak
egy `cancel`-eseményt, futtatják a thread-alapú tesztet a serial-lock alatt,
majd cleanup. A közös runner: `drivers/bridge/routers/_runner.py`.

#### POST /devices/:id/firmware-probe
Firmware verzió + képesség lekérdezés. Cancellálható: `POST .../cancel-test`.

#### POST /devices/:id/endstop-test
Végállás-érzékelők ellenőrzése.

#### POST /devices/:id/motion-test
Mozgás-teszt opcionális paraméterekkel (lásd `EndstopTestRequest`,
`MotionTestRequest` a `drivers/api_models.py`-ban).

#### POST /devices/:id/cancel-test
Folyamatban levő diagnosztikai teszt megszakítása.

#### GET /devices/:id/test-progress?after=N
Aktuális teszt log-bejegyzések (incremental polling).

### Robot-specifikus

#### POST /devices/:id/calibrate-limits
Stall-detection alapú végállás kalibráció. Body: `CalibrateLimitsRequest`.

#### GET /devices/:id/calibration-status
Aktuális kalibráció állapot (progress, lépés).

#### POST /devices/:id/save-calibration
Kalibrációs eredmények mentése a `config/devices.yaml`-ba.

#### GET /devices/:id/home-position
Home pozíció konfiguráció.

#### POST /devices/:id/home-position
Home pozíció mentése. Body: `SetHomePositionRequest`.

#### POST /devices/:id/soft-limits?enabled=true|false
Szoftveres limitek be-/kikapcsolása.

#### POST /devices/:id/reload-config
Machine-config.json újratöltése.

---

## WebSocket

Endpoint: `ws://localhost:3001/socket.io`

### Server → Client Events

#### devices:list
Eszközök listája.

#### device:status
Eszköz állapot frissítés.

```json
{
  "deviceId": "cnc_main",
  "status": { ... }
}
```

#### device:position
Pozíció frissítés.

```json
{
  "deviceId": "cnc_main",
  "position": { "x": 10, "y": 20, "z": 0 }
}
```

#### device:state_change
Állapot változás.

```json
{
  "deviceId": "cnc_main",
  "oldState": "idle",
  "newState": "running"
}
```

#### device:error
Hibaüzenet.

```json
{
  "deviceId": "cnc_main",
  "message": "Error message"
}
```

### Client → Server Events

#### device:command
Parancs küldése.

```json
{
  "deviceId": "cnc_main",
  "command": "run",
  "params": {}
}
```

#### device:jog
Jog mozgás.

```json
{
  "deviceId": "cnc_main",
  "axis": "X",
  "distance": 10,
  "feedRate": 1000
}
```

#### device:mdi
MDI parancs.

```json
{
  "deviceId": "cnc_main",
  "gcode": "G0 X0 Y0"
}
```
