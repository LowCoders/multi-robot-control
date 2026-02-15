#!/bin/bash
# Multi-Robot Control System - Teljes teszt futtatás
# Futtatás: ./scripts/run-tests.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=============================================="
echo "Multi-Robot Control System - Tesztek futtatása"
echo "=============================================="
echo ""

# Backend tesztek
echo "📦 Backend tesztek..."
echo "----------------------------------------------"
cd "$PROJECT_ROOT/backend"
npm test
echo ""

# Frontend tesztek
echo "🎨 Frontend tesztek..."
echo "----------------------------------------------"
cd "$PROJECT_ROOT/frontend"
npm test
echo ""

# Python driver tesztek
echo "🔌 Python driver tesztek..."
echo "----------------------------------------------"

DRIVERS_DIR="$PROJECT_ROOT/drivers"
VENV_DIR="$DRIVERS_DIR/venv"

# Venv létrehozása ha nem létezik
if [ ! -d "$VENV_DIR" ]; then
    echo "Python virtuális környezet létrehozása..."
    python3 -m venv "$VENV_DIR"
fi

# Csomagok telepítése ha pytest hiányzik
if ! "$VENV_DIR/bin/python3" -c "import pytest" 2>/dev/null; then
    echo "Python csomagok telepítése..."
    "$VENV_DIR/bin/pip" install --upgrade pip
    "$VENV_DIR/bin/pip" install -r "$DRIVERS_DIR/requirements.txt"
fi

# Tesztek futtatása
"$VENV_DIR/bin/python3" -m pytest "$DRIVERS_DIR/tests/" -v
echo ""

echo "=============================================="
echo "✅ Minden teszt sikeresen lefutott!"
echo "=============================================="
