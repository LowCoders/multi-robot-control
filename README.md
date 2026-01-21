# Multi-Robot Control System

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
arduino/
├── backend/           # Node.js backend (Express + Socket.IO)
├── drivers/           # Python device driverek
├── frontend/          # React frontend (Three.js vizualizáció)
├── config/            # Rendszer és gép konfigurációk
├── linuxcnc-config/   # LinuxCNC konfigurációs fájlok
├── scripts/           # Telepítő és segéd scriptek
└── docs/              # Dokumentáció
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

## Dokumentáció

- [Hardware Setup](docs/hardware-setup.md)
- [Architektúra](docs/architecture.md)
- [API Referencia](docs/api-reference.md)
- [Új Eszköz Hozzáadása](docs/adding-devices.md)
- [Automatizálási Szabályok](docs/automation-rules.md)

## Licenc

MIT License - Készítette: Sam
