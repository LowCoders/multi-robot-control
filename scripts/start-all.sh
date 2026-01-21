#!/bin/bash
# start-all.sh
# Minden szolgáltatás indítása

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Multi-Robot Control System"
echo "=========================================="

# Színek
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# PID fájlok
PIDS_DIR="$PROJECT_DIR/.pids"
mkdir -p "$PIDS_DIR"

# Cleanup függvény
cleanup() {
    echo ""
    echo "Leállítás..."
    
    # Bridge
    if [ -f "$PIDS_DIR/bridge.pid" ]; then
        kill $(cat "$PIDS_DIR/bridge.pid") 2>/dev/null || true
        rm "$PIDS_DIR/bridge.pid"
    fi
    
    # Backend
    if [ -f "$PIDS_DIR/backend.pid" ]; then
        kill $(cat "$PIDS_DIR/backend.pid") 2>/dev/null || true
        rm "$PIDS_DIR/backend.pid"
    fi
    
    # Frontend
    if [ -f "$PIDS_DIR/frontend.pid" ]; then
        kill $(cat "$PIDS_DIR/frontend.pid") 2>/dev/null || true
        rm "$PIDS_DIR/frontend.pid"
    fi
    
    echo "Leállítva."
    exit 0
}

trap cleanup SIGINT SIGTERM

# 1. Python Bridge indítása
echo ""
echo -e "${GREEN}[1/3]${NC} Python Bridge indítása..."
cd "$PROJECT_DIR/drivers"
if [ ! -d "venv" ]; then
    echo "Python virtuális környezet létrehozása..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

export DEVICES_CONFIG="$PROJECT_DIR/config/devices.yaml"
export BRIDGE_HOST="0.0.0.0"
export BRIDGE_PORT="8001"

python -m uvicorn bridge_server:app --host $BRIDGE_HOST --port $BRIDGE_PORT &
echo $! > "$PIDS_DIR/bridge.pid"
echo "Bridge indítva: http://$BRIDGE_HOST:$BRIDGE_PORT"

# Várakozás a bridge indulására
sleep 2

# 2. Node.js Backend indítása
echo ""
echo -e "${GREEN}[2/3]${NC} Node.js Backend indítása..."
cd "$PROJECT_DIR/backend"
if [ ! -d "node_modules" ]; then
    echo "NPM függőségek telepítése..."
    npm install
fi

npm run dev &
echo $! > "$PIDS_DIR/backend.pid"
echo "Backend indítva: http://localhost:3001"

# Várakozás a backend indulására
sleep 2

# 3. Frontend indítása
echo ""
echo -e "${GREEN}[3/3]${NC} Frontend indítása..."
cd "$PROJECT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    echo "NPM függőségek telepítése..."
    npm install
fi

npm run dev &
echo $! > "$PIDS_DIR/frontend.pid"
echo "Frontend indítva: http://localhost:3000"

echo ""
echo "=========================================="
echo -e "${GREEN}Minden szolgáltatás fut!${NC}"
echo "=========================================="
echo ""
echo "  Web Interface: http://localhost:3000"
echo "  Backend API:   http://localhost:3001/api"
echo "  Bridge API:    http://localhost:8001"
echo ""
echo "Leállítás: Ctrl+C"
echo ""

# Várakozás
wait
