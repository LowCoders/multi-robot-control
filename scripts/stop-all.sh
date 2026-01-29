#!/bin/bash
# stop-all.sh
# Minden szolgáltatás leállítása

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Multi-Robot Control System - Leállítás"
echo "=========================================="

# Színek
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# PID fájlok
PIDS_DIR="$PROJECT_DIR/.pids"

stop_service() {
    local name="$1"
    local pid_file="$PIDS_DIR/$2.pid"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo -e "${YELLOW}[$name]${NC} Leállítás (PID: $pid)..."
            kill "$pid" 2>/dev/null
            
            # Várakozás a leállásra (max 5 másodperc)
            local count=0
            while kill -0 "$pid" 2>/dev/null && [ $count -lt 10 ]; do
                sleep 0.5
                count=$((count + 1))
            done
            
            # Ha még mindig fut, kényszerített leállítás
            if kill -0 "$pid" 2>/dev/null; then
                echo -e "${RED}[$name]${NC} Kényszerített leállítás..."
                kill -9 "$pid" 2>/dev/null
            fi
            
            echo -e "${GREEN}[$name]${NC} Leállítva."
        else
            echo -e "${YELLOW}[$name]${NC} Már nem fut."
        fi
        rm -f "$pid_file"
    else
        echo -e "${YELLOW}[$name]${NC} Nincs futó folyamat (PID fájl nem található)."
    fi
}

# Ellenőrizzük, hogy van-e .pids könyvtár
if [ ! -d "$PIDS_DIR" ]; then
    echo ""
    echo "Nincs futó szolgáltatás (${PIDS_DIR} nem létezik)."
    echo ""
    exit 0
fi

echo ""

# 1. Frontend leállítása
stop_service "Frontend" "frontend"

# 2. Backend leállítása
stop_service "Backend" "backend"

# 3. Bridge leállítása
stop_service "Bridge" "bridge"

# További node/python folyamatok keresése a portok alapján
echo ""
echo "Árva folyamatok keresése..."

# Keresés port alapján
check_port() {
    local port="$1"
    local name="$2"
    local pids=$(lsof -ti :$port 2>/dev/null)
    if [ -n "$pids" ]; then
        echo -e "${YELLOW}[$name]${NC} Folyamat található a $port porton, leállítás..."
        echo "$pids" | xargs kill 2>/dev/null || true
    fi
}

check_port 4000 "Frontend (4000)"
check_port 4001 "Backend (4001)"
check_port 4002 "Bridge (4002)"

# Cleanup
if [ -d "$PIDS_DIR" ] && [ -z "$(ls -A "$PIDS_DIR" 2>/dev/null)" ]; then
    rmdir "$PIDS_DIR" 2>/dev/null || true
fi

echo ""
echo "=========================================="
echo -e "${GREEN}Minden szolgáltatás leállítva.${NC}"
echo "=========================================="
echo ""
