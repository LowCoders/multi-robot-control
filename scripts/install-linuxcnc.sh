#!/bin/bash
# install-linuxcnc.sh
# LinuxCNC 2.9 telepítése Ubuntu/Debian rendszerekre
# Frissítve: 2026-01 - Ubuntu 24.04 támogatással

set -e

echo "=========================================="
echo "LinuxCNC 2.9 Telepítés"
echo "=========================================="

# Ellenőrzés: root jogok
if [ "$EUID" -ne 0 ]; then
    echo "Kérlek futtasd sudo-val: sudo $0"
    exit 1
fi

# Non-interactive mód beállítása
export DEBIAN_FRONTEND=noninteractive

# Kernel és RT állapot ellenőrzése
KERNEL=$(uname -r)
CMDLINE=$(cat /proc/cmdline)
echo "Jelenlegi kernel: $KERNEL"

# RT/Lowlatency detektálás (Ubuntu 24.04 kompatibilis)
RT_OK=false
if [[ "$KERNEL" == *"rt"* ]] || [[ "$KERNEL" == *"lowlatency"* ]]; then
    RT_OK=true
    echo "✅ RT/Lowlatency kernel detektálva"
elif echo "$CMDLINE" | grep -q "preempt=full"; then
    RT_OK=true
    echo "✅ Lowlatency boot paraméterek aktívak (preempt=full)"
fi

if [ "$RT_OK" = false ]; then
    echo ""
    echo "⚠️  FIGYELEM: Nem optimális kernel konfiguráció!"
    echo "   Futtasd először: sudo ./scripts/setup-rt-kernel.sh"
    echo ""
    echo "Folytatás automatikusan..."
    echo ""
fi

# Disztribúció ellenőrzése
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
    CODENAME=$VERSION_CODENAME
    VERSION_NUM=$VERSION_ID
else
    echo "Nem sikerült azonosítani a disztribúciót"
    exit 1
fi

echo "Disztribúció: $DISTRO $CODENAME ($VERSION_NUM)"

# LinuxCNC repo codename meghatározása
LINUXCNC_CODENAME=""
case $DISTRO in
    debian)
        case $CODENAME in
            bookworm|trixie|sid)
                LINUXCNC_CODENAME="bookworm"
                ;;
            bullseye)
                LINUXCNC_CODENAME="bullseye"
                ;;
            buster)
                LINUXCNC_CODENAME="buster"
                ;;
            *)
                LINUXCNC_CODENAME="bookworm"
                ;;
        esac
        ;;
    ubuntu)
        case $CODENAME in
            noble|mantic|lunar)
                LINUXCNC_CODENAME="bookworm"
                echo "ℹ️  Ubuntu $CODENAME -> Debian Bookworm repo használata"
                ;;
            jammy|kinetic)
                LINUXCNC_CODENAME="bullseye"
                echo "ℹ️  Ubuntu $CODENAME -> Debian Bullseye repo használata"
                ;;
            focal)
                LINUXCNC_CODENAME="buster"
                ;;
            *)
                LINUXCNC_CODENAME="bookworm"
                ;;
        esac
        ;;
    *)
        echo "Nem támogatott disztribúció: $DISTRO"
        exit 1
        ;;
esac

echo "LinuxCNC repository: $LINUXCNC_CODENAME"

# LinuxCNC repo hozzáadása
echo ""
echo "[1/5] LinuxCNC repository hozzáadása..."

# Szükséges csomagok (hiba elnyomással)
apt-get update -qq 2>&1 | grep -v "^W:" || true
apt-get install -y -qq curl gnupg ca-certificates dirmngr 2>/dev/null || true

# GPG kulcs telepítése (több módszerrel próbálkozunk)
KEYRING_DIR="/usr/share/keyrings"
KEYRING_FILE="$KEYRING_DIR/linuxcnc-archive-keyring.gpg"
mkdir -p "$KEYRING_DIR"

echo "GPG kulcs letöltése..."

# Töröljük a régi kulcsot ha létezik
rm -f "$KEYRING_FILE" 2>/dev/null || true

