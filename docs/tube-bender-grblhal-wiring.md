# Tube Bender grblHAL Wiring

This project uses the `grblhal-esp32` firmware path for the tube bender controller.
The legacy standalone `firmware/tube_bender` implementation has been removed.

## Active Hardware Topology

- Tube Bender controller: ESP32-S3 running `firmware/grblhal-esp32`
- HMI: CrowPanel ESP32-S3 1.28" (UART pendant/MPG stream)
- Motion: 3 step/dir axes (X=push, Y=bend, Z=rotate)
- Safety: dedicated E-STOP input

No external joystick, AS5600-M module, or separate encoder-button panel is used in this profile.

## Controller Pin Map (grblHAL side)

Reference files:

- `firmware/grblhal-esp32/main/my_machine.h`
- `firmware/grblhal-esp32/main/boards/my_machine_map.h`

Axis outputs:

- X step/dir: `GPIO4` / `GPIO5`
- Y step/dir: `GPIO6` / `GPIO7`
- Z step/dir: `GPIO15` / `GPIO16`
- Shared enable: `GPIO17`

CrowPanel UART link:

- ESP32 TX (`UART1_TX_PIN`): `GPIO47` -> CrowPanel RX
- ESP32 RX (`UART1_RX_PIN`): `GPIO21` <- CrowPanel TX
- Common GND is required
- Baud: `115200`

Safety input:

- E-STOP input: `GPIO38` (mapped to `RESET_PIN`/halt control path)

## Runtime Diagnostics

Use realtime status (`?`) and inspect `Pn:` flags:

- `Pn:E` -> E-STOP input is active
- `Pn:Q` -> single-block state flag is active in status report path

Important: if `Pn:E` is active, unlock and motion commands are blocked (`error:79`, then motion lock errors).

## Host vs CrowPanel Control Policy

This project now uses a host-priority single-writer policy:

- If host control is active on `/dev/ttyACM0`, CrowPanel enters monitor-only mode.
- In monitor-only mode, CrowPanel does not send motion commands (Step/Pos/Teach/Program).
- CrowPanel still displays runtime status (`state`, axis positions, alarm reason/error line).
- After host activity stops and idle timeout expires, panel motion control is enabled again.

## Typical Checks

1. Verify `Pn:E` is not active when E-STOP is released.
2. Confirm CrowPanel UART cross-wiring (`47 -> RX`, `21 <- TX`) and shared ground.
3. Confirm pendant stream is on `115200`.
4. Validate grblHAL identity on controller USB:
   - `$I` should include `[FIRMWARE:grblHAL]`.
