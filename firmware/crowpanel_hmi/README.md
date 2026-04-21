# CrowPanel HMI Firmware (Offline-First)

CrowPanel ESP32 1.28" firmware for standalone multi-axis HMI control of a grblHAL controller.

## Features

- Offline-first operation (no host/backend required)
- Local `config.json` for axis setup (web-style schema base)
- Local `programs/*.json` storage for teach/program mode
- Color UI with per-mode icon tags and screen-specific accents
- Demo-style Home dashboard with 3 icon cards (prev/current/next)
- Home starts on the last used menu card (stored in NVS)
- Home keeps a single menu label under each icon card (no duplicated title row)
- Active Home center card uses a true circular highlight (dynamic radius)
- Demo-style arc scale editing during value input (`Setup edit`, `Step`, `Pos`, `TeachStep`, `TeachPos`)
- Interrupt-driven quadrature encoder decoder for stable click-by-click stepping
- Touch `Return` button on every screen (plus rotary long-press fallback)
- Hybrid architecture: demo UX adapter on top of existing GRBL/storage/program core
- `Status` removed from Home; `MPG toggle` moved under `Setup` actions
- Host-priority monitor mode: when host control is detected, panel switches to monitor-only
- Modes:
  - `Setup`: axis limits/invert/scale/feed editing
  - `Step`: axis-by-axis relative move
  - `Pos`: all-axis move after full input
  - `Teach`: step/pos capture, per-step or end-block policy
  - `Program`: local program selection, run/pause/resume/stop
- GRBL command queue with realtime controls (`!`, `~`, `0x18`, `0x8B`),
  abstracted over a transport interface (UART or WiFi/TCP).
- Runtime-selectable link channel via `Setup > Panel`:
  - `uart` — wired pendant on the CrowPanel UART pins (default).
  - `wifi` — TCP/Telnet client; pairs to the grblHAL SoftAP
    (`tube_bender_1` / `panelDefault` / `192.168.4.1:23` by default; the
    SSID matches the `config/devices.yaml` device id) or joins an
    external router when `mode` is set to `sta`. The active SSID can be
    picked from a live scan list (see `Setup > Panel` below).
  - `bluetooth` — placeholder, **not supported on ESP32-S3**.
- Per-profile link configuration (channel, baud, ssid, password, host, port,
  mode), saved in `/profiles.json` on LittleFS.

## Build

```bash
cd firmware/crowpanel_hmi
pio run
```

## Upload

### Script (ajánlott)

```bash
cd firmware/crowpanel_hmi

./upload.sh              # build + upload
./upload.sh --monitor    # build + upload + serial monitor
./upload.sh --build-only # csak fordítás, nincs feltöltés
./upload.sh --no-build   # kihagyja a fordítást, csak feltölt
```

A script automatikusan megkeresi az eszközt `/dev/serial/by-id/` alatt;
ha a konfigurált port nem elérhető, visszaesik más Espressif JTAG vagy
ttyACM/ttyUSB eszközre.

### Kézi PlatformIO

```bash
cd firmware/crowpanel_hmi
pio run -t upload
pio device monitor
```

## Local files

- `/config.json`
- `/programs/<name>.json`

Program JSON format:

```json
{
  "name": "teach_1",
  "steps": [
    {
      "mode": "step",
      "axes": { "X": 10.0, "Y": 0.0, "Z": 0.0 },
      "feed": 600.0,
      "comment": "optional"
    }
  ]
}
```

## Controls

- Rotary: value / menu selection
- Short press: `OK` / next / execute / open
- Long press: unified back navigation
- Touch: on-screen `Return` button and direct arc drag on edit screens

## Host-Priority Monitor Mode

To avoid dual-writer command conflicts, this firmware uses a host-priority policy:

- If host-side control activity is detected, the panel enters monitor-only mode.
- In monitor mode, motion command paths are blocked (`Step`, `Pos`, `Teach`, `Program run`).
- The panel shows status only (`state`, axis positions, alarm/error lines).
- When host activity becomes idle for a release window, panel motion control is re-enabled.

## Setup > Panel (link channel)

The communication link to the controller is selected at runtime under
`Setup > Panel`. The screen has a vertical field list (rotate to move,
short-press to enter editing) plus an `apply` action that tears down the
current transport and brings up the new one:

- `channel` — `uart` / `wifi` / `bluetooth`
- UART branch: `baud` (preset list, default 115200), `apply`
- WiFi branch: `ssid`, `pass`, `host`, `port`, `mode` (`ap_join` or `sta`),
  `apply`. The factory-seeded profiles already pre-fill
  `pass = panelDefault`, `host = 192.168.4.1`, `port = 23`,
  `mode = ap_join`; `ssid` stays empty so the operator picks the active
  controller from the WiFi scan list.
- Bluetooth: only `apply` is shown; it surfaces a clear "BT not supported on
  ESP32-S3" status without bringing up any radio.

The `ssid` field has a special short-press behaviour: instead of opening the
character editor it launches a dedicated WiFi scan picker
(`Screen::SetupPanelSsidScan`).  The list always starts with two sticky
rows — `Rescan` (re-runs the async scan) and `Manual entry` (drops back
into the positional editor) — followed by every nearby AP in
`<ssid>  <rssi>dBm  *` form (`*` = WPA-secured).  Encoder rotate moves the
cursor; short-press copies the selected SSID into the active profile and
returns to `Setup > Panel`; long-press / on-screen Return aborts.

`pass` and `host` keep using the positional character editor:
rotate to cycle the char at the cursor, short-press to advance (auto-extends
with a space at the end of the string), long-press to commit the value and
exit the string editor. The on-screen `Return` button cancels the string
edit without saving.

The link selection is stored per profile in `/profiles.json`, so switching
profiles also re-establishes the transport for that profile.

## Pin configuration (CrowPanel side)

Display/encoder defaults are in `src/board_config.h`, based on Elecrow CrowPanel 1.28 reference.
Update `GRBL_UART_RX_PIN` and `GRBL_UART_TX_PIN` to match your CrowPanel UART connector routing.

Typical UART controller wiring:

- CrowPanel TX -> grblHAL RX (GPIO21 on this project)
- CrowPanel RX <- grblHAL TX (GPIO47 on this project)
- GND common (shared ground)

Tube-bender controller profile note:

- grblHAL map is configured for CrowPanel UART pendant + motors + E-STOP only.
- Legacy joystick/AS5600 local-panel path is not used in this setup.
- For the WiFi link, `WIFI_ENABLE=1`, `WIFI_SOFTAP=1` and `TELNET_ENABLE=1`
  are set in `firmware/grblhal-esp32/main/my_machine.h`; SSID / password /
  IP defaults are listed in `docs/tube-bender-grblhal-wiring.md`.

Alarm diagnostics:

- If status shows `Pn:E`, the E-STOP input is active.
- If status shows `Pn:Q`, single-block status flag is active.
