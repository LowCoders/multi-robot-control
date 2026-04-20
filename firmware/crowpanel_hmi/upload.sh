#!/usr/bin/env bash
# CrowPanel HMI firmware upload script
# Usage: ./upload.sh [--build-only | --monitor | --no-build | --wipe-config]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIO_PROJECT="$SCRIPT_DIR"
ENV="crowpanel_128"

# Default port from platformio.ini (by-id path is stable across reboots)
DEFAULT_PORT="usb-Espressif_USB_JTAG_serial_debug_unit_3C:0F:02:DB:EB:E4-if00"
DEFAULT_PORT_PATH="/dev/serial/by-id/$DEFAULT_PORT"

BUILD_ONLY=0
MONITOR=0
NO_BUILD=0
WIPE_CONFIG=0

# ── arg parsing ────────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --build-only)  BUILD_ONLY=1 ;;
    --monitor)     MONITOR=1 ;;
    --no-build)    NO_BUILD=1 ;;
    --wipe-config) WIPE_CONFIG=1 ;;
    -h|--help)
      echo "Usage: $0 [--build-only | --monitor | --no-build | --wipe-config]"
      echo ""
      echo "  (no flags)     build + upload"
      echo "  --build-only   only compile, skip upload"
      echo "  --no-build     skip compile, upload only (use cached .pio build)"
      echo "  --monitor      after upload open serial monitor (Ctrl-C to exit)"
      echo "  --wipe-config  erase entire flash before upload (resets profiles to defaults)"
      echo "                 USE THIS ON FIRST FLASH or to factory-reset stored profiles."
      exit 0
      ;;
    *)
      echo "Unknown option: $arg  (use --help for usage)" >&2
      exit 1
      ;;
  esac
done

# ── dependency check ───────────────────────────────────────────────────────────
if ! command -v pio &>/dev/null; then
  echo "ERROR: 'pio' not found. Install PlatformIO Core:" >&2
  echo "  pip install platformio" >&2
  exit 1
fi

# ── port resolution ────────────────────────────────────────────────────────────
resolve_port() {
  # 1. prefer the exact by-id path from platformio.ini
  if [[ -e "$DEFAULT_PORT_PATH" ]]; then
    echo "$DEFAULT_PORT_PATH"
    return
  fi

  # 2. scan /dev/serial/by-id for any Espressif JTAG device
  local found
  found=$(ls /dev/serial/by-id/usb-Espressif_USB_JTAG* 2>/dev/null | head -n1)
  if [[ -n "$found" ]]; then
    echo "$found"
    return
  fi

  # 3. fall back to any ttyACM / ttyUSB
  found=$(ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | head -n1)
  if [[ -n "$found" ]]; then
    echo "$found"
    return
  fi

  echo ""
}

# ── build ──────────────────────────────────────────────────────────────────────
if [[ "$NO_BUILD" -eq 0 ]]; then
  echo "==> Building firmware (env: $ENV)..."
  pio run -e "$ENV" --project-dir "$PIO_PROJECT"
  echo "==> Build OK"
fi

[[ "$BUILD_ONLY" -eq 1 ]] && { echo "==> Build-only mode, exiting."; exit 0; }

# ── upload ─────────────────────────────────────────────────────────────────────
PORT="$(resolve_port)"

if [[ -z "$PORT" ]]; then
  echo "ERROR: No CrowPanel/ESP32 serial device found." >&2
  echo "  • Make sure the USB cable is plugged in and the device is powered." >&2
  echo "  • On Linux you may need: sudo usermod -aG dialout \$USER  (then re-login)" >&2
  exit 1
fi

if [[ "$WIPE_CONFIG" -eq 1 ]]; then
  echo "==> Erasing flash on $PORT (wipe profiles to factory defaults)..."
  pio run -e "$ENV" --project-dir "$PIO_PROJECT" -t erase \
    --upload-port "$PORT"
  echo "==> Erase complete"
fi

echo "==> Uploading to: $PORT"
pio run -e "$ENV" --project-dir "$PIO_PROJECT" -t upload \
  --upload-port "$PORT"
echo "==> Upload complete"

# ── optional monitor ───────────────────────────────────────────────────────────
if [[ "$MONITOR" -eq 1 ]]; then
  echo "==> Opening serial monitor on $PORT  (Ctrl-C to exit)"
  pio device monitor --port "$PORT" --baud 115200
fi
