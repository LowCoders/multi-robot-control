# Tube Bender grblHAL Wiring

This project uses the `grblhal-esp32` firmware path for the tube bender controller.
The legacy standalone `firmware/tube_bender` implementation has been removed.

## Active Hardware Topology

- Tube Bender controller: ESP32-S3 running `firmware/grblhal-esp32`
- HMI: CrowPanel ESP32-S3 1.28" (UART pendant/MPG stream **or** WiFi/TCP via grblHAL SoftAP)
- Motion: 3 step/dir axes (X=push, Y=bend, Z=rotate)
- Safety: dedicated E-STOP input

No external joystick, AS5600-M module, or separate encoder-button panel is used in this profile.

The CrowPanel ↔ controller link is runtime-selectable from the panel UI (`Setup > Panel`):

- `uart` — wired pendant on UART1 (legacy default, shipped wiring).
- `wifi` — TCP/Telnet stream over the grblHAL SoftAP, no router required.
- `bluetooth` — placeholder; **not supported on ESP32-S3** (Classic SPP only
  exists on ESP32 classic; grblHAL's BLE driver is upstream-marked
  work-in-progress in `firmware/grblhal-esp32/main/bluetooth_le.c`).

## Controller Pin Map (grblHAL side)

Reference files:

- `firmware/grblhal-esp32/main/my_machine.h`
- `firmware/grblhal-esp32/main/boards/my_machine_map.h`

### Egységes GPIO kiosztás (ESP32-S3)

| GPIO | Funkció                  | Irány | Csoport         | Megjegyzés                                                  |
|------|--------------------------|-------|-----------------|-------------------------------------------------------------|
| 4    | `X_STEP_PIN`             | OUT   | Motion / X      | Push tengely step                                           |
| 5    | `X_DIRECTION_PIN`        | OUT   | Motion / X      | Push tengely dir                                            |
| 6    | `Y_STEP_PIN`             | OUT   | Motion / Y      | Bend tengely step                                           |
| 7    | `Y_DIRECTION_PIN`        | OUT   | Motion / Y      | Bend tengely dir                                            |
| 15   | `Z_STEP_PIN`             | OUT   | Motion / Z      | Rotate tengely step                                         |
| 16   | `Z_DIRECTION_PIN`        | OUT   | Motion / Z      | Rotate tengely dir                                          |
| 17   | `STEPPERS_ENABLE_PIN`    | OUT   | Motion / közös  | Aktív LOW (firmware $4 maszk invertálható)                  |
| 8    | `UART1_RX_PIN`           | IN    | UART1 / HMI     | CrowPanel pendant TX -> ESP32 RX                            |
| 18   | `UART1_TX_PIN`           | OUT   | UART1 / HMI     | CrowPanel pendant RX <- ESP32 TX, 115200 baud               |
| 21   | `UART2_RX_PIN`           | IN    | UART2 / CL      | Closed-loop driver TX -> ESP32 RX (lásd lent)               |
| 47   | `UART2_TX_PIN`           | OUT   | UART2 / CL      | Closed-loop driver RX <- ESP32 TX, alapértelmezetten 38400  |
| 43   | `U0TXD` (USB-UART híd)   | OUT   | UART0 / host    | `/dev/ttyACM0` host kommunikáció                            |
| 44   | `U0RXD` (USB-UART híd)   | IN    | UART0 / host    | `/dev/ttyACM0` host kommunikáció                            |
| 9    | `AUXOUTPUT4_PIN`         | OUT   | Aux             | Coolant mist (jelenleg nem használt)                        |
| 10   | `AUXOUTPUT3_PIN`         | OUT   | Aux             | Coolant flood (jelenleg nem használt)                       |
| 45   | `AUXOUTPUT2_PIN`         | OUT   | Aux / Spindle   | Spindle direction (profilban kikapcsolva)                   |
| 46   | `AUXOUTPUT1_PIN`         | OUT   | Aux / Spindle   | Spindle enable (profilban kikapcsolva)                      |
| 48   | `AUXOUTPUT5_PIN`         | OUT   | Aux / RS485     | DE/RE a RS485-CAN-TTL átalakítóhoz (Topológia B)            |
| 38   | E-STOP input (tervezett) | IN    | Safety          | Jelenleg kikapcsolva (lásd alább); GPIO38 hamis Pn:E hiba  |
| 0    | Strapping (boot mode)    | -     | Foglalt         | Ne használd I/O-ra                                          |
| 19,20| USB DM/DP                | -     | Foglalt         | Ne használd I/O-ra                                          |

Tartalék/szabad: GPIO11, 12, 13, 14, 39, 40, 41, 42 (jövőbeli kiterjesztésekhez).

