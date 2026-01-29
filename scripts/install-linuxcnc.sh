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

# Kernel ellenőrzése
KERNEL=$(uname -r)
echo "Jelenlegi kernel: $KERNEL"

if [[ ! "$KERNEL" == *"rt"* ]] && [[ ! "$KERNEL" == *"lowlatency"* ]]; then
    echo ""
    echo "FIGYELEM: Nem PREEMPT-RT vagy lowlatency kernel fut!"
    echo "A LinuxCNC működhet, de a teljesítmény nem lesz optimális."
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
# Ubuntu 24.04 (Noble) és újabb verziók esetén Bookworm-ot használunk
# mert a LinuxCNC még nem támogatja hivatalosan
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
                echo "Nem támogatott Debian verzió: $CODENAME"
                echo "Megpróbáljuk bookworm-mal..."
                LINUXCNC_CODENAME="bookworm"
                ;;
        esac
        ;;
    ubuntu)
        # Ubuntu codename -> Debian megfeleltetés
        case $CODENAME in
            noble|mantic|lunar)
                # Ubuntu 24.04/23.10/23.04 -> Debian Bookworm alapú
                LINUXCNC_CODENAME="bookworm"
                echo "Ubuntu $CODENAME -> Debian Bookworm repo használata"
                ;;
            jammy|kinetic)
                # Ubuntu 22.04/22.10 -> Debian Bullseye alapú
                LINUXCNC_CODENAME="bullseye"
                echo "Ubuntu $CODENAME -> Debian Bullseye repo használata"
                ;;
            focal)
                # Ubuntu 20.04 -> Debian Buster
                LINUXCNC_CODENAME="buster"
                ;;
            *)
                echo "Nem támogatott Ubuntu verzió: $CODENAME"
                echo "Megpróbáljuk bookworm-mal..."
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

# Szükséges csomagok
apt-get update -qq
apt-get install -y -qq curl gnupg ca-certificates

# GPG kulcs (modern módszer - apt-key deprecated)
KEYRING_DIR="/usr/share/keyrings"
KEYRING_FILE="$KEYRING_DIR/linuxcnc-archive-keyring.gpg"

mkdir -p "$KEYRING_DIR"

echo "GPG kulcs letöltése..."
if curl -fsSL "http://linuxcnc.org/dists/$LINUXCNC_CODENAME/Release.gpg" -o /tmp/linuxcnc-release.gpg 2>/dev/null; then
    # Próbáljuk meg a kulcsot kinyerni
    gpg --dearmor -o "$KEYRING_FILE" < /tmp/linuxcnc-release.gpg 2>/dev/null || true
    rm -f /tmp/linuxcnc-release.gpg
fi

# Ha nem sikerült, alternatív módszer
if [ ! -f "$KEYRING_FILE" ] || [ ! -s "$KEYRING_FILE" ]; then
    echo "Alternatív GPG kulcs letöltés..."
    curl -fsSL "http://linuxcnc.org/dists/linuxcnc-key.gpg" 2>/dev/null | gpg --dearmor -o "$KEYRING_FILE" 2>/dev/null || {
        # Utolsó próbálkozás: keyserver
        echo "Keyserver próbálkozás..."
        gpg --batch --keyserver keyserver.ubuntu.com --recv-keys 3CB9FD148F374FEF 2>/dev/null || true
        gpg --batch --export 3CB9FD148F374FEF 2>/dev/null | gpg --dearmor -o "$KEYRING_FILE" 2>/dev/null || {
            echo "HIBA: Nem sikerült a GPG kulcsot letölteni"
            echo "Folytatás aláírás ellenőrzés nélkül..."
            KEYRING_FILE=""
        }
    }
fi

# Repository hozzáadása
SOURCES_FILE="/etc/apt/sources.list.d/linuxcnc.list"
if [ -n "$KEYRING_FILE" ] && [ -f "$KEYRING_FILE" ]; then
    echo "deb [signed-by=$KEYRING_FILE] http://linuxcnc.org/ $LINUXCNC_CODENAME base 2.9-uspace" > "$SOURCES_FILE"
else
    # Aláírás nélkül (nem ajánlott, de működik)
    echo "deb [trusted=yes] http://linuxcnc.org/ $LINUXCNC_CODENAME base 2.9-uspace" > "$SOURCES_FILE"
fi

echo "Repository hozzáadva: $SOURCES_FILE"

