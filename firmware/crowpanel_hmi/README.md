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
- GRBL UART command queue with realtime controls (`!`, `~`, `0x18`, `0x8B`)

## Build

```bash
cd firmware/crowpanel_hmi
pio run
```

## Upload

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

## Pin configuration (CrowPanel side)

Display/encoder defaults are in `src/board_config.h`, based on Elecrow CrowPanel 1.28 reference.
Update `GRBL_UART_RX_PIN` and `GRBL_UART_TX_PIN` to match your CrowPanel UART connector routing.

Typical controller wiring:

- CrowPanel TX -> grblHAL RX (GPIO21 on this project)
- CrowPanel RX <- grblHAL TX (GPIO47 on this project)
- GND common (shared ground)

Tube-bender controller profile note:

- grblHAL map is configured for CrowPanel UART pendant + motors + E-STOP only.
- Legacy joystick/AS5600 local-panel path is not used in this setup.

Alarm diagnostics:

- If status shows `Pn:E`, the E-STOP input is active.
- If status shows `Pn:Q`, single-block status flag is active.