Safety input:

- E-STOP input: `GPIO38` (mapped to `RESET_PIN`/halt control path) — **jelenleg kikapcsolva**
  a `my_machine_map.h`-ban a perzisztens hamis-aktív Pn:E miatt; csak a fizikai bekötés és pull-up
  ellenőrzése után aktiválandó újra.

## Closed-loop feedback bekötés (UART2)

A closed-loop driverek (alapértelmezetten MKS SERVO42C) pozíció- és státuszadatait a
grblHAL controller olvassa be a SERIAL2 portján és a `?` realtime status report
kiterjesztésében (`|CL:` és `|CLst:` mezők) adja vissza a hosztnak. Az implementáció
a `firmware/grblhal-esp32/main/plugins/closed_loop_feedback.c` plugin, amelyet a
`my_machine.h`-ban a `CLOSED_LOOP_FEEDBACK_ENABLE` makró kapcsol be.

Engedélyezés:

```c
#define CLOSED_LOOP_FEEDBACK_ENABLE     1
//#define CLOSED_LOOP_FEEDBACK_TOPOLOGY 2   // csak Topológia B esetén
//#define MODBUS_ENABLE                 2   // csak Topológia B esetén (DE/RE jel)
```

### Topológia A — közvetlen TTL UART (SERVO42C bus)

Half-duplex 38400 baud bus, közös TX/RX vonal a driverekhez. Mindegyik SERVO42C
egyedi `Uart Address`-t kap (1, 2, 3 …), és a plugin round-robin pollingot végez.

```
ESP32-S3                              SERVO42C bus
                                  ┌────────────┐  ┌────────────┐  ┌────────────┐
GPIO47 (UART2 TX) ──────┬────────►│  RX  addr1 │  │  RX  addr2 │  │  RX  addr3 │
                        │         │            │  │            │  │            │
GPIO21 (UART2 RX) ◄─────┼────┬────│  TX        │──│  TX        │──│  TX        │
                        │    │    └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
GND ────────────────────┼────┼──────────┴───────────────┴───────────────┘
                        │    │
                        │    └── pull-up a busz HIGH idle-höz:
                        │         - belső ESP32 pull-up (~45 kΩ) rövid buszra elég, VAGY
                        │         - külső 4.7 kΩ → 3.3 V (ajánlott 4+ driver / hosszabb kábel)
                        └─────── szükség esetén ide is pull-up (azonos vonal)
```

Megjegyzések:
- A SERVO42C TX-ek lényegében open-drain logikájúak; a közös vonalra pull-upra
  van szükség, hogy a busz idle-ben HIGH legyen. Az `my_machine.h`-ban a
  `CLOSED_LOOP_RX_PULLUP = 1` **alapértelmezetten be van kapcsolva**, így a
  plugin az init után meghívja a `gpio_set_pull_mode(UART2_RX_PIN, GPIO_PULLUP_ONLY)`-t.
  - **Belső ESP32 pull-up (~45 kΩ, alapértelmezett)** — elég rövid buszra
    (≲30 cm, 1–3 driver). 100 pF kapacitásnál τ ≈ 4.5 µs ≈ 17% bit-idő —
    a 38400 baud (26 µs) határán még üzembiztos.
  - **Külső 4.7 kΩ a 3.3 V-ra** — hosszabb buszra (>30 cm), 4+ driverhez,
    zajos környezetbe ajánlott. Ekkor `#define CLOSED_LOOP_RX_PULLUP 0`-val
    kapcsold ki a belsőt, és építsd be a külsőt a busz egyik végéhez.
    Rise time ≈ 0.47 µs (~2% bit-idő) — sokkal nagyobb noise margin.
- Közös GND a 12 V tápról kötelező.
- A driver `Uart` paraméterét állítsd 38400 baudra; a `closed_loop_feedback.c`
  alapértelmezetten ezt használja (`CLOSED_LOOP_FEEDBACK_BAUD`).

### Topológia B — RS485 átalakító kártya (RS485-CAN-TTL modul)

A modul TTL felét kötjük az ESP32-höz, a RS485 felét a driverek differenciális
buszára. A `DE`+`RE` lábakat a `GPIO48 / AUXOUTPUT5` billenti adás előtt.

