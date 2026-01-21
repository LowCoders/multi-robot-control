# LinuxCNC Konfiguráció - JP-3163B

## Telepítés

1. Másold a `jp3163b` mappát a LinuxCNC configs könyvtárába:
```bash
mkdir -p ~/linuxcnc/configs
cp -r jp3163b ~/linuxcnc/configs/
```

2. Hozd létre a szükséges könyvtárakat:
```bash
mkdir -p ~/nc_files
mkdir -p ~/nc_files/subroutines
```

## Konfiguráció Testreszabása

### 1. Parport Cím

Ellenőrizd a PCI LPT kártya I/O címét:
```bash
cat /proc/ioports | grep parport
```

Szerkeszd a `jp3163b.hal` fájlt és állítsd be a helyes címet:
```hal
loadrt hal_parport cfg="0xd010 out"  # Cseréld a helyes címre
```

### 2. Steps/mm Kalibrálása

A `jp3163b.ini` fájlban állítsd be a SCALE értékeket:

```
SCALE = (motor_steps × microstepping) / pitch

Ahol:
- motor_steps = 200 (1.8°-os stepper)
- microstepping = TB6560 beállítás (1, 2, 4, 8, 16)
- pitch = orsó menetemelkedése mm-ben
```

**Példa:**
- 200 step motor
- 8x microstepping
- 4mm menetemelkedésű orsó
- SCALE = (200 × 8) / 4 = 400 steps/mm

### 3. Munkatér Határok

Állítsd be a MIN_LIMIT és MAX_LIMIT értékeket az egyes tengelyeknél a valós méreteknek megfelelően.

### 4. Sebességek és Gyorsulások

Kezdd alacsony értékekkel és fokozatosan növeld:
- MAX_VELOCITY: maximális sebesség (mm/s)
- MAX_ACCELERATION: maximális gyorsulás (mm/s²)

## Indítás

```bash
linuxcnc ~/linuxcnc/configs/jp3163b/jp3163b.ini
```

## Első Tesztelés

1. Indítsd el a LinuxCNC-t
2. Kapcsold be a gépet (F1 + F2)
3. Próbálj ki egy kis mozgást jogging-gal
4. Ha a mozgás rendben van, végezz homing-ot

## Hibaelhárítás

### "Unexpected realtime delay"
- Futtass latency tesztet
- Növeld a BASE_PERIOD értékét
- Ellenőrizd a GRUB kernel paramétereket

### A motor nem mozog
- Ellenőrizd a parport címet
- Ellenőrizd a kábelezést
- Ellenőrizd az Enable jelet

### Rossz irány vagy lépés
- Állítsd a SCALE előjelét (- vagy +)
- Ellenőrizd a DIR pin bekötését
