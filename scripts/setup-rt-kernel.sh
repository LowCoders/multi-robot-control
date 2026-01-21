#!/bin/bash
# setup-rt-kernel.sh
# PREEMPT-RT kernel telepítése LinuxCNC-hez

set -e

echo "=========================================="
echo "PREEMPT-RT Kernel Telepítés"
echo "=========================================="

# Ellenőrzés: root jogok
if [ "$EUID" -ne 0 ]; then
    echo "Kérlek futtasd sudo-val: sudo $0"
    exit 1
fi

# Disztribúció ellenőrzése
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
    VERSION=$VERSION_ID
else
    echo "Nem sikerült azonosítani a disztribúciót"
    exit 1
fi

echo "Disztribúció: $DISTRO $VERSION"

case $DISTRO in
    debian)
        echo ""
        echo "[1/3] PREEMPT-RT kernel telepítése (Debian)..."
        apt update
        apt install -y linux-image-rt-amd64
        ;;
    ubuntu)
        echo ""
        echo "[1/3] PREEMPT-RT kernel telepítése (Ubuntu)..."
        apt update
        apt install -y linux-lowlatency
        # Ubuntu esetén a lowlatency kernel is megfelelő
        # Ha PREEMPT-RT kell, akkor:
        # apt install -y linux-image-rt
        ;;
    *)
        echo "Nem támogatott disztribúció: $DISTRO"
        echo "Kérlek telepítsd manuálisan a PREEMPT-RT kernelt"
        exit 1
        ;;
esac

# GRUB konfiguráció optimalizálása
echo ""
echo "[2/3] GRUB konfiguráció optimalizálása..."

GRUB_FILE="/etc/default/grub"
GRUB_BACKUP="/etc/default/grub.backup.$(date +%Y%m%d_%H%M%S)"

# Backup
cp $GRUB_FILE $GRUB_BACKUP
echo "Backup mentve: $GRUB_BACKUP"

# Kernel paraméterek hozzáadása
# isolcpus=1 - egy CPU mag elkülönítése a valós idejű feladatokhoz
# intel_pstate=disable - CPU frekvencia scaling kikapcsolása
CMDLINE_ADD="isolcpus=1 intel_pstate=disable"

if grep -q "GRUB_CMDLINE_LINUX=" $GRUB_FILE; then
    # Meglévő sor módosítása
    CURRENT=$(grep "^GRUB_CMDLINE_LINUX=" $GRUB_FILE | cut -d'"' -f2)
    if [[ ! "$CURRENT" == *"isolcpus"* ]]; then
        NEW="$CURRENT $CMDLINE_ADD"
        sed -i "s|^GRUB_CMDLINE_LINUX=.*|GRUB_CMDLINE_LINUX=\"$NEW\"|" $GRUB_FILE
        echo "Kernel paraméterek hozzáadva"
    else
        echo "Kernel paraméterek már beállítva"
    fi
fi

# GRUB frissítése
update-grub

echo ""
echo "[3/3] Telepítés befejezve!"
echo ""
echo "=========================================="
echo "FONTOS: Újraindítás szükséges!"
echo "=========================================="
echo ""
echo "Újraindítás után:"
echo "1. Ellenőrizd a kernelt: uname -r"
echo "2. Futtasd a latency tesztet: latency-test"
echo "3. Folytasd: ./scripts/install-linuxcnc.sh"
echo ""
echo "Újraindítás most? (i/n)"
read -r answer
if [[ "$answer" == "i" ]] || [[ "$answer" == "I" ]]; then
    reboot
fi
