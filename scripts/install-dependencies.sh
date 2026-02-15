#!/bin/bash
# install-dependencies.sh
# Telepíti a Multi-Robot Control System függőségeit

set -e

echo "=========================================="
echo "Multi-Robot Control System - Függőségek"
echo "=========================================="

# Ellenőrzés: root jogok
if [ "$EUID" -ne 0 ]; then
    echo "Kérlek futtasd sudo-val: sudo $0"
    exit 1
fi

# Rendszer frissítése
echo ""
echo "[1/6] Rendszer frissítése..."
apt update
apt upgrade -y

# Alapvető eszközök
echo ""
echo "[2/6] Alapvető eszközök telepítése..."
apt install -y \
    build-essential \
    git \
    curl \
    wget \
    vim \
    htop \
    screen \
    python3 \
    python3-pip \
    python3-venv

# Node.js 20 LTS
echo ""
echo "[3/6] Node.js 20 telepítése..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
echo "Node.js verzió: $(node -v)"
echo "npm verzió: $(npm -v)"

# Python csomagok (virtuális környezetben)
echo ""
echo "[4/6] Python csomagok telepítése..."
REAL_USER=${SUDO_USER:-$USER}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DRIVERS_DIR="$PROJECT_DIR/drivers"
VENV_DIR="$DRIVERS_DIR/venv"

# Régi/hibás venv törlése ha szükséges
if [ -d "$VENV_DIR" ] && [ ! -f "$VENV_DIR/bin/pip" ]; then
    echo "Hibás venv törlése..."
    rm -rf "$VENV_DIR"
fi

# Virtuális környezet létrehozása
if [ ! -d "$VENV_DIR" ]; then
    echo "Python virtuális környezet létrehozása: $VENV_DIR"
    sudo -u "$REAL_USER" python3 -m venv "$VENV_DIR"
fi

# Csomagok telepítése a venv-be (requirements.txt-ből)
echo "Python csomagok telepítése..."
sudo -u "$REAL_USER" "$VENV_DIR/bin/pip" install --upgrade pip
if [ -f "$DRIVERS_DIR/requirements.txt" ]; then
    sudo -u "$REAL_USER" "$VENV_DIR/bin/pip" install -r "$DRIVERS_DIR/requirements.txt"
else
    echo "FIGYELEM: $DRIVERS_DIR/requirements.txt nem található!"
    sudo -u "$REAL_USER" "$VENV_DIR/bin/pip" install \
        pyserial \
        fastapi \
        "uvicorn[standard]" \
        websockets \
        pyyaml \
        python-dotenv
fi

# Venv tulajdonosának beállítása
chown -R "$REAL_USER:$REAL_USER" "$VENV_DIR"

echo "Python csomagok telepítve: $VENV_DIR"

# Soros port eszközök és firmware feltöltés
echo ""
echo "[5/7] Soros port eszközök és firmware tools..."
apt install -y \
    setserial \
    minicom \
    avrdude

# PlatformIO (firmware fordítás és feltöltés)
echo ""
echo "[6/7] PlatformIO telepítése..."
if ! sudo -u "$REAL_USER" "$VENV_DIR/bin/pip" show platformio &> /dev/null; then
    echo "PlatformIO telepítése a Python venv-be..."
    sudo -u "$REAL_USER" "$VENV_DIR/bin/pip" install platformio
    echo "PlatformIO telepítve"
else
    echo "PlatformIO már telepítve van"
fi

# PlatformIO udev rules (USB hozzáférés)
if [ ! -f /etc/udev/rules.d/99-platformio-udev.rules ]; then
    echo "PlatformIO udev szabályok telepítése..."
    curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core/develop/platformio/assets/system/99-platformio-udev.rules | tee /etc/udev/rules.d/99-platformio-udev.rules > /dev/null
    udevadm control --reload-rules
    udevadm trigger
fi

# Felhasználó hozzáadása a dialout csoporthoz
echo ""
echo "[7/7] Felhasználói jogosultságok..."
usermod -aG dialout "$REAL_USER"
echo "Felhasználó '$REAL_USER' hozzáadva a 'dialout' csoporthoz"

echo ""
echo "=========================================="
echo "Telepítés befejezve!"
echo "=========================================="
echo ""
echo "Python venv: $VENV_DIR"
echo "  Aktiválás:    source $VENV_DIR/bin/activate"
echo "  Deaktiválás:  deactivate"
echo ""
echo "PlatformIO (firmware feltöltés):"
echo "  Használat:    source $VENV_DIR/bin/activate && pio --version"
echo ""
echo "Következő lépések:"
echo "1. Jelentkezz ki és be újra a dialout jogosultsághoz"
echo "2. Robot kar firmware: ./firmware/upload-grbl.sh"
echo "3. Futtasd: ./scripts/setup-rt-kernel.sh"
echo "4. Rendszer indítása: ./scripts/start-all.sh"
echo ""
