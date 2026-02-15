# Robot Arm Motor Bekötési Dokumentáció

## Áttekintés

4-tengelyes ipari robotkar (Red Sun Global kompatibilis) bekötése Arduino Uno + CNC Shield v3 vezérlőhöz GRBL firmware-rel.

## Hardver komponensek

| Komponens | Típus | Megjegyzés |
|-----------|-------|------------|
| Mikrokontroller | Arduino Uno | ATmega328P |
| Motor driver | CNC Shield v3 | 4x A4988 driver |
| J1, J2, J3 motorok | NEMA17 | Bipoláris stepper |
| J4 motor | 28BYJ-48 (12V) | Unipoláris → bipoláris átalakítva |
| Gripper | Szervó motor | PWM vezérelt |
| Sucker | Relé modul | Digitális ki/be |

## Motor → GRBL tengely mapping

A fizikai bekötés és a logikai tengelyek közötti kapcsolat:

| Robot Joint | Funkció | GRBL tengely | CNC Shield kimenet | Arduino Pin |
|-------------|---------|--------------|-------------------|-------------|
| **J1** | Bázis forgás | **Z** | Z Step/Dir | D4 (step), D7 (dir) |
| **J2** | Váll | **X** | X Step/Dir | D2 (step), D5 (dir) |
| **J3** | Könyök | **Y** | Y Step/Dir | D3 (step), D6 (dir) |
| **J4** | Csukló (wrist) | **A** | A Step/Dir | D12 (step), D13 (dir) |

### Végeffektorok

| Eszköz | GRBL funkció | CNC Shield | Arduino Pin | G-code |
|--------|--------------|------------|-------------|--------|
| Gripper (szervó) | Spindle PWM | SpnEn | D11 | `M3 S{pwm}` / `M5` |
| Sucker (relé) | Coolant | Coolant | A3 | `M7` / `M9` |

### Enable pin

- Közös enable: **D8** (LOW = motorok engedélyezve)

## G-code → Joint mapping

```
GRBL parancs:  G1 X{j2} Y{j3} Z{j1} A{j4} F{speed}
                  │     │     │     │
                  │     │     │     └─► J4 csukló (28BYJ-48)
                  │     │     └───────► J1 bázis
                  │     └─────────────► J3 könyök
                  └───────────────────► J2 váll
```

### Példa mozgások

```gcode
; J1 bázis 45 fokkal
G1 Z45 F100

; J2 váll 30 fokkal
G1 X30 F100

; J3 könyök -15 fokkal
G1 Y-15 F100

; J4 csukló 90 fokkal
G1 A90 F50

; Összes tengely egyszerre
G1 X30 Y-15 Z45 A90 F100
```

## CNC Shield v3 pin kiosztás

```
Arduino Uno + CNC Shield v3

                    USB
                     │
    ┌────────────────┴────────────────┐
    │                                  │
    │   ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
    │   │  X  │ │  Y  │ │  Z  │ │  A  │
    │   │A4988│ │A4988│ │A4988│ │A4988│
    │   └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘
    │      │       │       │       │
    │      J2      J3      J1      J4
    │    (váll)  (köny)  (bázis) (csukló)
    │                                  │
    │   ┌────────────┐  ┌────────────┐ │
    │   │  SpnEn     │  │  Coolant   │ │
    │   │   D11      │  │    A3      │ │
    │   │  Gripper   │  │   Sucker   │ │
    │   └────────────┘  └────────────┘ │
    │                                  │
    │   ┌────────────┐                 │
    │   │  Enable    │                 │
    │   │    D8      │                 │
    │   │  (közös)   │                 │
    │   └────────────┘                 │
    │                                  │
    └──────────────────────────────────┘
```

## J4 tengely - 28BYJ-48 bekötés

A 28BYJ-48 unipoláris stepper motor átalakítása szükséges az A4988 bipoláris driverhez.

### Vezeték bekötés (bipoláris mód)

A motor csatlakozójának eredeti sorrendje (balról jobbra):

