#!/usr/bin/env bash
# Generálja az OpenAPI sémát a Python bridge-ből és belőle TypeScript
# típusokat a Node.js backend és a React frontend számára.
#
# Igazság forrása: drivers/api_models.py (Pydantic) + bridge_server.py
# (FastAPI route signature-ök).
#
# Futtatás:
#   bash scripts/generate-api-types.sh
#
# Eredmény:
#   backend/src/api/bridge-openapi.json   (raw OpenAPI 3.x dokumentum)
#   backend/src/api/bridge-types.ts       (generált TS típusok — backend)
#   frontend/src/types/bridge-types.ts    (ugyanaz a generált TS — frontend)
#
# Megjegyzés: a generált fájlok HEAD-ere "do not edit by hand" jelölés.
# Ne módosítsd kézzel, futtasd újra a scriptet ha a bridge sémája változik.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

DRIVERS_DIR="$PROJECT_DIR/drivers"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

OPENAPI_JSON="$BACKEND_DIR/src/api/bridge-openapi.json"
BACKEND_TYPES="$BACKEND_DIR/src/api/bridge-types.ts"
FRONTEND_TYPES="$FRONTEND_DIR/src/types/bridge-types.ts"

PYTHON_BIN="${PYTHON_BIN:-}"
if [ -z "$PYTHON_BIN" ]; then
    if [ -x "$PROJECT_DIR/venv/bin/python3" ]; then
        PYTHON_BIN="$PROJECT_DIR/venv/bin/python3"
    elif command -v python3 > /dev/null; then
        PYTHON_BIN="python3"
    else
        echo "[!] python3 nem található és venv/bin/python3 sem létezik" >&2
        exit 1
    fi
fi

echo "==> OpenAPI séma generálása a bridge-ből"
mkdir -p "$(dirname "$OPENAPI_JSON")"
export OPENAPI_OUT="$OPENAPI_JSON"
(
    cd "$DRIVERS_DIR"
    "$PYTHON_BIN" - <<'PY'
import json
import os
import sys
sys.path.insert(0, os.getcwd())
from bridge_server import app

doc = app.openapi()
out = os.environ["OPENAPI_OUT"]
with open(out, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2, ensure_ascii=False)
print(f"  ✓ {out} ({len(doc.get('paths', {}))} path)")
PY
)

echo "==> TypeScript típusok generálása (backend + frontend)"
(
    cd "$BACKEND_DIR"
    if ! npx --yes openapi-typescript "$OPENAPI_JSON" -o "$BACKEND_TYPES" > /dev/null; then
        echo "[!] openapi-typescript futtatása sikertelen" >&2
        echo "    Tipp: npm install --save-dev openapi-typescript" >&2
        exit 1
    fi
    echo "  ✓ $BACKEND_TYPES"
)

mkdir -p "$(dirname "$FRONTEND_TYPES")"
cp "$BACKEND_TYPES" "$FRONTEND_TYPES"
echo "  ✓ $FRONTEND_TYPES"

echo "==> Kész. A generált fájlok 'do not edit by hand' headerrel kerülnek be."
