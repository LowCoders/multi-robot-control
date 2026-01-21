# API Referencia

## REST API

Base URL: `http://localhost:3001/api`

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
