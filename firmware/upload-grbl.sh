#!/bin/bash
# upload-grbl.sh
# GRBL firmware letöltése, konfigurálása és feltöltése Arduino Uno-ra
# 4 tengelyes robot kar támogatással (grbl-servo fork)
#
# Bekötés:
#   J1 (bázis)  -> Z tengely (D4/D7)
#   J2 (váll)   -> X tengely (D2/D5)
#   J3 (könyök) -> Y tengely (D3/D6)
#   J4 (csukló) -> A tengely (D12/D13) - 28BYJ-48 motor
#   Gripper     -> Spindle PWM (D11)
#   Sucker      -> Coolant (A3)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIRMWARE_DIR="$SCRIPT_DIR"
GRBL_DIR="$FIRMWARE_DIR/grbl-4axis"
VENV_DIR="$PROJECT_DIR/drivers/venv"

# Színek
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=========================================="
echo "GRBL 4-Axis Firmware Feltöltés"
echo -e "==========================================${NC}"

# Port meghatározása
DEFAULT_PORT="/dev/ttyUSB0"
if [ -n "$1" ]; then
    PORT="$1"
else
    # Automatikus port detektálás
    if [ -e "/dev/ttyUSB0" ]; then
        PORT="/dev/ttyUSB0"
    elif [ -e "/dev/ttyACM0" ]; then
        PORT="/dev/ttyACM0"
    else
        echo -e "${RED}Hiba: Nem található Arduino port!${NC}"
        echo "Csatlakoztasd az Arduino-t és próbáld újra."
        echo "Vagy add meg a portot paraméterként: $0 /dev/ttyUSB0"
        exit 1
    fi
fi
echo "Arduino port: $PORT"

# PlatformIO ellenőrzése
echo ""
echo "[1/5] PlatformIO ellenőrzése..."
if [ -f "$VENV_DIR/bin/pio" ]; then
    PIO="$VENV_DIR/bin/pio"
    echo "PlatformIO megtalálva: $PIO"
elif command -v pio &> /dev/null; then
    PIO="pio"
    echo "PlatformIO megtalálva: $(which pio)"
else
    echo -e "${YELLOW}PlatformIO nincs telepítve. Telepítés...${NC}"
    if [ -f "$VENV_DIR/bin/pip" ]; then
        "$VENV_DIR/bin/pip" install platformio
        PIO="$VENV_DIR/bin/pio"
    else
        pip3 install --user platformio
        PIO="$HOME/.local/bin/pio"
    fi
fi

# GRBL forrás letöltése/frissítése
echo ""
echo "[2/5] GRBL forrás előkészítése..."
if [ -d "$GRBL_DIR" ]; then
    echo "GRBL mappa már létezik: $GRBL_DIR"
    read -p "Frissítsem a forrást? (i/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Ii]$ ]]; then
        rm -rf "$GRBL_DIR"
    fi
fi

if [ ! -d "$GRBL_DIR" ]; then
    echo "GRBL 4-axis forrás letöltése..."
    mkdir -p "$GRBL_DIR"
    
    # gcobos/grbl4axis - 4 tengelyes GRBL fork Arduino Uno-hoz
    # Ez a fork támogatja az A tengelyt D12/D13 pineken
    git clone --depth 1 https://github.com/gcobos/grbl4axis.git "$GRBL_DIR/grbl-source"
    
    # PlatformIO projekt struktúra létrehozása
    mkdir -p "$GRBL_DIR/src"
    mkdir -p "$GRBL_DIR/include"
    
    # GRBL forrás másolása
    cp -r "$GRBL_DIR/grbl-source/grbl/"* "$GRBL_DIR/src/"
    
    echo "grbl4axis fork letöltve (4 tengely támogatással)"
fi

# Konfiguráció módosítása 4 tengelyhez
echo ""
echo "[3/5] GRBL konfiguráció (4 tengely)..."