# Függőségek telepítése (Ubuntu 24.04-hez szükséges)
echo ""
echo "[2/5] Függőségek telepítése..."
apt-get update -qq 2>/dev/null || {
    echo "APT frissítés figyelmeztetéssel (folytatás)..."
}

# Alapvető függőségek
apt-get install -y -qq \
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
    2>/dev/null || echo "Néhány függőség nem települt (nem kritikus)"

# LinuxCNC telepítés
echo ""
echo "[3/5] LinuxCNC telepítése..."

# Először próbáljuk a csomagból
if apt-get install -y linuxcnc-uspace 2>/dev/null; then
    echo "LinuxCNC sikeresen telepítve csomagból!"
    apt-get install -y linuxcnc-uspace-dev 2>/dev/null || true
else
    echo ""
    echo "FIGYELEM: A LinuxCNC csomag nem telepíthető közvetlenül."
    echo "Ez Ubuntu 24.04 esetén normális, mert nincs hivatalos csomag."
    echo ""
    echo "Alternatív megoldások:"
    echo "1. Forráskódból fordítás (lásd: https://github.com/LinuxCNC/linuxcnc)"
    echo "2. Debian 12 Bookworm használata (ajánlott LinuxCNC-hez)"
    echo "3. Ubuntu 22.04 LTS használata"
    echo ""
    echo "A scriptek és konfiguráció előkészítése folytatódik..."
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
    echo "parport_pc modul hozzáadva az /etc/modules-hoz"
fi

# Próbáljuk betölteni a modult
modprobe parport_pc 2>/dev/null && echo "parport_pc modul betöltve" || echo "parport_pc modul nem tölthető be (normális VM-ben)"

# Konfiguráció másolása
echo ""
echo "=========================================="
echo "Konfiguráció előkészítése..."
echo "=========================================="

LINUXCNC_CONFIG_DIR="$HOME/linuxcnc/configs"
if [ -n "$SUDO_USER" ]; then
    LINUXCNC_CONFIG_DIR="/home/$SUDO_USER/linuxcnc/configs"
fi

# JP-3163B konfiguráció másolása
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_CONFIG="$SCRIPT_DIR/../linuxcnc-config/jp3163b"

if [ -d "$SOURCE_CONFIG" ]; then
    mkdir -p "$LINUXCNC_CONFIG_DIR"
    cp -r "$SOURCE_CONFIG" "$LINUXCNC_CONFIG_DIR/"
    
    # Tulajdonos beállítása
    if [ -n "$SUDO_USER" ]; then
        chown -R "$SUDO_USER:$SUDO_USER" "/home/$SUDO_USER/linuxcnc"
    fi
    
    echo "JP-3163B konfiguráció másolva: $LINUXCNC_CONFIG_DIR/jp3163b"
else
    echo "Figyelem: JP-3163B konfiguráció nem található: $SOURCE_CONFIG"
fi

# NC fájlok könyvtár
NC_FILES_DIR="/home/${SUDO_USER:-$USER}/nc_files"
mkdir -p "$NC_FILES_DIR" "$NC_FILES_DIR/subroutines"
if [ -n "$SUDO_USER" ]; then
    chown -R "$SUDO_USER:$SUDO_USER" "$NC_FILES_DIR"
fi

echo ""
echo "=========================================="
echo "Telepítés befejezve!"
echo "=========================================="
echo ""
echo "Ellenőrzési parancsok:"
echo "  linuxcnc --version    # Verzió ellenőrzése"
echo "  latency-test          # Latencia teszt (fontos!)"
echo ""
echo "LPT port cím ellenőrzése:"
echo "  cat /proc/ioports | grep parport"
echo ""
echo "Konfiguráció:"
echo "  $LINUXCNC_CONFIG_DIR/jp3163b/"
echo ""
echo "LinuxCNC indítása:"
echo "  linuxcnc ~/linuxcnc/configs/jp3163b/jp3163b.ini"
echo ""

# Verzió ellenőrzése
if command -v linuxcnc &> /dev/null; then
    echo "Telepített verzió:"
    linuxcnc --version 2>/dev/null || echo "  (verzió lekérdezés sikertelen)"
else
    echo "MEGJEGYZÉS: A linuxcnc parancs nem elérhető."
    echo "Ubuntu 24.04 esetén forráskódból kell telepíteni."
    echo "Lásd: https://linuxcnc.org/docs/html/code/building-linuxcnc.html"
fi
