# Python Virtuális Környezet

## Miért szükséges a venv?

Az Ubuntu 23.04+ és Debian 12+ rendszereken a Python csomagkezelés "externally-managed" módban van. Ez azt jelenti, hogy a `pip install` parancs **blokkolva van** rendszerszinten:

```
error: externally-managed-environment
× This environment is externally managed
```

Ez a korlátozás védi a rendszer Python környezetét a sérüléstől. A megoldás: **Python virtuális környezet (venv)** használata.

## Venv helye

A projekt egyetlen központi venv-et használ:

```
drivers/venv/
```

Ez a könyvtár:
- A projekt része (de `.gitignore`-ban van)
- Tartalmazza az összes Python függőséget
- Automatikusan létrejön a scriptek futtatásakor

## Scriptek működése

Mindhárom script automatikusan kezeli a venv-et:

| Script | Venv kezelés |
|--------|--------------|
| `install-dependencies.sh` | Létrehozza és telepíti a csomagokat |
| `start-all.sh` | Létrehozza ha hiányzik, ellenőrzi a csomagokat |
| `run-tests.sh` | Létrehozza ha hiányzik, futtatja a teszteket |

A scriptek **direkt path-okat** használnak a venv-hez:

```bash
# Python futtatása
"$VENV_DIR/bin/python3" script.py

# Csomag telepítése
"$VENV_DIR/bin/pip" install package-name
```

Ez megbízhatóbb, mint a `source activate` / `deactivate` páros, különösen subshell-ekben.

## Manuális használat

Ha manuálisan szeretnél dolgozni a Python kóddal:

```bash
# Navigálj a drivers könyvtárba
cd drivers

# Aktiváld a venv-et
source venv/bin/activate

# Most a python és pip parancsok a venv-ből futnak
python --version
pip list

# Ha végeztél, deaktiváld
deactivate
```

Vagy direkt path-okkal (aktiválás nélkül):

```bash
# Python futtatása
./drivers/venv/bin/python3 drivers/bridge_server.py

# Csomag telepítése
./drivers/venv/bin/pip install some-package
```

## Függőségek

A Python függőségek a `drivers/requirements.txt` fájlban vannak definiálva:

```bash
# Függőségek újratelepítése
./drivers/venv/bin/pip install -r drivers/requirements.txt
```

## Hibaelhárítás

### Hibás venv

Ha a venv hibás vagy sérült:

```bash
# Töröld és hozd létre újra
rm -rf drivers/venv
python3 -m venv drivers/venv
./drivers/venv/bin/pip install -r drivers/requirements.txt
```

### Hiányzó modul

Ha egy modul hiányzik futtatáskor:

```bash
# Ellenőrizd, hogy a venv-ből fut-e
which python3
# Kimenet: .../drivers/venv/bin/python3

# Ha nem, aktiváld vagy használj direkt path-ot
./drivers/venv/bin/pip install hiányzó-modul
```

## Alternatívák (amiket NEM használunk)

| Megoldás | Miért nem? |
|----------|-----------|
| `apt install python3-xyz` | Nem minden csomag elérhető, régebbi verziók |
| `pip install --break-system-packages` | Veszélyes, elronthatja a rendszert |
| `pipx` | Csak CLI alkalmazásokhoz való |
| Docker | Bonyolultabb, nem megfelelő embedded környezetben |