```
ESP32-S3                  RS485-CAN-TTL modul                RS485 driver bus
                          ┌────────────────────┐              ┌────────┐
GPIO47 (UART2 TX) ───────►│ RXD (TTL be)   A   │──── A ───────│ A      │── 120Ω ──┐
                          │                    │              │        │          │
GPIO21 (UART2 RX) ◄───────│ TXD (TTL ki)   B   │──── B ───────│ B      │          │
                          │                    │              └────────┘          │
GPIO48 (AUXOUT5)  ───────►│ DE+RE (összekötve) │   közös GND a driverekkel        │
                          │                    │                                  │
+5V ─────────────────────►│ VCC                │ 120Ω lezárás a busz végén ───────┘
GND ─────────────────────►│ GND                │
                          └────────────────────┘
```

Megjegyzések:
- A `DE` és `RE` lábakat a modulon kötjük rövidre, így egyetlen jellel adás/vétel
  váltható: HIGH = TX (driver enable), LOW = RX (receiver enable).
- A modul CAN felét nem használjuk; CANH/CANL lábak hagyhatók szabadon.
- 120 Ω lezáró ellenállás a busz **mindkét** végén, valamint optionally
  bias-rezisztorok (680 Ω fail-safe) az A és B vonalon a tápra/GND-re.
- A grblHAL `MODBUS_ENABLE = 2` mód a DE/RE-t automatikusan kezeli, ha a driver
  Modbus RTU-t beszél; bináris (MKS) protokolnál a `closed_loop_feedback.c`
  `cl_rs485_tx_enable()` hívása végzi a billentést.
- Közös GND a 12 V driver-tápról és az ESP32-ről kötelező.

### Pull-up audit — bemenetek

A teljesség kedvéért a profil többi bemenetén is megvizsgáltuk, kell-e belső pull-up:

| Pin | Funkció | Külső driver | Pull-up szükséges? | Megoldás |
|------|---------|--------------|--------------------|----------|
| GPIO21 | `UART2_RX` (closed-loop bus) | SERVO42x open-drain TX, multi-drop | igen | `CLOSED_LOOP_RX_PULLUP=1` (alapért. be) |
| GPIO8  | `UART1_RX` (CrowPanel pendant) | CrowPanel push-pull TX | nem | nincs teendő |
| GPIO44 | `U0RXD` (USB-UART híd) | CH340 push-pull | nem | nincs teendő |
| GPIO38 | E-STOP (jelenleg kikapcsolva) | NC kontaktus → szabadon ↔ GND | igen | a grblHAL keret már automatikusan beállítja, ha a pin control-signalként regisztrálva van (`PullMode_Up` → `GPIO_PULLUP_ENABLE`, `firmware/grblhal-esp32/main/driver.c` 2989. sor). A jelenlegi persistent `Pn:E` ettől független — vélhetően vezetékezési/polaritás hiba. |
| step / dir / enable / AUX outputok | — | output | n/a | n/a |

Tanulság: csak a UART2 RX-et kell „kézzel" pull-upozni a plugin init-ből, mert
azt nem a control-signal keret kezeli.

### Status report kiterjesztés

A plugin a `?` válasz végére fűzi (példa, X=12.500°, Y=−45.250°, Z=0.000°,
összes axis ok):

```
<Idle|MPos:12.500,-45.250,0.000|FS:0,0|Pn:|CL:12.500,-45.250,0.000|CLst:1,1,1>
```

A hoszt oldali Python driver (`drivers/grbl_base.py` és
`drivers/capabilities/closed_loop.py`) ezeket a kiterjesztett mezőket fogja
parsolni a következő iterációban; ld. `config/devices.yaml`
`closed_loop_feedback` szekció.

## Runtime Diagnostics

Use realtime status (`?`) and inspect `Pn:` flags:

- `Pn:E` -> E-STOP input is active
- `Pn:Q` -> single-block state flag is active in status report path

Important: if `Pn:E` is active, unlock and motion commands are blocked (`error:79`, then motion lock errors).

## CrowPanel WiFi link (SoftAP)

The grblHAL controller also exposes a TCP/Telnet stream over its own WiFi
SoftAP, which the CrowPanel HMI can use instead of the wired UART pendant.

Controller-side configuration (already enabled in
`firmware/grblhal-esp32/main/my_machine.h`):

| Symbol                  | Value          | Purpose                                  |
|-------------------------|----------------|------------------------------------------|
| `WIFI_ENABLE`           | `1`            | Enable the WiFi stack.                   |
| `WIFI_SOFTAP`           | `1`            | Run as access point (no router needed).  |
| `TELNET_ENABLE`         | `1`            | Raw TCP grblHAL stream on port 23.       |
| `NETWORK_AP_SSID`       | `tube_bender_1` | SSID the CrowPanel pairs to (== `config/devices.yaml` device id). |
| `NETWORK_AP_PASSWORD`   | `panelDefault` | WPA2 passphrase (project-wide CrowPanel default). |
| `NETWORK_AP_HOSTNAME`   | `tube_bender_1` | mDNS hostname (matches device id).      |
| `NETWORK_AP_IP`         | `192.168.4.1`  | Default SoftAP IP, do not change.        |
| `NETWORK_TELNET_PORT`   | `23`           | Default raw stream port.                 |

