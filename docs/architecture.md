# Multi-Robot Control System - Architektúra

## Áttekintés

A rendszer három fő rétegből áll:

```
┌─────────────────────────────────────────────────┐
│                 Web Frontend                     │
│      (React + TypeScript + Vite)                 │
├─────────────────────────────────────────────────┤
│                Node.js Backend                   │
│          (Express + Socket.IO)                   │
├─────────────────────────────────────────────────┤
│               Python Bridge                      │
│       (FastAPI + Modular Drivers)                │
├─────────────────────────────────────────────────┤
│              Hardware Layer                      │
│     (GRBL / grblHAL ESP32, LinuxCNC, ...)        │
└─────────────────────────────────────────────────┘
```

A három réteg közös típusalapot egyetlen forrásból kap:

```
drivers/api_models.py           ← single source of truth (Pydantic)
       │
       ▼
backend/src/api/bridge-openapi.json   (scripts/generate-api-types.sh)
       │
       ├──▶ backend/src/api/bridge-types.ts
       └──▶ frontend/src/types/bridge-types.ts
```

A `scripts/generate-api-types.sh` újrageneráláskor a TypeScript ellenőrzés
azonnal kihozza, ha valamelyik hívás nem felel meg a backend felületnek.

## Komponensek

### 1. Web Frontend

- **Technológia:** React 18, TypeScript, Tailwind CSS, Vite, Zustand,
  @react-three/fiber, react-router-dom v6.
- **Fontosabb modulok:**
  - `pages/Dashboard.tsx`, `pages/JobManager.tsx`, `pages/Automation.tsx`
  - `components/devices/MachineConfigTab.tsx` (gép konfiguráció;
    az `AxisEditor` külön modulban: `components/devices/machineConfig/`)
  - `components/jobs/AddJobModal.tsx` (job felvételi modal)
  - `components/visualization/` (3D / G-code / robotkar nézetek — külön
    fejlesztési trackben halad, NEM része az általános refaktornak)
  - `utils/apiClient.ts` típusos `fetch` wrapper a generált
    `bridge-types.ts` felett
  - `utils/machineTypeSwitch.ts` deduplikált gép-típus váltó logika

### 2. Node.js Backend

- **Technológia:** Express 4, Socket.IO, TypeScript, Vitest.
- **API moduláris felépítés** (`backend/src/api/routes/`):
  - `devices.ts`, `commands.ts`, `jobs.ts`, `config.ts`, `usb.ts`,
    `automation.ts`, `system.ts`
  - Korábban egyetlen ~1950 soros `routes.ts` volt; ezt domain-routerekre
    bontottuk. A `routes.ts` ma csak a router-ek bekötését tartalmazza.
  - `_helpers/` és `_state/` mappák tartják a routerek közös segédjeit
    (pl. `bridgeUrl`, in-memory job queue állapot).
- **Bridge kliens:** `backend/src/devices/bridgeClient.ts` típusos
  Python-FastAPI kliens (a `bridge-types.ts`-re épül).
- **State / Socket layer:** `state/StateManager.ts` (`broadcastPosition`,
  `broadcastError`, throttled position fan-out).
- **Eseményrendszer:** A korábbi `events/EventEngine` (~480 sor) +
  hozzá tartozó tesztek **törölve**. Az automatizálás ma egyenesen a
  driver eseményekre épül (état változás, polling), nincs külön reaktor
  réteg.

### 3. Python Bridge

- **Technológia:** Python 3, FastAPI, uvicorn, pyserial, pytest.
- **Csomag-szintű felépítés** (`drivers/bridge/`):
  - `app.py` — `FastAPI` app + lifespan + CORS
  - `state.py` — `device_manager`, `active_test_events`,
    `active_test_progress` (modulszintű singleton-ok)
  - `manager.py` — `DeviceManager` (eszköz-betöltés, polling, broadcast)
  - `helpers.py` — közös util-ok (machine config olvasás, driver config
    extrakció, MACHINE_CONFIG_DIR konstans)
  - `routers/` — `devices.py`, `control.py`, `connect.py`, `motion.py`,
    `robot.py`, `diagnostics.py`, `grbl.py`, `usb.py`, `ws.py`
  - `routers/_runner.py` — közös `run_serial_test` koreográfia (polling
    leállítás → cancellation event → blocking thread → cleanup) a
    diagnosztikai endpointokhoz