# 1. módszer: Keyserver (legmegbízhatóbb)
KEY_INSTALLED=false
echo "  Próbálkozás: keyserver.ubuntu.com..."
if gpg --batch --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 3CB9FD148F374FEF 2>/dev/null; then
    gpg --batch --export 3CB9FD148F374FEF 2>/dev/null > "$KEYRING_FILE"
    if [ -s "$KEYRING_FILE" ]; then
        KEY_INSTALLED=true
        echo "  ✅ GPG kulcs telepítve keyserver-ről"
    fi
fi

# 2. módszer: Közvetlen letöltés a LinuxCNC oldalról
if [ "$KEY_INSTALLED" = false ]; then
    echo "  Próbálkozás: linuxcnc.org..."
    if curl -fsSL "http://linuxcnc.org/linuxcnc-keyring.deb" -o /tmp/linuxcnc-keyring.deb 2>/dev/null; then
        dpkg -i /tmp/linuxcnc-keyring.deb 2>/dev/null || true
        rm -f /tmp/linuxcnc-keyring.deb
        if [ -f /usr/share/keyrings/linuxcnc-archive-keyring.gpg ]; then
            KEY_INSTALLED=true
            echo "  ✅ GPG kulcs telepítve keyring csomagból"
        fi
    fi
fi

# 3. módszer: Régi stílusú kulcs
if [ "$KEY_INSTALLED" = false ]; then
    echo "  Próbálkozás: apt-key (legacy)..."
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 3CB9FD148F374FEF 2>/dev/null && {
        KEY_INSTALLED=true
        echo "  ✅ GPG kulcs telepítve apt-key-jel"
        KEYRING_FILE=""  # apt-key használatakor nem kell signed-by
    } || true
fi

# Repository hozzáadása
SOURCES_FILE="/etc/apt/sources.list.d/linuxcnc.list"

if [ "$KEY_INSTALLED" = true ] && [ -n "$KEYRING_FILE" ] && [ -f "$KEYRING_FILE" ]; then
    echo "deb [signed-by=$KEYRING_FILE] http://linuxcnc.org/ $LINUXCNC_CODENAME base 2.9-uspace" > "$SOURCES_FILE"
elif [ "$KEY_INSTALLED" = true ]; then
    # apt-key használata esetén
    echo "deb http://linuxcnc.org/ $LINUXCNC_CODENAME base 2.9-uspace" > "$SOURCES_FILE"
else
    # Kulcs nélkül (trusted=yes)
    echo "⚠️  GPG kulcs nem telepíthető, trusted=yes használata..."
    echo "deb [trusted=yes] http://linuxcnc.org/ $LINUXCNC_CODENAME base 2.9-uspace" > "$SOURCES_FILE"
fi

echo "Repository hozzáadva: $SOURCES_FILE"
cat "$SOURCES_FILE"

# Függőségek telepítése
echo ""
echo "[2/5] Függőségek telepítése..."

# APT frissítés (figyelmeztetések elnyomása)
apt-get update 2>&1 | grep -v "^W:" | grep -v "^E:.*mongodb" || true

# Alapvető függőségek
apt-get install -y \
    build-essential \
    python3-dev \
    python3-tk \
    tcl-dev \
    tk-dev \
    bwidget \
    libtk-img \
    libreadline-dev \
    libboost-python-dev \
    libmodbus-dev \
    libusb-1.0-0-dev \
    libgtk-3-dev \
    libglib2.0-dev \
    intltool \
    autoconf \
    automake \
    libtool \
    2>/dev/null || echo "Néhány függőség nem települt (folytatás...)"

# LinuxCNC telepítés
echo ""
echo "[3/5] LinuxCNC telepítése..."

LINUXCNC_INSTALLED=false

# Próbáljuk a csomagból
if apt-get install -y linuxcnc-uspace 2>/dev/null; then
    echo "✅ LinuxCNC sikeresen telepítve csomagból!"
    apt-get install -y linuxcnc-uspace-dev 2>/dev/null || true
    LINUXCNC_INSTALLED=true