UART1 pendant (`GPIO18`/`GPIO8`, 115200 baud), USB CDC host stream
(`/dev/ttyACM0`) and the `closed_loop_feedback` plugin on UART2 are
unaffected — they remain available in parallel and the grblHAL stream
multiplexer accepts whichever channel is talking. Host-priority single-writer
policy continues to apply across all streams.

Panel-side workflow (`Setup > Panel` on CrowPanel):

1. `channel` → `wifi`
2. `ssid` → short-press the field to launch the **WiFi scan picker** (see
   below). Select `tube_bender_1` from the list of nearby APs to bind it to
   the active profile. Use `Manual entry` if the controller is out of range
   and you want to type the SSID yourself.
3. `pass` → `panelDefault` (already the default in seeded profiles)
4. `host` → `192.168.4.1`
5. `port` → `23`
6. `mode` → `ap_join` (panel joins the controller SoftAP) — choose `sta` if
   both ends are routed via an external WiFi router instead.
7. `apply` → tears down the active transport and brings up the new one;
   status is shown on the yellow `infoLine` (`UART 115200`,
   `WiFi: wifi up 192.168.4.1`, `WiFi: tcp fail …`, etc.).

Settings are stored per profile in `profiles.json` (LittleFS), so different
machine profiles can use different transports.  The seeded default profiles
already pre-fill `password = panelDefault`, `host = 192.168.4.1`, `port = 23`
and `wifi_mode = ap_join`; the `channel` stays at `uart` until the operator
explicitly switches it.

WiFi scan picker (`Screen::SetupPanelSsidScan`):

- Triggered automatically when the user short-presses the `ssid` field on
  `Setup > Panel`.
- The first two list rows are sticky controls: `Rescan` re-runs the
  asynchronous scan, `Manual entry` falls back to the positional character
  editor (handy for hidden SSIDs or pre-deployment provisioning when no AP
  is up yet).
- All other rows are real scan results in `<ssid>  <rssi>dBm  *` format
  (the trailing `*` marks WPA-secured APs).  Encoder rotate moves the
  cursor, short-press copies the selected SSID into the active profile and
  returns to `Setup > Panel`; long-press / on-screen Return aborts.

`pass` and `host` keep using the original positional character editor:
rotate to cycle the character at the cursor, short-press to advance
(auto-extends the buffer with a space when at the end), long-press to commit
the value and exit the string editor. The on-screen `Return` button cancels
the string edit without saving.

Host-frontend mirror (`Gép Konfiguráció > Hálózat (WiFi)`):

The host `MachineConfigTab` exposes a `Hálózat` section for grbl-compatible
devices that reads/writes the same parameters via grblHAL networking
settings (`$71` hostname, `$73` mode, `$74`/`$75` AP SSID/pass,
`$76`/`$77` STA SSID/pass, `$300` Telnet port).  The `Reset to defaults`
button copies `device.id` into the SSID/hostname fields and `panelDefault`
into both passwords, then `Apply to controller` POSTs the diff to
`POST /api/devices/:id/grbl-settings/batch` (which now accepts string
values too, not just numerics).  A controller reboot may be required for
WiFi changes to take effect.

## Host vs CrowPanel Control Policy

This project now uses a host-priority single-writer policy:

- If host control is active on `/dev/ttyACM0`, CrowPanel enters monitor-only mode.
- In monitor-only mode, CrowPanel does not send motion commands (Step/Pos/Teach/Program).
- CrowPanel still displays runtime status (`state`, axis positions, alarm reason/error line).
- After host activity stops and idle timeout expires, panel motion control is enabled again.

## Typical Checks

1. Verify `Pn:E` is not active when E-STOP is released.
2. Confirm CrowPanel UART cross-wiring (`GPIO18 -> CrowPanel RX`, `GPIO8 <- CrowPanel TX`) and shared ground.
3. Confirm pendant stream is on `115200`.
4. Validate grblHAL identity on controller USB:
   - `$I` should include `[FIRMWARE:grblHAL]`.
5. (Closed-loop feedback) Confirm `?` válasz tartalmazza a `|CL:` és `|CLst:` mezőket.
   Ha `|CLst:0,0,0`, ellenőrizd: SERVO42C addressek, baudrate (38400), GND, illetve
   Topológia B esetén a DE/RE jel polaritása.
