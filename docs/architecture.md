# Multi-Robot Control System - Architektúra

## Áttekintés

A rendszer három fő rétegből áll:

```
┌─────────────────────────────────────────────────┐
│                 Web Frontend                     │
│              (React + TypeScript)                │
├─────────────────────────────────────────────────┤
│                Node.js Backend                   │
│          (Express + Socket.IO)                   │
├─────────────────────────────────────────────────┤
│               Python Bridge                      │
│          (FastAPI + Device Drivers)              │
├─────────────────────────────────────────────────┤
│              Hardware Layer                      │
│     (LinuxCNC, GRBL, future devices)            │
└─────────────────────────────────────────────────┘
```

## Komponensek

### 1. Web Frontend

- **Technológia:** React, TypeScript, Tailwind CSS, Vite
- **Fő funkciók:**
  - Dashboard az eszközök áttekintésére
  - Valós idejű pozíció és állapot megjelenítés
  - Jog vezérlés
  - MDI konzol
  - Job queue kezelés
  - Automatizálási szabályok szerkesztése

### 2. Node.js Backend

- **Technológia:** Express, Socket.IO, TypeScript
- **Fő funkciók:**
  - REST API az eszközökhöz
  - WebSocket valós idejű kommunikáció
  - Event Engine az automatizáláshoz
  - Állapot kezelés
  - Bridge kommunikáció

### 3. Python Bridge

- **Technológia:** FastAPI, asyncio, pyserial
- **Fő funkciók:**
  - LinuxCNC driver (linuxcnc Python modul)
  - GRBL driver (soros kommunikáció)
  - Bővíthető driver interface
  - Valós idejű állapot polling

## Adatfolyam

```
User Input
    │
    ▼
[Frontend] ──WebSocket──▶ [Backend]
                              │
                              ▼
                        [Event Engine]
                              │
                              ▼
                    [Python Bridge] ──HTTP/WS──▶ [Backend]
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              [LinuxCNC]            [GRBL]
                    │                   │
                    ▼                   ▼
              [CNC Maró]          [Lézervágó]
```

## Kommunikáció

### Frontend ↔ Backend

- **WebSocket:** Valós idejű események (pozíció, állapot)
- **REST API:** CRUD műveletek, parancsok

### Backend ↔ Bridge

- **HTTP REST:** Parancsok küldése
- **WebSocket:** Valós idejű állapot streaming

### Bridge ↔ Hardware

- **LinuxCNC:** Python NML modul
- **GRBL:** Soros port (pyserial)

## Bővíthetőség

Új eszköz hozzáadásához:

1. Implementáld a `DeviceDriver` absztrakt osztályt
2. Add hozzá a `config/devices.yaml` fájlhoz
3. A rendszer automatikusan betölti

```python
# Példa új driver
class MyCustomDriver(DeviceDriver):
    device_type = DeviceType.CUSTOM
    
    async def connect(self) -> bool:
        # Implementáció
        pass
```

## Deployment

### Development
```bash
./scripts/start-all.sh
```

### Production
- Docker Compose konfiguráció elérhető
- Reverse proxy (nginx) ajánlott
- SSL/TLS termináció
