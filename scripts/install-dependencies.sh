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

# Python csomagok
echo ""
echo "[4/6] Python csomagok telepítése..."
pip3 install --upgrade pip
pip3 install \
    pyserial \
    fastapi \
    uvicorn \
    websockets \
    pyyaml \
    python-dotenv

# Soros port eszközök
echo ""
echo "[5/6] Soros port eszközök..."
apt install -y \
    setserial \
    minicom

# Felhasználó hozzáadása a dialout csoporthoz
echo ""
echo "[6/6] Felhasználói jogosultságok..."
REAL_USER=${SUDO_USER:-$USER}
usermod -aG dialout $REAL_USER
echo "Felhasználó '$REAL_USER' hozzáadva a 'dialout' csoporthoz"

echo ""
echo "=========================================="
echo "Telepítés befejezve!"
echo "=========================================="
echo ""
echo "Következő lépések:"
echo "1. Jelentkezz ki és be újra a dialout jogosultsághoz"
echo "2. Futtasd: ./scripts/setup-rt-kernel.sh"
echo ""