# config.h módosítása
CONFIG_FILE="$GRBL_DIR/src/config.h"
if [ -f "$CONFIG_FILE" ]; then
    # Biztonsági mentés
    cp "$CONFIG_FILE" "$CONFIG_FILE.bak"
    
    # HOMING_INIT_LOCK kikapcsolása (robot kar esetén nem kell homing lock)
    # A HOMING_CYCLE_0 definíciót MEGTARTJUK, mert GRBL megköveteli!
    # Homing-ot runtime-ban kapcsoljuk ki: $22=0
    sed -i 's/^#define HOMING_INIT_LOCK/\/\/ #define HOMING_INIT_LOCK/' "$CONFIG_FILE"
    
    echo "config.h módosítva (HOMING_INIT_LOCK kikapcsolva)"
fi

# grbl4axis fork esetén a cpu_map.h már tartalmazza az A tengelyt
# Csak ellenőrizzük, hogy megvan-e
CPU_MAP_FILE="$GRBL_DIR/src/cpu_map.h"
if [ -f "$CPU_MAP_FILE" ]; then
    if grep -q "A_STEP_BIT\|E_STEP_BIT" "$CPU_MAP_FILE"; then
        echo "cpu_map.h OK - 4. tengely támogatás megtalálva"
    else
        echo -e "${YELLOW}FIGYELEM: cpu_map.h-ban nincs 4. tengely definíció${NC}"
    fi
fi

# platformio.ini létrehozása
echo ""
echo "[4/5] PlatformIO projekt konfigurálása..."
cat > "$GRBL_DIR/platformio.ini" << 'EOF'
; PlatformIO Project Configuration
; GRBL 4-Axis for Robot Arm (gcobos/grbl4axis fork)
;
; Bekötés:
;   J1 (bázis)  -> Z (D4/D7)
;   J2 (váll)   -> X (D2/D5)
;   J3 (könyök) -> Y (D3/D6)
;   J4 (csukló) -> E (D12/D13) - grbl4axis uses 'E' for 4th axis
;
; FONTOS: A 4. tengely betűje 'E' (nem 'A')!
; Parancs: G1 X10 Y10 Z10 E10 F100

[env:uno]
platform = atmelavr
board = uno
framework = arduino

; Suppress warnings (-w) - grbl4axis has some harmless warnings
build_flags = -w

; Monitor settings
monitor_speed = 115200

; Upload settings
upload_speed = 115200
EOF

echo "platformio.ini létrehozva"

# Firmware fordítása és feltöltése
echo ""
echo "[5/5] Firmware fordítása és feltöltése..."
echo -e "${YELLOW}FIGYELEM: Ez felülírja az Arduino firmware-t!${NC}"
echo "Eredeti firmware backup: $FIRMWARE_DIR/robot_arm_firmware_backup.hex"
echo ""
read -p "Folytatod? (i/n): " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Ii]$ ]]; then
    echo "Megszakítva."
    exit 0
fi

cd "$GRBL_DIR"

# Fordítás
echo "Fordítás..."
$PIO run

# Feltöltés
echo "Feltöltés: $PORT"
$PIO run --target upload --upload-port "$PORT"

echo ""
echo -e "${GREEN}=========================================="
echo "GRBL firmware sikeresen feltöltve!"
echo -e "==========================================${NC}"
echo ""
echo "Következő lépések:"
echo ""
echo "1. Csatlakozz a GRBL-hez:"
echo "   screen $PORT 115200"
echo ""
echo "2. Alap konfiguráció (másold be):"
cat << 'EOF'
   
$0=10
$1=255
$3=0
$10=1
$20=0
$21=0
$22=0
$100=17.78
$101=17.78
$102=17.78
$103=5.69
$110=500
$111=500
$112=500
$113=100
$120=50
$121=50
$122=50
$123=20

EOF
echo ""
echo "3. Teszt mozgás:"
echo "   G1 X10 F100    # J2 váll"
echo "   G1 Y10 F100    # J3 könyök"
echo "   G1 Z10 F100    # J1 bázis"
echo "   G1 A10 F50     # J4 csukló"
echo ""
echo "4. Eredeti firmware visszaállítása (ha szükséges):"
echo "   avrdude -p atmega328p -c arduino -P $PORT -b 115200 \\"
echo "       -U flash:w:$FIRMWARE_DIR/robot_arm_firmware_backup.hex:i"
echo ""
