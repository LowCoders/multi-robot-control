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
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Port ellenőrzés és felszabadítás
ensure_port_free() {
    local port="$1"
    local name="$2"
    local pids=$(lsof -ti :$port 2>/dev/null)
    
    if [ -n "$pids" ]; then
        echo -e "${YELLOW}[!]${NC} Port $port foglalt ($name), felszabadítás..."
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
        
        # Ellenőrzés
        pids=$(lsof -ti :$port 2>/dev/null)
        if [ -n "$pids" ]; then
            echo -e "${RED}[!]${NC} Port $port nem szabadítható fel!"
            exit 1
        fi
        echo -e "${GREEN}[✓]${NC} Port $port felszabadítva."
    fi
}

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

# Portok felszabadítása ha szükséges
echo ""
echo "Portok ellenőrzése..."
ensure_port_free 4002 "Bridge"
ensure_port_free 4001 "Backend"
ensure_port_free 4000 "Frontend"

# 1. Python Bridge indítása
echo ""
echo -e "${GREEN}[1/3]${NC} Python Bridge indítása..."
cd "$PROJECT_DIR/drivers"

# Venv létrehozása ha nem létezik (pip install csak egyszer kell)
if [ ! -d "venv" ]; then
    echo "Python virtuális környezet létrehozása..."
    python3 -m venv venv
    . venv/bin/activate
    pip install -r requirements.txt
    deactivate
fi

export DEVICES_CONFIG="$PROJECT_DIR/config/devices.yaml"
export BRIDGE_HOST="0.0.0.0"
export BRIDGE_PORT="4002"

# sg dialout biztosítja a soros port hozzáférést
# A venv aktiválás CSAK a subshell-ben történik
# Port ellenőrzés a subshell-en belül is, hogy elkerüljük a dupla indítást
sg dialout -c "
    if lsof -ti :$BRIDGE_PORT >/dev/null 2>&1; then
        echo 'Bridge már fut, kihagyás...'
        exit 0
    fi
    cd $PROJECT_DIR/drivers && . venv/bin/activate && python -m uvicorn bridge_server:app --host $BRIDGE_HOST --port $BRIDGE_PORT
" &
BRIDGE_PID=$!
echo $BRIDGE_PID > "$PIDS_DIR/bridge.pid"
echo "Bridge indítva: http://$BRIDGE_HOST:$BRIDGE_PORT (PID: $BRIDGE_PID)"

# Várakozás a bridge indulására
echo "Várakozás a bridge-re..."
for i in {1..30}; do
    if curl -s http://localhost:$BRIDGE_PORT/ >/dev/null 2>&1; then
        echo -e "${GREEN}[✓]${NC} Bridge elérhető"
        break
    fi
    sleep 1
done

# Extra idő az eszközök csatlakozásához
sleep 3

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
echo "Backend indítva: http://localhost:4001"

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

npm run dev -- --port 4000 --strictPort &
echo $! > "$PIDS_DIR/frontend.pid"
echo "Frontend indítva: http://localhost:4000"

echo ""
echo "=========================================="
echo -e "${GREEN}Minden szolgáltatás fut!${NC}"
echo "=========================================="
echo ""
echo "  Web Interface: http://localhost:4000"
echo "  Backend API:   http://localhost:4001/api"
echo "  Bridge API:    http://localhost:4002"
echo ""
echo "Leállítás: Ctrl+C vagy ./scripts/stop-all.sh"
echo ""

# Várakozás
wait
