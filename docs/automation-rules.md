# Automatizálási Szabályok

## Áttekintés

Az automatizálási szabályok lehetővé teszik az eszközök közötti koordinációt eseményvezérelt logikával.

## Szabály Struktúra

```yaml
- id: unique_rule_id
  name: "Szabály neve"
  description: "Részletes leírás"
  enabled: true
  trigger:
    type: trigger_type
    # trigger-specifikus paraméterek
  conditions:
    - device: device_id
      state: idle
  actions:
    - type: action_type
      device: device_id
```

## Trigger Típusok

### job_complete
Aktiválódik amikor egy job befejeződik.

```yaml
trigger:
  type: job_complete
  device: cnc_main
```

### state_change
Aktiválódik állapotváltozáskor.

```yaml
trigger:
  type: state_change
  device: cnc_main  # opcionális
  from_state: running
  to_state: idle
```

### position
Aktiválódik egy pozíció elérésekor.

```yaml
trigger:
  type: position
  device: cnc_main
  axis: Z
  condition: "<="
  value: -50
```

### timer
Időzített aktiválás.

```yaml
trigger:
  type: timer
  interval: 300  # másodperc
```

### manual
Manuális aktiválás API-n keresztül.

```yaml
trigger:
  type: manual
  event: start_batch_job
```

### gcode_comment
G-code komment alapú aktiválás.

```yaml
trigger:
  type: gcode_comment
  pattern: ";SYNC_POINT_(\\d+)"
```

## Feltételek (Conditions)

Minden feltételnek teljesülnie kell a szabály aktiválásához.

### Állapot ellenőrzés
```yaml
conditions:
  - device: cnc_main
    state: idle
  - device: laser_1
    state: idle
```

### Pozíció ellenőrzés
```yaml
conditions:
  - device: cnc_main
    position:
      axis: Z
      operator: ">="
      value: 0
```

## Akció Típusok

### run
Program indítása.

```yaml
actions:
  - type: run
    device: cnc_main
```

### pause
Program szüneteltetése.

```yaml
actions:
  - type: pause
    device: cnc_main
```

### resume
Program folytatása.

```yaml
actions:
  - type: resume
    device: all  # minden eszköz
```

### stop
Program leállítása.

```yaml
actions:
  - type: stop
    device: all
```

### load_file
Fájl betöltése.

```yaml
actions:
  - type: load_file
    device: laser_1
    file: "/path/to/file.nc"
```

### send_gcode
G-code parancs küldése.

```yaml
actions:
  - type: send_gcode
    device: laser_1
    gcode: "M3 S100"
```

### notify
Értesítés küldése.

```yaml
actions:
  - type: notify
    channel: ui
    message: "Job befejezve!"
    severity: info  # info, warning, error, critical
```

### wait
Várakozás.

```yaml
actions:
  - type: wait
    duration: 5  # másodperc
```

### set_flag
Flag beállítása szinkronizációhoz.

```yaml
actions:
  - type: set_flag
    flag: "sync_point_1_ready"
    value: true
```

## Példák

### Szekvenciális Végrehajtás

```yaml
- id: cnc_then_laser
  name: "CNC után Lézer"
  enabled: true
  trigger:
    type: job_complete
    device: cnc_main
  conditions:
    - device: laser_1
      state: idle
  actions:
    - type: load_file
      device: laser_1
      file: "/nc_files/laser_job.nc"
    - type: run
      device: laser_1
```

### Hiba Kezelés

```yaml
- id: emergency_stop
  name: "Vészleállítás"
  enabled: true
  trigger:
    type: state_change
    to_state: alarm
  actions:
    - type: stop
      device: all
    - type: notify
      channel: ui
      message: "VÉSZLEÁLLÍTÁS!"
      severity: critical
```

### Szinkronizációs Pontok

```yaml
- id: sync_wait
  name: "Sync Point"
  enabled: true
  trigger:
    type: gcode_comment
    pattern: ";SYNC_(\\d+)"
  actions:
    - type: pause
      device: "{{trigger.device}}"
    - type: set_flag
      flag: "sync_{{trigger.match[1]}}_{{trigger.device}}"
      value: true
    - type: check_sync
      sync_id: "{{trigger.match[1]}}"
      devices: [cnc_main, laser_1]
      on_all_ready:
        - type: resume
          device: all
```

## Template Változók

A szabályokban használhatsz template változókat:

- `{{trigger.device}}` - A triggert kiváltó eszköz
- `{{trigger.type}}` - Trigger típusa
- `{{trigger.match[n]}}` - Regex match csoport (gcode_comment)
- `{{trigger.error}}` - Hibaüzenet (state_change alarm esetén)
- `{{context.key}}` - Egyéni kontextus változó