else
    echo ""
    echo "⚠️  LinuxCNC csomag nem telepíthető közvetlenül."
    echo ""
    
    # Ubuntu 24.04 esetén részletes útmutató
    if [ "$CODENAME" = "noble" ]; then
        echo "Ubuntu 24.04 esetén a LinuxCNC forráskódból telepíthető:"
        echo ""
        echo "  # Függőségek"
        echo "  sudo apt install git build-essential debhelper dh-python"
        echo "  sudo apt install libudev-dev libmodbus-dev libusb-1.0-0-dev"
        echo "  sudo apt install python3-dev tcl-dev tk-dev bwidget"
        echo ""
        echo "  # Forráskód"
        echo "  cd ~"
        echo "  git clone https://github.com/LinuxCNC/linuxcnc.git"
        echo "  cd linuxcnc/debian"
        echo "  ./configure uspace"
        echo "  cd .."
        echo "  dpkg-buildpackage -b -uc"
        echo ""
        echo "  # Telepítés"
        echo "  sudo dpkg -i ../linuxcnc-uspace_*.deb"
        echo ""
    fi
fi

# Felhasználói jogok
echo ""
echo "[4/5] Felhasználói jogosultságok..."
REAL_USER=${SUDO_USER:-$USER}
if [ "$REAL_USER" != "root" ]; then
    usermod -aG dialout "$REAL_USER" 2>/dev/null || true
    echo "Felhasználó ($REAL_USER) hozzáadva a dialout csoporthoz"
fi

# Párhuzamos port modul
echo ""
echo "[5/5] Párhuzamos port modul beállítása..."
if ! grep -q "^parport_pc" /etc/modules 2>/dev/null; then
    echo "parport_pc" >> /etc/modules
    echo "parport_pc modul hozzáadva"
fi
modprobe parport_pc 2>/dev/null && echo "parport_pc modul betöltve" || echo "parport_pc nem tölthető (normális VM-ben)"

# Konfiguráció másolása
echo ""
echo "=========================================="
echo "Konfiguráció előkészítése..."
echo "=========================================="

LINUXCNC_CONFIG_DIR="/home/${REAL_USER}/linuxcnc/configs"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_CONFIG="$SCRIPT_DIR/../linuxcnc-config/jp3163b"

if [ -d "$SOURCE_CONFIG" ]; then
    mkdir -p "$LINUXCNC_CONFIG_DIR"
    cp -r "$SOURCE_CONFIG" "$LINUXCNC_CONFIG_DIR/"
    chown -R "$REAL_USER:$REAL_USER" "/home/$REAL_USER/linuxcnc" 2>/dev/null || true
    echo "✅ JP-3163B konfiguráció másolva: $LINUXCNC_CONFIG_DIR/jp3163b"
else
    echo "⚠️  JP-3163B konfiguráció nem található: $SOURCE_CONFIG"
fi

# NC fájlok könyvtár
NC_FILES_DIR="/home/${REAL_USER}/nc_files"
mkdir -p "$NC_FILES_DIR" "$NC_FILES_DIR/subroutines"
chown -R "$REAL_USER:$REAL_USER" "$NC_FILES_DIR" 2>/dev/null || true

echo ""
echo "=========================================="
echo "Telepítés befejezve!"
echo "=========================================="
echo ""

if [ "$LINUXCNC_INSTALLED" = true ]; then
    echo "✅ LinuxCNC sikeresen telepítve!"
    echo ""
    echo "Ellenőrzési parancsok:"
    echo "  linuxcnc --version"
    echo "  latency-test"
    echo ""
    echo "LinuxCNC indítása:"
    echo "  linuxcnc ~/linuxcnc/configs/jp3163b/jp3163b.ini"
else
    echo "⚠️  LinuxCNC nincs telepítve (Ubuntu 24.04 korlátozás)"
    echo ""
    echo "Telepítés forráskódból szükséges!"
    echo "Lásd: https://linuxcnc.org/docs/html/code/building-linuxcnc.html"
fi

echo ""
echo "LPT port cím ellenőrzése:"
echo "  cat /proc/ioports | grep parport"
echo ""
echo "Konfiguráció:"
echo "  $LINUXCNC_CONFIG_DIR/jp3163b/"