- **Driverek** (`drivers/`):
  - `device_driver.py` — abstract `DeviceDriver` + Pydantic-kompatibilis
    `DeviceStatus`, `Position` modellek
  - `robot_arm_driver.py`, `grbl_device.py`, `tube_bender_driver.py`,
    `linuxcnc_driver.py`, ...
  - `jog_safe_mixin.py` — közös `start_jog/stop_jog` viselkedés (GRBL és
    robotkar is használja)
  - `api_models.py` — REQUEST modellek (`JogRequest`,
    `CalibrateLimitsRequest`, `SetHomePositionRequest`, ...) — innen
    generáljuk az OpenAPI sémát
- **Belépési pont:** `drivers/bridge_server.py` ma egy ~30 soros
  kompatibilitási shim, ami `from bridge.app import app`-ot reexportál.
  A `uvicorn bridge_server:app` parancs (és minden korábbi script /
  systemd unit) így változtatás nélkül tovább működik.
- **Manuális diagnosztikai scriptek:** `drivers/scripts/` mappában
  (`coupling_test.py`, `test_esp32_grbl.py`, `test_robot.py`). Ezeket
  csak a bridge LEÁLLÍTÁSA után szabad futtatni — leírás:
  `drivers/scripts/README.md`. A pytest a `norecursedirs = scripts`
  beállítással kizárja őket az automatikus tesztek közül.

## Adatfolyam

```
User Input
    │
    ▼
[Frontend] ──WebSocket──▶ [Backend]
       │                      │
       │ REST /api/...        │  REST → Python bridge proxy
       │                      ▼
       │                [bridgeClient.ts]
       │                      │
       └────────────▶ [Python Bridge] ──Serial──▶ [Hardware]
                              ▲                        │
                              └────── status poll ◀────┘
```

## Kommunikáció

### Frontend ↔ Backend
- **REST API:** `/api/...` — a Node backend a `/api/...` útvonalakat
  továbbítja a Python bridge felé (a path-ok 1:1 megfeleltetésben vannak,
  ezért használhatja a frontend a generált `bridge-types.ts`-t is).
- **WebSocket (Socket.IO):** valós idejű események (pozíció,
  állapot, control state, jog session).

### Backend ↔ Bridge
- **HTTP REST:** parancsok és konfiguráció (`bridgeClient.ts`).
- **WebSocket:** `/ws` — bridge → backend valós idejű állapot,
  `device:position`, `device:state`, hibák.

### Bridge ↔ Hardware
- **GRBL / grblHAL:** soros port (pyserial), `?` lekérdezés + soros
  válasz feldolgozás. A polling eseményvezérelt: konfigurálható időköz
  + state-átmeneten azonnali frissítés.
- **LinuxCNC:** Python NML modul.

## Bővíthetőség

Új eszköz hozzáadása:

1. Implementáld a `DeviceDriver` absztrakt osztályt (vagy örökölj a
   `JogSafeDeviceDriver` mixinből, ha jog session kezelés is kell).
2. Add hozzá a `config/devices.yaml`-ba.
3. Ha van eszköz-specifikus REST végpont, adj hozzá egy új router-t a
   `drivers/bridge/routers/`-ba és kösd be a `routers/__init__.py`-ban.
4. Frissítsd az `api_models.py`-t (request body-k), futtasd:
   `bash scripts/generate-api-types.sh` — a TypeScript fordítás
   azonnal jelzi a hívási helyek inkonzisztenciáit.
5. (Opcionális) Frontend kontroll panel: új komponens a
   `frontend/src/components/devices/`-ban; az `apiClient.ts`-en keresztül
   típusosan tudod hívni az új végpontot.

```python
class MyCustomDriver(JogSafeDeviceDriver):
    device_type = DeviceType.CUSTOM

    async def connect(self) -> bool:
        ...
```

## Tesztelés

- `backend/src/api/routes.contract.test.ts` — golden snapshot a publikus
  REST felületről. **Minden refaktor után le kell futtatni**; ha zöld,
  a publikus API változatlan.
- `backend/src/api/routes.test.ts` — végpont-szintű egységtesztek.
- `frontend` — Vitest, JSDOM (`npm test`).
- `drivers/tests/` — pytest (`python -m pytest drivers/`).

## Deployment

### Development
```bash
./scripts/start-all.sh
```

### Production
- Docker Compose konfiguráció elérhető
- Reverse proxy (nginx) ajánlott
- SSL/TLS termináció
