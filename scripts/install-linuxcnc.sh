#!/bin/bash
# install-linuxcnc.sh
# LinuxCNC 2.9 telepítése

set -e

echo "=========================================="
echo "LinuxCNC 2.9 Telepítés"
echo "=========================================="

# Ellenőrzés: root jogok
if [ "$EUID" -ne 0 ]; then
    echo "Kérlek futtasd sudo-val: sudo $0"
    exit 1
fi

# Kernel ellenőrzése
KERNEL=$(uname -r)
echo "Jelenlegi kernel: $KERNEL"

if [[ ! "$KERNEL" == *"rt"* ]] && [[ ! "$KERNEL" == *"lowlatency"* ]]; then
    echo ""
    echo "FIGYELEM: Nem PREEMPT-RT vagy lowlatency kernel fut!"
    echo "A LinuxCNC működhet, de a teljesítmény nem lesz optimális."
    echo ""
    echo "Folytatod? (i/n)"
    read -r answer
    if [[ "$answer" != "i" ]] && [[ "$answer" != "I" ]]; then
        exit 1
    fi
fi

# Disztribúció ellenőrzése
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
    CODENAME=$VERSION_CODENAME
else
    echo "Nem sikerült azonosítani a disztribúciót"
    exit 1
fi

echo "Disztribúció: $DISTRO $CODENAME"

# LinuxCNC repo hozzáadása
echo ""
echo "[1/4] LinuxCNC repository hozzáadása..."

# GPG kulcs
apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 3CB9FD148F374FEF 2>/dev/null || \
    curl -fsSL http://linuxcnc.org/dists/linuxcnc-key.gpg | gpg --dearmor -o /usr/share/keyrings/linuxcnc.gpg

# Repo
case $DISTRO in
    debian)
        echo "deb [signed-by=/usr/share/keyrings/linuxcnc.gpg] http://linuxcnc.org/ $CODENAME base 2.9-uspace" > /etc/apt/sources.list.d/linuxcnc.list
        ;;
    ubuntu)
        echo "deb [signed-by=/usr/share/keyrings/linuxcnc.gpg] http://linuxcnc.org/ $CODENAME base 2.9-uspace" > /etc/apt/sources.list.d/linuxcnc.list
        ;;
    *)
        echo "Nem támogatott disztribúció"
        exit 1
        ;;
esac

# Telepítés
echo ""
echo "[2/4] LinuxCNC telepítése..."
apt update
apt install -y linuxcnc-uspace linuxcnc-uspace-dev

# Felhasználói jogok
echo ""
echo "[3/4] Felhasználói jogosultságok..."
REAL_USER=${SUDO_USER:-$USER}
usermod -aG dialout $REAL_USER

# Párhuzamos port modul
echo ""
echo "[4/4] Párhuzamos port modul beállítása..."
if ! grep -q "parport_pc" /etc/modules; then
    echo "parport_pc" >> /etc/modules
fi
modprobe parport_pc 2>/dev/null || true

echo ""
echo "=========================================="
echo "LinuxCNC telepítése befejezve!"
echo "=========================================="
echo ""
echo "Ellenőrzés:"
echo "1. linuxcnc --version"
echo "2. latency-test"
echo ""
echo "LPT port cím ellenőrzése:"
echo "cat /proc/ioports | grep parport"
echo ""
echo "Konfiguráció:"
echo "Másold a linuxcnc-config mappát a megfelelő helyre"
echo "és indítsd el a LinuxCNC-t."
echo ""
