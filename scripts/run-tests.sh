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
cd "$PROJECT_ROOT/drivers"
if [ -d "venv" ]; then
    source venv/bin/activate
else
    python3 -m venv venv
    source venv/bin/activate
    pip install -q pytest pytest-asyncio pyserial pyyaml fastapi
fi
python -m pytest tests/ -v
deactivate
echo ""

echo "=============================================="
echo "✅ Minden teszt sikeresen lefutott!"
echo "=============================================="