| Pozíció | Szín | Bekötés | A4988 pin |
|---------|------|---------|-----------|
| 1 | **Piros** | **NEM KÖTJÜK BE** | - |
| 2 | Narancssárga | B tekercs | 2B |
| 3 | Sárga | A tekercs | 1B |
| 4 | Rózsaszín | B tekercs | 2A |
| 5 | Kék | A tekercs | 1A |

### Bekötési diagram

```
28BYJ-48 csatlakozó:              A4988 (CNC Shield A-tengely):
                              
┌─────────────────────────┐       ┌─────────────────────────┐
│  P   N   S   R   K      │       │                         │
│  I   A   Á   Ó   É      │       │  1B    1A    2A    2B   │
│  R   R   R   Z   K      │       │   │     │     │     │   │
│  O   A   G   S   │      │       └───┼─────┼─────┼─────┼───┘
│  S   N   A   A   │      │           │     │     │     │
│      C           │      │           │     │     │     │
└──┬───┬───┬───┬───┬──────┘           │     │     │     │
   │   │   │   │   │                  │     │     │     │
   X   └───┼───┼───┼──────────────────┼─────┼─────┘     │
   │       │   │   │                  │     │           │
   │       │   │   └──────────────────┼─────┘           │
   │       │   │                      │                 │
   │       │   └──────────────────────┼─────────────────┘
   │       │                          │
   │       └──────────────────────────┘
   │
   └─── NE KÖSD BE! (Vágd el vagy hagyd szabadon)
```

### Áram beállítás (FONTOS!)

A 28BYJ-48 kis áramú motor (~100-200mA). Az A4988 driver túl sok áramot adhat!

**A4988 Vref beállítás:**

```
Vref = Imax × 8 × Rs
Vref = 0.15A × 8 × 0.1Ω = 0.12V

→ Állítsd a Vref-et 0.10 - 0.15V közé!
```

**Mérés:**
1. Tápfeszültség bekapcsolva, motor nem terhelt
2. Multiméter + a GND-re, - a potenciométer közepére
3. Forgasd óvatosan a potit, amíg ~0.12V-ot nem mutat

## GRBL konfiguráció

### Tengely beállítások

Csatlakozz a GRBL-hez és állítsd be:

```bash
screen /dev/ttyUSB0 115200
```

```gcode
; Alap beállítások
$0=10          ; Step pulse (us)
$1=255         ; Step idle delay (mindig enable)
$3=0           ; Dir invert mask (lásd lent)
$10=1          ; Status report

; Homing és limitek kikapcsolása (robot kar)
$20=0          ; Soft limits off
$21=0          ; Hard limits off
$22=0          ; Homing off

; Steps per degree (KALIBRÁLANDÓ!)
; NEMA17: 200 step/rev × 16 microstepping / 360° = 8.89 step/degree
; Ha áttétel van, szorozd meg az áttétellel
$100=17.78     ; X (J2 váll) steps/degree
$101=17.78     ; Y (J3 könyök) steps/degree
$102=17.78     ; Z (J1 bázis) steps/degree
$103=5.69      ; A (J4 csukló) steps/degree (28BYJ-48: 2048/360)

; Max sebesség (degree/min)
$110=500       ; X (J2)
$111=500       ; Y (J3)
$112=500       ; Z (J1)
$113=100       ; A (J4) - lassabb, mert 28BYJ-48

; Gyorsulás (degree/sec²)
$120=50        ; X (J2)
$121=50        ; Y (J3)
$122=50        ; Z (J1)
$123=20        ; A (J4) - kisebb, mert 28BYJ-48
```

### Irány invertálás

Ha egy motor rossz irányba forog, használd a `$3` paramétert:

```
$3 = bináris maszk: [A][Z][Y][X]

Példák:
$3=0   ; Nincs invertálás
$3=1   ; X invertálva (J2)
$3=2   ; Y invertálva (J3)
$3=4   ; Z invertálva (J1)
$3=8   ; A invertálva (J4)
$3=5   ; X és Z invertálva (J2 és J1)
$3=15  ; Mind invertálva
```

## Python driver konfiguráció

