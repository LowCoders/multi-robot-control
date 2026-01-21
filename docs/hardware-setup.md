# Hardware Setup Guide

## Szükséges Alkatrészek

### 1. PCI LPT Kártya

A LinuxCNC valós idejű step/dir jeleket generál, amihez natív párhuzamos port szükséges.

**Ajánlott kártyák:**
- NetMos NM9805 chipset
- MosChip MCS9865 chipset
- Nem ajánlott: ECP/EPP only kártyák (SPP mód szükséges)

**Becsült ár:** $10-20 (AliExpress, eBay)

**Fontos:** USB-LPT adapterek NEM működnek LinuxCNC-vel a magas latencia miatt!

### 2. DB25 Párhuzamos Kábel

A JP-3163B vezérlőhöz DB25 csatlakozó szükséges.

- Ellenőrizd a board csatlakozó típusát (male/female)
- Szerezz be megfelelő DB25 kábelt (1-2m)

**Becsült ár:** $5-10

## Telepítési Lépések

### 1. PCI Kártya Behelyezése

1. Kapcsold ki a számítógépet és húzd ki a tápkábelt
2. Nyisd ki a házat
3. Helyezd be a PCI LPT kártyát egy szabad PCI slotba
4. Rögzítsd csavarral
5. Zárd be a házat

### 2. Kártya Ellenőrzése Linux Alatt

```bash
# Ellenőrizd, hogy a rendszer felismerte-e
lspci | grep -i parallel

# Ellenőrizd az I/O port címet
cat /proc/ioports | grep parport
# Tipikus kimenet: d010-d017 : parport0

# Ha nincs parport, töltsd be a modult
sudo modprobe parport_pc
```

### 3. JP-3163B Csatlakoztatása

#### Pin Kiosztás (Standard)

| LPT Pin | Funkció | JP-3163B |
|---------|---------|----------|
| 2 | X Step | Step X |
| 3 | X Dir | Dir X |
| 4 | Y Step | Step Y |
| 5 | Y Dir | Dir Y |
| 6 | Z Step | Step Z |
| 7 | Z Dir | Dir Z |
| 14 | Enable | Enable (ha van) |
| 18-25 | GND | GND |

**Megjegyzés:** A pontos pin kiosztás a JP-3163B verziójától függhet. Ellenőrizd a board dokumentációját!

### 4. Csatlakozás Ellenőrzése

```bash
# Latency teszt futtatása (LinuxCNC telepítés után)
latency-test

# Cél értékek:
# Base thread jitter: < 50,000 ns (50 µs)
# Servo thread jitter: < 100,000 ns (100 µs)
```

## Hibaelhárítás

### A rendszer nem ismeri fel a LPT kártyát

```bash
# Ellenőrizd a PCI eszközöket
lspci -v

# Töltsd be manuálisan a modult
sudo modprobe parport_pc io=0xd010 irq=none
```

### Magas latencia értékek

1. Tiltsd le a CPU power saving funkciókat a BIOS-ban
2. Tiltsd le a hyperthreading-et
3. Használj `isolcpus` kernel paramétert
4. Tiltsd le a grafikus effekteket

```bash
# GRUB konfiguráció módosítása
sudo nano /etc/default/grub

# Add hozzá:
GRUB_CMDLINE_LINUX="isolcpus=1 intel_pstate=disable"

# Frissítsd a GRUB-ot
sudo update-grub
```

## EleksMana W5.2 (Lézervágó)

Az EleksMana GRBL firmware-t futtat és USB-n csatlakozik.

### Csatlakoztatás

1. Csatlakoztasd USB kábellel
2. Ellenőrizd a port-ot:

```bash
ls /dev/ttyUSB* /dev/ttyACM*
# Tipikus: /dev/ttyUSB0

# Adj jogosultságot
sudo usermod -aG dialout $USER
# Jelentkezz ki és be újra
```

### GRBL Teszt

```bash
# Telepíts egy soros terminált
sudo apt install screen

# Csatlakozz
screen /dev/ttyUSB0 115200

# Küldj parancsokat:
# ?    - státusz lekérdezés
# $$   - beállítások listázása
# $H   - homing

# Kilépés: Ctrl+A, majd K, majd Y
```

## Következő Lépések

1. [PREEMPT-RT Kernel Telepítése](../scripts/setup-rt-kernel.sh)
2. [LinuxCNC Telepítése](../scripts/install-linuxcnc.sh)
3. [Konfiguráció](../linuxcnc-config/README.md)
