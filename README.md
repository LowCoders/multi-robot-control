# Multi-Robot Control System

> [!WARNING]
> Ez a projekt jelenleg development (fejlesztési) állapotban van.
> Production környezetben történő használata nem támogatott és nem ajánlott.

Bővíthető, moduláris robotvezérlő rendszer LinuxCNC és GRBL eszközökhöz, webes felülettel, 3D vizualizációval és eseményvezérelt automatizálással.

## Főbb Funkciók

- **3D Vizualizáció** - Valós idejű gép megjelenítés React Three Fiber-rel
- **G-code Követés** - Szinkronizált G-code megjelenítés aktuális sor kiemeléssel
- **Job Manager** - Munkák ütemezése, átrendezése (drag & drop), újraindítása
- **Gép Konfigurátor** - Vizuális és JSON szerkesztő gép paraméterekhez
- **Kinematikai Lánc** - 3-5 tengelyes gépek támogatása
- **Átméretezhető Panelek** - Testreszabható elrendezés

## Támogatott Eszközök

| Eszköz | Típus | Vezérlés | Kapcsolat |
|--------|-------|----------|-----------|
| CNC Maró | JP-3163B + TB6560 | LinuxCNC | PCI LPT |
| Lézervágó | EleksMana W5.2 | GRBL 1.1 | USB Serial |
| Szimulált | Teszt eszköz | Simulated | - |

## Rendszer Követelmények

- Debian 12 / Ubuntu 22.04 LTS
- Node.js 20+, Python 3.11+
- LinuxCNC 2.9 (opcionális, valós gépekhez)
- PREEMPT-RT kernel (opcionális, valós idejű vezérléshez)

## Projekt Struktúra

```
multi-robot-control/
├── backend/                   # Node.js backend (Express + Socket.IO)
│   ├── src/api/routes/        # Domain-routerek (devices, commands, jobs, ...)
│   ├── src/api/_helpers/      # Routerek közös util-jai (pl. bridgeUrl)
│   ├── src/api/_state/        # In-memory job queue / állapot
│   ├── src/api/bridge-types.ts        # auto-generált (FastAPI OpenAPI)
│   ├── src/api/routes.contract.test.ts # snapshot a publikus REST felületről
│   └── src/devices/bridgeClient.ts    # típusos Python bridge kliens
├── drivers/                   # Python device driverek
│   ├── bridge/                # FastAPI csomag (app, state, routers/, helpers)
│   │   └── routers/_runner.py # diagnosztikai tesztek közös koreográfiája
│   ├── api_models.py          # Pydantic request body-k (single source of truth)
│   ├── jog_safe_mixin.py      # közös jog-session mixin
│   ├── scripts/               # manuális diagnosztikai scriptek + README
│   └── bridge_server.py       # ~30 soros kompatibilitási shim (uvicorn entry)
├── frontend/                  # React + TypeScript + Vite
│   ├── src/components/devices/machineConfig/  # AxisEditor extrakt
│   ├── src/components/jobs/   # AddJobModal kiemelve
│   ├── src/types/bridge-types.ts # auto-generált (FastAPI OpenAPI)
│   └── src/utils/apiClient.ts # típusos fetch wrapper a bridge-types felett
├── config/                    # Rendszer és gép konfigurációk
│   └── machines/_defaults/    # gép-típusonkénti default machine-config
├── linuxcnc-config/           # LinuxCNC konfigurációs fájlok
├── scripts/                   # Telepítő, indító és generátor scriptek
│   └── generate-api-types.sh  # FastAPI OpenAPI → TS típus generátor
└── docs/                      # Dokumentáció
```

## Gyors Kezdés

```bash
# Backend indítása
cd backend && npm install && npm run dev

# Frontend indítása
cd frontend && npm install && npm run dev

# Python bridge (opcionális, valós eszközökhöz)
cd drivers && pip install -r requirements.txt && python bridge_server.py
```

Web interface: http://localhost:5173

## API típusok regenerálása

A backend és a frontend egyaránt típusokat generál a Python bridge OpenAPI
sémájából (single source of truth: `drivers/api_models.py` + a router-ek).
Bridge változás után futtasd:

```bash
bash scripts/generate-api-types.sh
```

Ez frissíti:

- `backend/src/api/bridge-openapi.json` (OpenAPI séma)
- `backend/src/api/bridge-types.ts`
- `frontend/src/types/bridge-types.ts`

A TypeScript fordítás azonnal jelzi, ha valamelyik hívási hely
inkonzisztens lett a backend felülettel.

## Tesztelés

```bash
# Backend (Vitest, snapshot contract test)
cd backend && npm test

# Frontend (Vitest + JSDOM)
cd frontend && npm test

# Python (pytest, drivers/scripts/ kizárva)
python -m pytest drivers/
```

## Dokumentáció

- [Architektúra](docs/architecture.md)
- [API Referencia](docs/api-reference.md)
- [Új Eszköz Hozzáadása](docs/adding-devices.md)
- [Automatizálási Szabályok](docs/automation-rules.md)
- [Hardware Setup](docs/hardware-setup.md)
- [Robotkar Wiring](docs/robot-arm-wiring.md)
- [Tube Bender grblHAL Wiring](docs/tube-bender-grblhal-wiring.md)
- [Python Environment](docs/python-environment.md)

## Licenc

MIT License - Készítette: Sam <lowcoders@protonmail.com>