A `config/devices.yaml` fájlban:

```yaml
- id: robot_arm_1
  name: "Ipari Robotkar"
  driver: robot_arm
  type: robot_arm
  enabled: true
  simulated: false
  config:
    port: /dev/ttyUSB0
    baudrate: 115200
    
    # Joint → GRBL tengely mapping
    # A driver ezt használja a logikai tengely -> firmware tengely konverzióhoz
    axis_mapping:
      J1: Z    # Bázis → Z kimenet
      J2: X    # Váll → X kimenet
      J3: Y    # Könyök → Y kimenet
      J4: A    # Csukló → A kimenet
    
    # Tengely skálázás (ha szükséges)
    # axis_scale:
    #   J1: 1.0
    #   J2: 1.0
    #   J3: 1.0
    #   J4: 1.0
    
    # Tengely limitek (fokban)
    axis_limits:
      J1: [-180, 180]   # Bázis forgás
      J2: [-90, 90]     # Váll
      J3: [-120, 120]   # Könyök
      J4: [-180, 180]   # Csukló
```

## Végeffektor vezérlés

### Gripper (Spindle PWM)

```gcode
; Gripper vezérlés M3/M5 parancsokkal
M3 S0      ; Gripper teljesen nyitva (0% PWM)
M3 S500    ; Gripper félig (50% PWM)
M3 S1000   ; Gripper teljesen zárva (100% PWM)
M5         ; Spindle/Gripper off
```

**Megjegyzés:** A szervó PWM frekvenciája és a tartomány a firmware-től függ.

### Sucker (Coolant)

```gcode
; Sucker vezérlés M7/M9 parancsokkal
M7         ; Coolant (Sucker) ON
M9         ; Coolant (Sucker) OFF
```

## Hibaelhárítás

### Motor nem forog

1. **Enable pin ellenőrzése**
   - D8 legyen LOW (GND-re húzva)
   - CNC Shield-en: az EN jumper legyen eltávolítva, vagy D8 LOW

2. **Driver Vref ellenőrzése**
   - Mérd meg a potenciométer feszültségét
   - NEMA17: ~0.5-1.0V
   - 28BYJ-48: ~0.1-0.15V

3. **Bekötés ellenőrzése**
   - Step/Dir vezetékek megfelelő pinen
   - Motor tekercsek jól párosítva

### Motor rossz irányba forog

1. **GRBL `$3` paraméter módosítása**
2. **Vagy:** cseréld meg az egyik tekercspárt (1A↔1B vagy 2A↔2B)

### 28BYJ-48 vibrál de nem forog

1. **Piros vezeték:** Győződj meg, hogy NINCS bekötve
2. **Tekercspár csere:** Próbáld meg mindkét pár cseréjét
3. **Vref csökkentés:** Állítsd lejjebb (0.08-0.10V)

### Gripper szervó nem mozog

1. **D11 bekötés ellenőrzése**
2. **GRBL teszt:** `M3 S500`
3. **Külső táp:** A szervó 5V-ot igényel, ne a CNC Shield-ről tápláld!

### GRBL nem válaszol

1. **Port ellenőrzés:** `ls /dev/ttyUSB* /dev/ttyACM*`
2. **Jogosultság:** `sudo usermod -aG dialout $USER` (majd ki/be jelentkezés)
3. **Baud rate:** 115200

## Firmware kezelés

### GRBL feltöltés

```bash
./firmware/upload-grbl.sh
```

### Eredeti firmware visszaállítása

```bash
avrdude -p atmega328p -c arduino -P /dev/ttyUSB0 -b 115200 \
    -U flash:w:firmware/robot_arm_firmware_backup.hex:i
```

## Kapcsolódó dokumentáció

- [GRBL GitHub](https://github.com/gnea/grbl)
- [GRBL Wiki](https://github.com/gnea/grbl/wiki)
- [CNC Shield v3 dokumentáció](https://blog.protoneer.co.nz/arduino-cnc-shield/)
- [A4988 driver dokumentáció](https://www.pololu.com/product/1182)
