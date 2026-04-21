#!/usr/bin/env python3
"""
Robot Arm Interaktív Teszt Szkript
GRBL firmware és vezérlési módok validálása

Használat:
    python test_robot.py
"""

import asyncio
import sys
import signal
import re
import select
import json
from datetime import datetime
from pathlib import Path
from time import perf_counter
from typing import Optional, Dict, Any, Tuple, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from robot_arm_driver import RobotArmDevice, ControlMode  # noqa: E402
from kinematics import RobotConfig, forward_kinematics, inverse_kinematics  # noqa: E402


# Tengely mapping (új és legacy elnevezések)
AXIS_TO_GRBL = {
    'X': 'X',
    'Y': 'Y',
    'Z': 'Z',
    'J1': 'X',
    'J2': 'Y',
    'J3': 'Z',
}

# Végállás pozíciók (fokban) - a kalibrációhoz
# Ezek az értékek a robot fizikai felépítésétől függenek
# Y (váll): pozitív végállás = a függőlegestől (90°) kb. 5°-kal hátra
# Z (könyök): negatív végállás = összecsukott, pozitív = kinyújtott/túlfeszített
# X (bázis): pozitív végállás = max forgás egy irányba
ENDSTOP_POSITIONS = {
    'X_min': -180.0,       # X negatív végállás
    'X_max': 180.0,        # X pozitív végállás
    'Y_min': -10.0,        # Y negatív végállás (lefelé)
    'Y_max': 96.0,         # Y pozitív végállás (felfelé)
    'Z_min': -55.0,        # Z negatív végállás (összecsukott)
    'Z_max': 40.0,         # Z pozitív végállás (kinyújtott)
    # Legacy aliasok (J1/J2/J3 néven hivatkozó tesztekhez)
    'J1_min': -180.0,
    'J1_max': 180.0,
    'J2_min': -10.0,
    'J2_max': 96.0,
    'J3_min': -55.0,
    'J3_max': 40.0,
}

# Biztonságos mozgási tartományok (végállásoktól távolabb)
SAFE_LIMITS = {
    'X_min': -175.0,
    'X_max': 175.0,
    'Y_min': -5.0,
    'Y_max': 91.0,
    'Z_min': -50.0,
    'Z_max': 35.0,
    # Legacy aliasok
    'J1_min': -175.0,
    'J1_max': 175.0,
    'J2_min': -5.0,
    'J2_max': 91.0,
    'J3_min': -50.0,
    'J3_max': 35.0,
}


# Globális device változó
device = None

# Kalibráció globális változók
calibration_stop_requested = False
calibration_result: Optional[Dict[str, Any]] = None

# Mozgási/tuning alapértékek
DEFAULT_TEST_SPEED = 500.0
Z_TUNING_DISTANCE = 60.0
Z_TUNING_CYCLES = 6
Z_RATE_STEPS = [500.0, 700.0, 900.0, 1200.0]
Z_ACCEL_STEPS = [50.0, 80.0, 120.0, 180.0]
DEFAULT_DRIVER_FEED_CAP = 20000.0

AXIS_TUNING_CONFIG = {
    'X': {'joint': 'J1', 'status_key': 'j1', 'rate_setting': 110, 'accel_setting': 120, 'label': 'X (bázis)'},
    'Y': {'joint': 'J2', 'status_key': 'j2', 'rate_setting': 111, 'accel_setting': 121, 'label': 'Y (váll)'},
    'Z': {'joint': 'J3', 'status_key': 'j3', 'rate_setting': 112, 'accel_setting': 122, 'label': 'Z (könyök)'},
}


def _status_xyz(status: Dict[str, Any]) -> Tuple[float, float, float]:
    """Kinyeri az X/Y/Z értékeket új vagy legacy státuszsémából."""
    axes = status.get('axes')
    if isinstance(axes, dict):
        return (
            float(axes.get('x', 0.0)),
            float(axes.get('y', 0.0)),
            float(axes.get('z', 0.0)),
        )

    wpos = status.get('wpos')
    if wpos is not None and all(hasattr(wpos, axis) for axis in ('x', 'y', 'z')):
        return (float(wpos.x), float(wpos.y), float(wpos.z))

    grbl = status.get('grbl')
    if isinstance(grbl, dict):
        return (
            float(grbl.get('x', 0.0)),
            float(grbl.get('y', 0.0)),
            float(grbl.get('z', 0.0)),
        )

    return (0.0, 0.0, 0.0)


def normalize_robot_status(status: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Kompatibilis státusz séma:
    - first-class: state/axes/wpos/mpos/cartesian
    - legacy alias: joints/grbl
    """
    if not isinstance(status, dict):
        return {
            'state': 'unknown',
            'axes': {'x': 0.0, 'y': 0.0, 'z': 0.0},
            'grbl': {'x': 0.0, 'y': 0.0, 'z': 0.0},
            'joints': {'j1': 0.0, 'j2': 0.0, 'j3': 0.0},
        }

    x, y, z = _status_xyz(status)
    normalized = dict(status)

    # Legacy aliasok
    normalized['grbl'] = {'x': x, 'y': y, 'z': z}
    normalized['joints'] = {'j1': x, 'j2': y, 'j3': z}

    # Ha hiányzik az axes, pótoljuk
    if 'axes' not in normalized or not isinstance(normalized.get('axes'), dict):
        normalized['axes'] = {'x': x, 'y': y, 'z': z}

    return normalized


async def connect():
    """Csatlakozás a robothoz"""
    global device
    
    print("\n" + "="*50)
    print("CSATLAKOZÁS")
    print("="*50)
    
    config = RobotConfig(L1=85, L2=140, L3=165)
    device = RobotArmDevice(
        device_id='robot_arm_1',
        device_name='Robot Kar',
        port='/dev/ttyUSB0',
        robot_config=config,
    )
    
    success = await device.connect()
    if not success:
        print("❌ Csatlakozás sikertelen!")
        return False
    
    print("✓ Csatlakozás sikeres")
    print(f"  GRBL mód: {device._use_grbl}")
    print(f"  GRBL verzió: {device._grbl_version}")

    # Feed cap igazítás: ne maradjon a RobotArmDevice fallback 100-as clamp.
    try:
        settings = await device.get_grbl_settings()
        current_z_max_rate = float(settings.get(112, 500.0))
        tuned_driver_cap = max(DEFAULT_DRIVER_FEED_CAP, current_z_max_rate)
        device.update_driver_config(max_feed_rate=tuned_driver_cap)
        print(
            f"  Driver cap beállítva: {tuned_driver_cap:.1f} "
            f"(GRBL $112={current_z_max_rate:.1f})"
        )
    except Exception as exc:
        print(f"  ⚠ Driver cap igazítás kihagyva: {exc}")

    # Egységes státusz-séma wrapper:
    # a szkript mindenhol kompatibilis dictionary-t kapjon.
    raw_get_grbl_status = device.get_grbl_status

    async def compat_get_grbl_status():
        raw_status = await raw_get_grbl_status()
        return normalize_robot_status(raw_status)

    device.get_grbl_status = compat_get_grbl_status
    
    # Home pozíció beállítása alapértelmezettként (J1=0, J2=90, J3=0)
    # GRBL mapping: X=J2, Y=J3, Z=J1
    print("  Home pozíció beállítása (J1=0, J2=90, J3=0)...")
    await device.send_gcode("G92 X90 Y0 Z0")
    await asyncio.sleep(0.1)
    print("  ✓ GRBL pozíció: X=90 (J2), Y=0 (J3), Z=0 (J1)")
    
    return True


async def show_status():
    """Státusz megjelenítése végállás értékekkel"""
    if not device:
        print("Nincs csatlakozva!")
        return
    
    print("\n--- STÁTUSZ ---")
    status = await device.get_grbl_status()
    if status:
        j1 = status['joints']['j1']
        j2 = status['joints']['j2']
        j3 = status['joints']['j3']
        
        print(f"GRBL állapot: {status['state']}")
        print(f"GRBL pozíció: X={status['grbl']['x']:.2f} Y={status['grbl']['y']:.2f} Z={status['grbl']['z']:.2f}")
        print(f"Joint szögek: J1={j1:.1f}° J2={j2:.1f}° J3={j3:.1f}°")
        
        # Végállás távolságok
        j1_to_min = j1 - ENDSTOP_POSITIONS['J1_min']
        j1_to_max = ENDSTOP_POSITIONS['J1_max'] - j1
        j2_to_min = j2 - ENDSTOP_POSITIONS['J2_min']
        j2_to_max = ENDSTOP_POSITIONS['J2_max'] - j2
        j3_to_min = j3 - ENDSTOP_POSITIONS['J3_min']
        j3_to_max = ENDSTOP_POSITIONS['J3_max'] - j3
        
        print(f"Végállástól:  J1=[{j1_to_min:+.1f}°, {j1_to_max:+.1f}°]  J2=[{j2_to_min:+.1f}°, {j2_to_max:+.1f}°]  J3=[{j3_to_min:+.1f}°, {j3_to_max:+.1f}°]")
        
        # Figyelmeztetés ha közel van végálláshoz
        warnings = []
        if j1_to_min < 10: warnings.append(f"J1 közel min-hez ({j1_to_min:.1f}°)")
        if j1_to_max < 10: warnings.append(f"J1 közel max-hoz ({j1_to_max:.1f}°)")
        if j2_to_min < 10: warnings.append(f"J2 közel min-hez ({j2_to_min:.1f}°)")
        if j2_to_max < 10: warnings.append(f"J2 közel max-hoz ({j2_to_max:.1f}°)")
        if j3_to_min < 10: warnings.append(f"J3 közel min-hez ({j3_to_min:.1f}°)")
        if j3_to_max < 10: warnings.append(f"J3 közel max-hoz ({j3_to_max:.1f}°)")
        
        if warnings:
            print(f"⚠ FIGYELEM: {', '.join(warnings)}")
        
        if status.get('cartesian'):
            print(f"Cartesian (FK): X={status['cartesian']['x']:.1f}mm Y={status['cartesian']['y']:.1f}mm Z={status['cartesian']['z']:.1f}mm")
    else:
        print("Státusz lekérdezés sikertelen")


# ============================================================
# KALIBRÁCIÓ FUNKCIÓK
# ============================================================

async def emergency_stop():
    """
    Azonnali leállítás - GRBL soft reset küldése.
    A 0x18 (Ctrl+X) karakter azonnali mozgás-leállítást okoz.
    """
    global calibration_stop_requested
    calibration_stop_requested = True
    
    if device and device._serial and device._serial.is_open:
        try:
            await asyncio.to_thread(device._serial.write, b'\x18')
            print("\n⛔ VÉSZLEÁLLÍTÁS - GRBL soft reset elküldve!")
        except Exception as e:
            print(f"\n⛔ VÉSZLEÁLLÍTÁS - Hiba: {e}")
    else:
        print("\n⛔ VÉSZLEÁLLÍTÁS kérve (nincs aktív kapcsolat)")


async def move_single_axis(joint: str, distance: float, speed: float = 400) -> bool:
    """
    Egyetlen joint relatív mozgatása G91 (inkrementális) módban.
    
    Csak az adott tengelyt mozgatja, a többi változatlan marad.
    Ez fontos a kalibráció során, hogy ne módosítsuk a már beállított pozíciókat.
    
    Args:
        joint: 'J1', 'J2', vagy 'J3'
        distance: Szög fokban (pozitív/negatív)
        speed: Sebesség (fok/perc)
    
    Returns:
        True ha sikeres, False ha hiba
    """
    if not device:
        return False
    
    joint = joint.upper()
    grbl_axis = AXIS_TO_GRBL.get(joint)
    if not grbl_axis:
        return False
    
    # G91 = inkrementális mód, mozgás, majd G90 = abszolút mód vissza
    commands = [
        "G91",  # Inkrementális mód
        f"G1 {grbl_axis}{distance:.2f} F{speed:.0f}",  # Csak egy tengely mozgatása
        "G90",  # Abszolút mód vissza
    ]
    
    for cmd in commands:
        response = await device.send_gcode(cmd)
        if response and 'error' in response.lower():
            return False
    
    return True


async def wait_for_idle(timeout: float = 10.0) -> bool:
    """
    Várakozás amíg a GRBL Idle állapotba kerül (mozgás befejeződik).
    
    Args:
        timeout: Maximum várakozási idő másodpercben
        
    Returns:
        True ha Idle állapot elérve, False ha timeout vagy hiba
    """
    if not device:
        return False
    
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        try:
            status = await device.get_grbl_status()
            if status:
                state = status.get('state', '').lower()
                if 'idle' in state:
                    return True
                if 'alarm' in state:
                    return False
        except Exception:
            pass
        await asyncio.sleep(0.1)
    
    return False


def _parse_float_list(raw: str, fallback: List[float]) -> List[float]:
    """Vesszővel elválasztott float lista parse, üresen fallback."""
    if not raw.strip():
        return list(fallback)
    values: List[float] = []
    for token in raw.split(','):
        token = token.strip()
        if not token:
            continue
        values.append(float(token))
    return values if values else list(fallback)


def _ask_yes_no(prompt: str, default: Optional[bool] = None) -> bool:
    """Igen/nem kérdés robusztus parse-olással. Escape is 'nem'-ként értelmezett."""
    yes_values = {'i', 'igen', 'y', 'yes'}
    no_values = {'n', 'nem', 'no'}

    while True:
        answer = input(prompt).strip().lower()
        if not answer and default is not None:
            return default
        if answer.startswith('\x1b'):
            return False
        if answer in yes_values:
            return True
        if answer in no_values:
            return False
        print("    Érvénytelen válasz. Használd: i/igen, n/nem vagy Escape.")


def _print_servo_closedloop_review() -> None:
    """Kiírja a robot_arm_2 closed-loop paraméterek gyors tuning javaslatát."""
    config_path = Path("/web/multi-robot-control/config/machines/robot_arm_2.json")
    try:
        with config_path.open("r", encoding="utf-8") as f:
            machine = json.load(f)
    except Exception as exc:
        print(f"  ⚠ Closed-loop review nem elérhető ({exc})")
        return

    stall = (
        machine.get("driverConfig", {})
        .get("closedLoop", {})
        .get("stallDetection", {})
    )
    speed = float(stall.get("speed", 150.0))
    timeout = float(stall.get("timeout", 0.3))
    tolerance = float(stall.get("tolerance", 0.5))

    print("\n--- Closed-loop gyors áttekintés (robot_arm_2) ---")
    print(f"  stallDetection.speed:    {speed:.1f} deg/min")
    print(f"  stallDetection.timeout:  {timeout:.2f} s")
    print(f"  stallDetection.tolerance:{tolerance:.2f} deg")
    print("  Javaslat gyorsabb profilhoz (konfig módosítás nélkül):")
    print("    speed: 300-800 deg/min, timeout: 0.5-1.0 s, tolerance: 1.0-2.0 deg")


async def benchmark_axis_cycles(
    distance: float, speed: float, cycles: int,
    joint: str = 'J3', status_key: str = 'j3',
) -> Dict[str, Any]:
    """
    Tengely oda-vissza benchmark.

    A mérés célja, hogy ugyanazzal a távolsággal és sebességgel
    összehasonlítható idő- és drift adatot adjon.
    """
    if not device:
        return {'ok': False, 'error': 'device_not_connected'}

    status_before = await device.get_grbl_status()
    if not status_before:
        return {'ok': False, 'error': 'status_before_failed'}
    axis_start = float(status_before['joints'].get(status_key, 0.0))

    total_elapsed = 0.0
    for idx in range(cycles):
        print(f"    Ciklus {idx + 1}/{cycles} (F={speed:.0f}, út={distance:.1f}°)")
        t0 = perf_counter()
        ok_fwd = await device.jog_joint(joint, distance, speed=speed)
        if not ok_fwd:
            print(f"  ❌ {joint}+ mozgás hiba (ciklus: {idx + 1})")
            return {'ok': False, 'error': 'jog_fail_forward', 'cycle': idx + 1}
        expected_sec = (abs(distance) / max(abs(speed), 1.0)) * 60.0
        move_timeout = max(15.0, expected_sec * 6.0 + 10.0)
        if not await wait_for_idle(timeout=move_timeout):
            retry_timeout = move_timeout * 2.0
            print(
                f"  ⚠ Timeout {joint}+ mozgásnál (ciklus: {idx + 1}), "
                f"újrapróba hosszabb timeouttal ({retry_timeout:.1f}s)..."
            )
            if not await wait_for_idle(timeout=retry_timeout):
                print(f"  ❌ Timeout {joint}+ mozgásnál (ciklus: {idx + 1})")
                return {'ok': False, 'error': 'idle_timeout_forward', 'cycle': idx + 1}

        ok_back = await device.jog_joint(joint, -distance, speed=speed)
        if not ok_back:
            print(f"  ❌ {joint}- mozgás hiba (ciklus: {idx + 1})")
            return {'ok': False, 'error': 'jog_fail_reverse', 'cycle': idx + 1}
        if not await wait_for_idle(timeout=move_timeout):
            retry_timeout = move_timeout * 2.0
            print(
                f"  ⚠ Timeout {joint}- mozgásnál (ciklus: {idx + 1}), "
                f"újrapróba hosszabb timeouttal ({retry_timeout:.1f}s)..."
            )
            if not await wait_for_idle(timeout=retry_timeout):
                print(f"  ❌ Timeout {joint}- mozgásnál (ciklus: {idx + 1})")
                return {'ok': False, 'error': 'idle_timeout_reverse', 'cycle': idx + 1}
        total_elapsed += perf_counter() - t0

    status_after = await device.get_grbl_status()
    if not status_after:
        return {'ok': False, 'error': 'status_after_failed'}
    axis_end = float(status_after['joints'].get(status_key, 0.0))

    return {
        'ok': True,
        'avg_cycle_sec': total_elapsed / max(cycles, 1),
        'total_sec': total_elapsed,
        'drift_deg': axis_end - axis_start,
    }


async def benchmark_z_cycles(distance: float, speed: float, cycles: int) -> Dict[str, Any]:
    """Kompatibilitási wrapper: Z tengely benchmark."""
    return await benchmark_axis_cycles(distance, speed, cycles, joint='J3', status_key='j3')


async def run_speed_tuning():
    """Progresszív speed tuning tetszőleges tengelyre: lépcsőzés + 'mehet gyorsabban?' kérdés."""
    global DEFAULT_TEST_SPEED
    if not device:
        print("Nincs csatlakozva!")
        return

    print("\nMelyik tengelyt szeretnéd tuningolni?")
    for key, cfg in AXIS_TUNING_CONFIG.items():
        print(f"  {key}: {cfg['label']}  - ${cfg['rate_setting']}/${cfg['accel_setting']}")
    axis_input = input("Tengely [Enter=Z]: ").strip().upper()
    if not axis_input:
        axis_input = 'Z'
    if axis_input not in AXIS_TUNING_CONFIG:
        print("❌ Érvénytelen tengely!")
        return
    axis_cfg = AXIS_TUNING_CONFIG[axis_input]
    rate_s = axis_cfg['rate_setting']
    accel_s = axis_cfg['accel_setting']

    settings = await device.get_grbl_settings()
    current_rate = float(settings.get(rate_s, 500.0))
    current_accel = float(settings.get(accel_s, 50.0))

    print("\n" + "=" * 60)
    print(f"  {axis_cfg['label'].upper()} TENGELY SPEED TUNING (${rate_s} / ${accel_s})")
    print("=" * 60)
    print(f"  Jelenlegi ${rate_s} ({axis_input} max rate): {current_rate}")
    print(f"  Jelenlegi ${accel_s} ({axis_input} accel):    {current_accel}")
    print(f"  Aktuális alap teszt speed:   {DEFAULT_TEST_SPEED}")
    print(f"  Aktuális driver feed cap:    {float(getattr(device, '_config_max_feed_rate', 100.0)):.1f}")
    print(f"  Benchmark: distance={Z_TUNING_DISTANCE}°, cycles={Z_TUNING_CYCLES}")
    _print_servo_closedloop_review()

    try:
        raw_start = input(f"Kezdő ${rate_s} [Enter={current_rate}]: ").strip()
        start_rate = current_rate if not raw_start else max(1.0, float(raw_start))

        raw_step = input(f"Lépcsőköz ${rate_s} [Enter=150]: ").strip()
        rate_step = 150.0 if not raw_step else max(1.0, float(raw_step))

        raw_max = input(f"Maximum ${rate_s} [Enter=2000]: ").strip()
        max_rate = 2000.0 if not raw_max else max(start_rate, float(raw_max))

        raw_accel_step = input(f"Lépcsőköz ${accel_s} [Enter=20]: ").strip()
        accel_step = 20.0 if not raw_accel_step else max(0.0, float(raw_accel_step))

        raw_accel_max = input(f"Maximum ${accel_s} [Enter=220]: ").strip()
        max_accel = 220.0 if not raw_accel_max else max(current_accel, float(raw_accel_max))

        raw_distance = input(f"Tesztút {axis_input} (fok) [Enter={Z_TUNING_DISTANCE}]: ").strip()
        tuning_distance = Z_TUNING_DISTANCE if not raw_distance else max(1.0, float(raw_distance))

        raw_cycles = input(f"Ciklusszám [Enter={Z_TUNING_CYCLES}]: ").strip()
        tuning_cycles = Z_TUNING_CYCLES if not raw_cycles else max(1, int(raw_cycles))
    except ValueError:
        print("❌ Hibás számformátum, tuning megszakítva.")
        return

    if start_rate < current_rate:
        keep_lower_start = _ask_yes_no(
            f"Kezdő ${rate_s} ({start_rate:.1f}) kisebb mint a jelenlegi ({current_rate:.1f}). "
            "Valóban visszavegyük? (i/n): ",
            default=False,
        )
        if not keep_lower_start:
            start_rate = current_rate

    quick_profile = _ask_yes_no("Gyors tuning profil (rövidebb futás) legyen? (i/n): ", default=True)
    if quick_profile:
        tuning_distance = min(tuning_distance, 30.0)
        tuning_cycles = min(tuning_cycles, 2)
    print(f"  Tuning profil: distance={tuning_distance:.1f}°, cycles={tuning_cycles}")

    print("\n--- Baseline mérés (jelenlegi beállítással) ---")
    driver_cap = float(getattr(device, '_config_max_feed_rate', DEFAULT_DRIVER_FEED_CAP))
    baseline_speed = min(DEFAULT_TEST_SPEED, start_rate, driver_cap)
    if not await device.set_grbl_setting(rate_s, start_rate):
        print(f"❌ Nem sikerült a kezdő ${rate_s} értéket beállítani: {start_rate}")
        return
    await asyncio.sleep(0.2)

    baseline = await benchmark_axis_cycles(
        distance=tuning_distance,
        speed=baseline_speed,
        cycles=tuning_cycles,
        joint=axis_cfg['joint'],
        status_key=axis_cfg['status_key'],
    )
    if not baseline.get('ok'):
        print(
            f"❌ Baseline mérés sikertelen. ok={baseline.get('ok')} "
            f"error={baseline.get('error')} cycle={baseline.get('cycle')}"
        )
        return
    print(
        f"  Baseline: avg={baseline['avg_cycle_sec']:.3f}s/ciklus, "
        f"drift={baseline['drift_deg']:+.3f}°"
    )
    print(f"  Baseline effective feed: F{baseline_speed:.1f} (driver_cap={driver_cap:.1f})")

    stable_rate = start_rate
    stable_accel = current_accel
    last_avg_cycle_sec = baseline['avg_cycle_sec']

    print("\n--- Progresszív lépcsőzés ---")
    print(f"Minden körben emeljük a ${rate_s}/${accel_s} értéket, tesztelünk, majd kérdezünk.")

    while True:
        next_rate = min(max_rate, stable_rate + rate_step)
        next_accel = min(max_accel, stable_accel + accel_step)

        if next_rate == stable_rate and next_accel == stable_accel:
            print("  Elértük a beállított plafont.")
            extend = _ask_yes_no("    Emeljük a plafont és mehet gyorsabban? (i/n): ", default=False)
            if not extend:
                break
            max_rate += rate_step
            max_accel += accel_step
            print(f"    Új plafon: ${rate_s}<={max_rate:.1f}, ${accel_s}<={max_accel:.1f}")
            continue

        if not await device.set_grbl_setting(rate_s, next_rate):
            print(f"  ❌ ${rate_s}={next_rate} beállítás nem sikerült")
            break
        if next_accel != stable_accel:
            if not await device.set_grbl_setting(accel_s, next_accel):
                print(f"  ❌ ${accel_s}={next_accel} beállítás nem sikerült")
                await device.set_grbl_setting(rate_s, stable_rate)
                break
        await asyncio.sleep(0.2)

        effective_feed = min(next_rate, driver_cap)
        eta_sec = last_avg_cycle_sec * tuning_cycles
        print(
            f"    Lépcső indul: target ${rate_s}={next_rate:.1f}, effective F={effective_feed:.1f}, "
            f"becsült idő ~{eta_sec:.1f}s"
        )

        result = await benchmark_axis_cycles(
            distance=tuning_distance,
            speed=next_rate,
            cycles=tuning_cycles,
            joint=axis_cfg['joint'],
            status_key=axis_cfg['status_key'],
        )
        if not result.get('ok'):
            print(
                f"  ❌ Teszt hiba. error={result.get('error')} cycle={result.get('cycle')} "
                "-> visszaállás az utolsó stabil értékekre."
            )
            await device.set_grbl_setting(rate_s, stable_rate)
            await device.set_grbl_setting(accel_s, stable_accel)
            break

        delta = baseline['avg_cycle_sec'] - result['avg_cycle_sec']
        print(
            f"  ${rate_s}={next_rate:.1f}, ${accel_s}={next_accel:.1f} -> "
            f"avg={result['avg_cycle_sec']:.3f}s/ciklus, drift={result['drift_deg']:+.3f}°, "
            f"nyereség={delta:+.3f}s, effective F={effective_feed:.1f}/{driver_cap:.1f}"
        )
        last_avg_cycle_sec = result['avg_cycle_sec']

        go_faster = _ask_yes_no("    Mehet gyorsabban? (Enter=igen, n/Esc=nem): ", default=True)
        if go_faster:
            stable_rate = next_rate
            stable_accel = next_accel
            continue

        await device.set_grbl_setting(rate_s, stable_rate)
        await device.set_grbl_setting(accel_s, stable_accel)
        print(f"  ↩ Megálltunk. Stabil értékek: ${rate_s}={stable_rate}, ${accel_s}={stable_accel}")
        break

    daily_rate = stable_rate
    aggressive_rate = stable_rate
    if stable_rate > start_rate:
        daily_rate = (stable_rate + start_rate) / 2.0
    DEFAULT_TEST_SPEED = max(DEFAULT_TEST_SPEED, stable_rate)

    print("\n" + "=" * 60)
    print(f"  TUNING EREDMÉNY ({axis_cfg['label']})")
    print("=" * 60)
    print(f"  Stabil értékek: ${rate_s}={stable_rate:.1f}, ${accel_s}={stable_accel:.1f}")
    print(f"  Baseline sebesség: {baseline_speed:.1f}")
    print(f"  Frissített alap teszt speed: {DEFAULT_TEST_SPEED:.1f}")
    print(f"  Javasolt 'napi' profil:      ${rate_s}={daily_rate:.1f}, ${accel_s}={stable_accel:.1f}")
    print(f"  Javasolt 'agresszív' profil: ${rate_s}={aggressive_rate:.1f}, ${accel_s}={stable_accel:.1f}")
    print(f"  Megjegyzés: UI jog feed legyen <= ${rate_s} (különben firmware clamp-eli).")
    print("=" * 60)


async def get_limit_pins(debug: bool = False) -> Dict[str, bool]:
    """
    GRBL limit pin állapot lekérdezése a ? státuszból.
    
    A grbl4axis státusz válaszban a Lim: mező tartalmazza a limit pin állapotokat
    bináris formátumban:
    - 4 tengelyes (grbl4axis): "Lim:EZYX" pl. "Lim:1000" = E aktív
    - 3 tengelyes (standard): "Lim:ZYX" pl. "Lim:100" = Z aktív
    
    FONTOS: A $10 beállításban a bit 4 (érték 16) engedélyezi a limit pin reportot!
    
    Returns:
        Dict a limit pin állapotokkal: {'X': bool, 'Y': bool, 'Z': bool, 'E': bool}
        A kulcsok GRBL tengelyek, nem joint nevek!
    """
    if not device:
        return {'X': False, 'Y': False, 'Z': False, 'E': False}
    
    try:
        # Nyers GRBL státusz lekérdezés
        response = await device.send_gcode("?")
        
        if debug:
            print(f"        [DEBUG] GRBL válasz: {response.strip()}")
        
        # Lim: mező keresése bináris formátumban (3 vagy 4 digit)
        # print_unsigned_int8() MSB-first sorrendben ír:
        # 4 tengelyes: Lim:EZYX (pl. "Lim:1000" = E aktív, "Lim:0100" = Z aktív)
        # 3 tengelyes: Lim:ZYX (pl. "Lim:100" = Z aktív)
        lim_match = re.search(r'Lim:(\d{3,4})', response)
        if lim_match:
            bits = lim_match.group(1)
            if len(bits) == 4:
                # 4 tengelyes GRBL (grbl4axis): EZYX sorrend
                result = {
                    'E': bits[0] == '1',  # Első karakter = E limit (MSB)
                    'Z': bits[1] == '1',  # Második karakter = Z limit
                    'Y': bits[2] == '1',  # Harmadik karakter = Y limit
                    'X': bits[3] == '1',  # Negyedik karakter = X limit (LSB)
                }
                if debug:
                    print(f"        [DEBUG] Lim: mező: {bits} (EZYX sorrend) -> E={result['E']} Z={result['Z']} Y={result['Y']} X={result['X']}")
            else:
                # 3 tengelyes GRBL: ZYX sorrend
                result = {
                    'E': False,
                    'Z': bits[0] == '1',  # Első karakter = Z limit (MSB)
                    'Y': bits[1] == '1',  # Második karakter = Y limit
                    'X': bits[2] == '1',  # Harmadik karakter = X limit (LSB)
                }
                if debug:
                    print(f"        [DEBUG] Lim: mező: {bits} (ZYX sorrend) -> Z={result['Z']} Y={result['Y']} X={result['X']}")
            return result
        
        # Próbáljuk a Pn: formátumot is (újabb GRBL verziók)
        pn_match = re.search(r'Pn:([XYZEPDHRS]+)', response)
        if pn_match:
            pins = pn_match.group(1)
            result = {
                'X': 'X' in pins,
                'Y': 'Y' in pins,
                'Z': 'Z' in pins,
                'E': 'E' in pins,
            }
            if debug:
                print(f"        [DEBUG] Pn: mező: {pins} -> X={result['X']} Y={result['Y']} Z={result['Z']} E={result['E']}")
            return result
        
        # Ha nincs Lim: vagy Pn: mező
        if debug:
            print(f"        [DEBUG] Nincs Lim: vagy Pn: mező a válaszban!")
        return {'X': False, 'Y': False, 'Z': False, 'E': False}
        
    except Exception as e:
        print(f"  Limit pin lekérdezés hiba: {e}")
        return {'X': False, 'Y': False, 'Z': False, 'E': False}


async def get_joint_limit_state(joint: str) -> bool:
    """
    Adott joint végállás kapcsoló állapotának lekérdezése.
    
    Args:
        joint: 'J1', 'J2', vagy 'J3'
    
    Returns:
        True ha a joint végállás kapcsolója aktív
    """
    joint = joint.upper()
    grbl_axis = AXIS_TO_GRBL.get(joint)
    if not grbl_axis:
        return False
    
    limits = await get_limit_pins()
    return limits.get(grbl_axis, False)


async def check_and_enable_limit_reporting() -> bool:
    """
    Ellenőrzi és engedélyezi a limit pin reportot a $10 beállításban.
    
    A limit pin állapot csak akkor jelenik meg a GRBL státuszban,
    ha a $10 beállítás bit 4-e (érték 16) engedélyezve van.
    
    Returns:
        True ha a limit reporting már be volt kapcsolva vagy sikerült bekapcsolni
    """
    if not device:
        return False
    
    try:
        # $10 beállítás lekérdezése
        response = await device.send_gcode("$$")
        
        # $10 érték keresése
        match = re.search(r'\$10=(\d+)', response)
        if not match:
            print("  ⚠ Nem sikerült a $10 beállítást lekérdezni")
            return False
        
        current_value = int(match.group(1))
        limit_bit = 16  # bit 4 = BITFLAG_RT_STATUS_LIMIT_PINS
        
        if current_value & limit_bit:
            print(f"  ✓ Limit pin report engedélyezve ($10={current_value})")
            return True
        
        # Limit bit bekapcsolása
        new_value = current_value | limit_bit
        print(f"  ⚠ Limit pin report nincs engedélyezve ($10={current_value})")
        print(f"    Bekapcsolás: $10={new_value}")
        
        await device.send_gcode(f"$10={new_value}")
        await asyncio.sleep(0.2)
        
        # Ellenőrzés
        response2 = await device.send_gcode("$$")
        match2 = re.search(r'\$10=(\d+)', response2)
        if match2 and int(match2.group(1)) == new_value:
            print(f"  ✓ Limit pin report bekapcsolva ($10={new_value})")
            return True
        else:
            print(f"  ❌ Nem sikerült a $10 beállítást módosítani")
            return False
            
    except Exception as e:
        print(f"  ❌ $10 beállítás hiba: {e}")
        return False


async def test_endstop_switches():
    """
    Interaktív végállás kapcsoló teszt.
    
    A felhasználó kézzel aktiválja a végálláskapcsolókat sorban (J3, J2, J1),
    és a rendszer ellenőrzi, hogy a kapcsoló jelet ad-e.
    Skip lehetőség ha egy kapcsoló nem elérhető.
    """
    if not device:
        print("❌ Nincs csatlakozva!")
        return
    
    print("\n" + "="*60)
    print("  VÉGÁLLÁS KAPCSOLÓ TESZT")
    print("="*60)
    
    # $10 beállítás ellenőrzése - limit pin report engedélyezése
    print("\n  GRBL beállítások ellenőrzése...")
    if not await check_and_enable_limit_reporting():
        print("  ⚠ A limit pin report nincs engedélyezve, a teszt nem fog működni!")
        print("    Próbáld kézzel: $10=16 vagy $10=17")
        user_input = input("  Folytatod mégis? (i/n): ").strip().lower()
        if user_input != 'i':
            return
    
    print("\n" + "="*60)
    print("  Aktiváld a végálláskapcsolókat egyenként!")
    print("  's' = skip (átugrás)")
    print("  'q' = kilépés")
    print("="*60)
    
    # Tesztelendő jointek sorrendje
    # Bekötés: J3->Y+(D10), J2->X+(D9), J1->A5(probe pin, Z limitként kezelve)
    joints_to_test = [
        ('J3', 'könyök', 'Y'),
        ('J2', 'váll', 'X'),
        ('J1', 'bázis', 'Z'),  # A5 probe pin, firmware-ben Z limitként kezelve
    ]
    
    results = {}
    
    for i, (joint, name, grbl_axis) in enumerate(joints_to_test, 1):
        print(f"\n  [{i}/3] {joint} ({name}) végálláskapcsoló...")
        if grbl_axis == 'Z':
            print(f"        GRBL tengely: {grbl_axis} (A5/SCL probe pin)")
        else:
            print(f"        GRBL tengely: {grbl_axis}+ (CNC shield {grbl_axis}+ csatlakozó)")
        print(f"        Nyomd meg a kapcsolót, vagy 's' = skip, 'q' = kilépés")
        
        detected = False
        skipped = False
        poll_count = 0
        
        while True:
            poll_count += 1
            
            # Limit pin állapot lekérdezése - első 3 lekérdezésnél debug módban
            use_debug = (poll_count <= 3)
            limits = await get_limit_pins(debug=use_debug)
            
            # Állapot kiírása
            status_str = f"X={'●' if limits['X'] else '○'} Y={'●' if limits['Y'] else '○'} Z={'●' if limits['Z'] else '○'}"
            print(f"\r        Várakozás... [{status_str}]  ", end='', flush=True)
            
            # Ellenőrzés, hogy a keresett kapcsoló aktív-e
            if limits.get(grbl_axis, False):
                print(f"\n        ✓ {joint} végállás aktív!")
                detected = True
                break
            
            # Billentyű input ellenőrzése (non-blocking)
            # Egyszerűsített megoldás: timeout-os input
            try:
                # Kis várakozás az input előtt
                await asyncio.sleep(0.3)
                
                # Próbáljunk non-blocking input-ot
                if sys.stdin in select.select([sys.stdin], [], [], 0)[0]:
                    user_input = sys.stdin.readline().strip().lower()
                    if user_input == 's':
                        print(f"\n        - {joint} átugorva")
                        skipped = True
                        break
                    elif user_input == 'q':
                        print("\n        Teszt megszakítva.")
                        return
            except Exception:
                # Ha a select nem működik (pl. Windows), használjunk timeout-os várakozást
                await asyncio.sleep(0.2)
        
        if detected:
            results[joint] = 'ok'
        elif skipped:
            results[joint] = 'skip'
        else:
            results[joint] = 'fail'
    
    # Eredmények összesítése
    print("\n" + "="*60)
    print("  EREDMÉNYEK")
    print("="*60)
    for joint, name, _ in joints_to_test:
        status = results.get(joint, 'unknown')
        if status == 'ok':
            print(f"    {joint} ({name}): ✓ Működik")
        elif status == 'skip':
            print(f"    {joint} ({name}): - Átugorva")
        else:
            print(f"    {joint} ({name}): ❌ Nem érzékelt")
    print("="*60)


def calculate_move_timeout(distance: float, speed: float, min_timeout: float = 0.1) -> float:
    """
    Timeout számítása a mozgás távolsága és sebessége alapján.
    
    Args:
        distance: Mozgás távolsága fokban
        speed: Sebesség (fok/perc)
        min_timeout: Minimum timeout másodpercben
    
    Returns:
        Timeout másodpercben (mozgás ideje + 50% ráhagyás)
    """
    if speed <= 0:
        return min_timeout
    move_time = abs(distance) / speed * 60  # másodpercben
    return max(min_timeout, move_time * 1.5)  # +50% ráhagyás


async def search_endstop_continuous(
    joint: str,
    direction: int,
    speed: float = 300,
    max_angle: float = 720.0,
    endstop_position: Optional[float] = None,
    poll_interval: float = 0.05,
    avoid_joint: Optional[str] = None,
    avoid_direction: int = +1,
) -> Optional[float]:
    """
    Végállás keresése folyamatos mozgással (feed hold alapú).
    
    Egy nagy G1 mozgást indít, közben pollingol a limit pin-ekre,
    és feed hold-dal állítja le végállás detektálásakor.
    Ez gyorsabb mint a lépésenkénti megoldás.
    
    Args:
        joint: 'J1', 'J2', vagy 'J3'
        direction: +1 (pozitív) vagy -1 (negatív irány)
        speed: Mozgás sebesség (alapért. 800 fok/perc)
        max_angle: Maximum keresési szög (alapért. 720°)
        endstop_position: Ismert végállás pozíció fokban
        poll_interval: Polling gyakoriság másodpercben (alapért. 0.05 = 50ms)
        avoid_joint: Másik joint amit figyelni kell
        avoid_direction: Irány amerre az avoid_joint-ot mozgatni kell
    
    Returns:
        A végállás pozíciója fokban, vagy None ha nem található
    """
    global calibration_stop_requested
    
    if not device:
        print("  Nincs csatlakozva!")
        return None
    
    joint = joint.upper()
    grbl_axis = AXIS_TO_GRBL.get(joint)
    if not grbl_axis:
        print(f"  Ismeretlen joint: {joint}")
        return None
    
    avoid_axis = AXIS_TO_GRBL.get(avoid_joint.upper()) if avoid_joint else None
    
    direction_name = "pozitív" if direction > 0 else "negatív"
    print(f"      Folyamatos keresés {direction_name} irányba ({speed} fok/perc)...")
    
    # Nagy mozgás indítása G91 (inkrementális) módban
    move_distance = direction * max_angle
    await device.send_gcode("G91")  # Inkrementális mód
    
    # G1 mozgás indítása (nem blokkol, azonnal visszatér)
    await device.send_gcode(f"G1 {grbl_axis}{move_distance:.1f} F{speed:.0f}")
    
    # Polling loop - limit pin ellenőrzés mozgás közben
    found_endstop = False
    start_time = asyncio.get_event_loop().time()
    max_time = abs(max_angle) / speed * 60 + 5  # Max idő + 5 mp ráhagyás
    
    while True:
        # Leállítás ellenőrzése
        if calibration_stop_requested:
            await device.send_gcode("!")  # Feed hold
            await asyncio.sleep(0.1)
            await device.send_gcode("\x18")  # Soft reset
            await device.send_gcode("G90")  # Abszolút mód vissza
            print(f"      Leállítva")
            return None
        
        # Limit pin és státusz lekérdezése
        limits = await get_limit_pins()
        status = await device.get_grbl_status()
        
        # Avoid joint kezelése
        if avoid_joint and avoid_axis and limits.get(avoid_axis, False):
            # Feed hold és soft reset - hogy mozgatni tudjunk
            await device.send_gcode("!")  # Feed hold
            await asyncio.sleep(0.1)
            
            # Aktuális pozíció mentése soft reset előtt
            status_before = await device.get_grbl_status()
            saved_positions = {}
            if status_before:
                saved_positions = {
                    'X': status_before['joints']['j2'],
                    'Y': status_before['joints']['j3'],
                    'Z': status_before['joints']['j1'],
                }
            
            # Soft reset és unlock - Hold állapotból kilépés
            await device.send_gcode("\x18")  # Soft reset (Ctrl+X)
            await asyncio.sleep(0.3)
            await device.send_gcode("$X")  # Alarm unlock
            await asyncio.sleep(0.1)
            
            # Pozíció visszaállítása G92-vel
            if saved_positions:
                await device.send_gcode(f"G92 X{saved_positions['X']:.2f} Y{saved_positions['Y']:.2f} Z{saved_positions['Z']:.2f}")
                await asyncio.sleep(0.05)
            
            print(f"      ! {avoid_joint} végálláson - elmozgatás...")
            
            # Avoid joint elmozgatása - nagyobb lépésekkel és több próbálkozással
            avoid_steps = 0
            avoid_step_size = 15.0  # 15° lépésméret (nagyobb, hogy biztosan kikapcsoljon)
            max_avoid_steps = 30    # Max 30 lépés = 450°
            total_moved = 0.0
            while limits.get(avoid_axis, False) and avoid_steps < max_avoid_steps:
                await move_single_axis(avoid_joint, avoid_direction * avoid_step_size, speed=speed)
                await wait_for_idle(timeout=1.0)
                limits = await get_limit_pins()
                avoid_steps += 1
                total_moved += avoid_step_size
                if avoid_steps % 5 == 0:
                    print(f"        ... {total_moved:.0f}° elmozgatva, kapcsoló még aktív")
            
            if limits.get(avoid_axis, False):
                print(f"      ! {avoid_joint} még mindig végálláson {total_moved:.0f}° után!")
            else:
                print(f"      ! {avoid_joint} elmozgatva ({total_moved:.0f}°, {avoid_steps} lépés)")
            
            # Új keresési mozgás indítása (a régit a soft reset törölte)
            # Számoljuk ki mennyi idő telt el és becsüljük a megtett távolságot
            elapsed = asyncio.get_event_loop().time() - start_time
            estimated_moved = (elapsed * speed / 60)  # fok
            remaining_distance = direction * max(10.0, max_angle - estimated_moved)
            
            await device.send_gcode("G91")  # Inkrementális mód
            await device.send_gcode(f"G1 {grbl_axis}{remaining_distance:.1f} F{speed:.0f}")
        
        # Keresett joint végállás ellenőrzése
        if limits.get(grbl_axis, False):
            # Végállás! Feed hold küldése - azonnal megáll
            await device.send_gcode("!")
            
            # Várakozás amíg ténylegesen megáll (Hold állapot)
            for _ in range(20):
                status = await device.get_grbl_status()
                if status:
                    state = status.get('state', '').lower()
                    if 'hold' in state:
                        break
                await asyncio.sleep(0.02)
            
            # Aktuális pozíció mentése MIELŐTT reset-elünk
            status = await device.get_grbl_status()
            saved_positions = {}
            if status and 'joints' in status:
                saved_positions = {
                    'j1': status['joints'].get('j1', 0),
                    'j2': status['joints'].get('j2', 0),
                    'j3': status['joints'].get('j3', 0),
                }
            
            # Soft reset a várakozó mozgások törléséhez
            await device.send_gcode("\x18")  # Ctrl+X = soft reset
            await asyncio.sleep(0.1)
            
            # Alarm unlock ha szükséges
            status = await device.get_grbl_status()
            if status and 'alarm' in status.get('state', '').lower():
                await device.send_gcode("$X")
            
            # Várakozás Idle állapotra
            await wait_for_idle(timeout=0.5)
            
            # Pozíciók visszaállítása G92-vel (soft reset nullázta őket)
            grbl_x = saved_positions.get('j2', 0)
            grbl_y = saved_positions.get('j3', 0)
            grbl_z = saved_positions.get('j1', 0)
            
            # A keresett tengely kapja a végállás pozíciót
            if endstop_position is not None:
                if joint == 'J1':
                    grbl_z = endstop_position
                elif joint == 'J2':
                    grbl_x = endstop_position
                elif joint == 'J3':
                    grbl_y = endstop_position
            
            await device.send_gcode(f"G92 X{grbl_x:.2f} Y{grbl_y:.2f} Z{grbl_z:.2f}")
            await device.send_gcode("G90")  # Abszolút mód
            
            print(f"      Végállás! Pozíció: {joint} = {endstop_position}°")
            found_endstop = True
            break
        
        # Mozgás befejeződött ellenőrzése
        if status and 'idle' in status.get('state', '').lower():
            # Mozgás befejeződött végállás nélkül
            print(f"      Maximum elérve végállás nélkül")
            break
        
        # Timeout ellenőrzés
        elapsed = asyncio.get_event_loop().time() - start_time
        if elapsed > max_time:
            await device.send_gcode("!")  # Feed hold
            await device.send_gcode("\x18")  # Soft reset
            print(f"      Timeout ({max_time:.1f}s)")
            break
        
        await asyncio.sleep(poll_interval)
    
    # Abszolút mód visszaállítása
    await device.send_gcode("G90")
    await wait_for_idle(timeout=2.0)
    
    if found_endstop:
        # A pozíció már be lett állítva a végállás detektálásakor
        return endstop_position
    
    return None


async def search_endstop(
    joint: str,
    direction: int,
    step_size: float = 1.0,
    speed: float = 800,
    max_angle: float = 720.0,
    endstop_position: Optional[float] = None,
    avoid_joint: Optional[str] = None,
    avoid_direction: int = +1,
    pulloff_joint: Optional[str] = "self",
    pulloff_direction: Optional[int] = None,
) -> Optional[float]:
    """
    Végállás keresése lépésenként, limit pin figyelésével.
    
    Kis lépésekben mozgatja a jointot a megadott irányba,
    minden lépés után ellenőrizve a limit pin állapotát.
    Végállás elérésekor G92 paranccsal beállítja az aktuális pozíciót.
    
    Ha avoid_joint meg van adva, figyeli annak végállását is, és ha aktiválódik,
    elmozgatja az avoid_joint-ot az avoid_direction irányba amíg a jel megszűnik.
    
    Args:
        joint: 'J1', 'J2', vagy 'J3'
        direction: +1 (pozitív) vagy -1 (negatív irány)
        step_size: Lépésméret fokban (alapért. 1°)
        speed: Mozgás sebesség (alapért. 800)
        max_angle: Maximum keresési szög (alapért. 720° - 2 teljes fordulat)
        endstop_position: Ismert végállás pozíció fokban. Ha megadva, G92-vel beállítja.
        avoid_joint: Másik joint amit figyelni kell (pl. 'J3' a J2 keresésnél)
        avoid_direction: Irány amerre az avoid_joint-ot mozgatni kell (+1 vagy -1)
        pulloff_joint: Melyik jointon történjen visszahúzás ("self"=keresett joint, 
                       joint név=másik joint, None=nincs visszahúzás)
        pulloff_direction: Visszahúzás iránya (+1/-1). Ha None, ellentétes a keresés irányával.
    
    Returns:
        A végállás pozíciója fokban, vagy None ha leállítva/hiba
    """
    global calibration_stop_requested
    
    if not device:
        print("  ❌ Nincs csatlakozva!")
        return None
    
    # Joint -> GRBL tengely mapping
    joint = joint.upper()
    grbl_axis = AXIS_TO_GRBL.get(joint)
    if not grbl_axis:
        print(f"  ❌ Ismeretlen joint: {joint}")
        return None
    
    # Aktuális pozíció lekérése
    status = await device.get_grbl_status()
    if not status:
        print("  ❌ Státusz lekérdezés sikertelen!")
        return None
    
    joint_key = joint.lower()  # 'j1', 'j2', 'j3'
    start_position = status['joints'].get(joint_key, 0)
    current_offset = 0.0
    steps = 0
    
    direction_name = "pozitív" if direction > 0 else "negatív"
    print(f"      Keresés {direction_name} irányba ({step_size}° lépésekkel)...")
    
    # Avoid joint GRBL tengely meghatározása
    avoid_axis = AXIS_TO_GRBL.get(avoid_joint.upper()) if avoid_joint else None
    
    while abs(current_offset) < max_angle:
        # Leállítás ellenőrzése
        if calibration_stop_requested:
            print(f"      ⛔ Leállítva: {current_offset:.1f}°")
            return None
        
        # Limit pin ellenőrzése MOZGÁS ELŐTT
        limits = await get_limit_pins()
        
        # Avoid joint kezelése - ha a másik joint végállásán van, elmozgatjuk
        if avoid_joint and avoid_axis and limits.get(avoid_axis, False):
            print(f"      ! {avoid_joint} végálláson - elmozgatás...")
            avoid_steps = 0
            avoid_step_size = 15.0  # 15° lépésméret (nagyobb, hogy biztosan kikapcsoljon)
            max_avoid_steps = 30    # Max 30 lépés = 450°
            total_moved = 0.0
            step_timeout = calculate_move_timeout(avoid_step_size, speed)
            while limits.get(avoid_axis, False) and avoid_steps < max_avoid_steps:
                await move_single_axis(avoid_joint, avoid_direction * avoid_step_size, speed=speed)
                await wait_for_idle(timeout=step_timeout)
                limits = await get_limit_pins()
                avoid_steps += 1
                total_moved += avoid_step_size
                if avoid_steps % 5 == 0:
                    print(f"        ... {total_moved:.0f}° elmozgatva, kapcsoló még aktív")
            if not limits.get(avoid_axis, False):
                print(f"      ! {avoid_joint} elmozgatva ({total_moved:.0f}°, {avoid_steps} lépés)")
            else:
                print(f"      ! {avoid_joint} még mindig végálláson {total_moved:.0f}° után!")
            # Frissítjük a limits változót az aktuális állapottal
            limits = await get_limit_pins()
        if limits.get(grbl_axis, False):
            # Végállás már aktív - megtaláltuk!
            print(f"      ✓ Végállás: {current_offset:+.1f}° ({steps} lépés)")
            
            # Várakozás hogy a mozgás biztosan befejeződjön
            await wait_for_idle(timeout=5.0)
            
            # Pozíció beállítása G92-vel ha megadva
            if endstop_position is not None:
                await device.send_gcode(f"G92 {grbl_axis}{endstop_position}")
                print(f"      ✓ Pozíció beállítva: {joint} = {endstop_position}°")
                await asyncio.sleep(0.3)
            
            # Visszahúzás a végállásról
            if pulloff_joint is not None:
                actual_pulloff_joint = joint if pulloff_joint == "self" else pulloff_joint
                actual_pulloff_direction = pulloff_direction if pulloff_direction is not None else -direction
                pulloff_amount = actual_pulloff_direction * 5.0
                print(f"      (pulloff: {actual_pulloff_joint} {pulloff_amount:+.1f}°)")
                pulloff_timeout = calculate_move_timeout(pulloff_amount, speed)
                await move_single_axis(actual_pulloff_joint, pulloff_amount, speed=speed)
                await wait_for_idle(timeout=pulloff_timeout)
            else:
                print(f"      (nincs pulloff)")
            
            return endstop_position if endstop_position is not None else start_position + current_offset
        
        # Mozgás egy lépéssel
        step = direction * step_size
        step_timeout = calculate_move_timeout(step_size, speed)
        success = await move_single_axis(joint, step, speed=speed)
        
        if not success:
            # Mozgás sikertelen - lehet hogy végállás miatt
            await wait_for_idle(timeout=step_timeout)
            limits = await get_limit_pins()
            if limits.get(grbl_axis, False):
                print(f"      ✓ Végállás (mozgás blokkolva): {current_offset:+.1f}° ({steps} lépés)")
                
                # Alarm reset ha szükséges
                status = await device.get_grbl_status()
                if status and 'alarm' in status.get('state', '').lower():
                    await device.send_gcode("$X")
                    await asyncio.sleep(0.3)
                
                # Pozíció beállítása G92-vel ha megadva
                if endstop_position is not None:
                    await device.send_gcode(f"G92 {grbl_axis}{endstop_position}")
                    print(f"      ✓ Pozíció beállítva: {joint} = {endstop_position}°")
                    await asyncio.sleep(0.3)
                
                # Visszahúzás
                if pulloff_joint is not None:
                    actual_pulloff_joint = joint if pulloff_joint == "self" else pulloff_joint
                    actual_pulloff_direction = pulloff_direction if pulloff_direction is not None else -direction
                    pulloff_amount = actual_pulloff_direction * 5.0
                    pulloff_timeout = calculate_move_timeout(pulloff_amount, speed)
                    print(f"      (pulloff blokk után: {actual_pulloff_joint} {pulloff_amount:+.1f}°)")
                    await move_single_axis(actual_pulloff_joint, pulloff_amount, speed=speed)
                    await wait_for_idle(timeout=pulloff_timeout)
                else:
                    print(f"      (nincs pulloff blokk után)")
                
                return endstop_position if endstop_position is not None else start_position + current_offset
            else:
                print(f"      ❌ Mozgás hiba!")
                return None
        
        current_offset += step
        steps += 1
        
        # Várakozás a mozgás befejezésére (timeout a sebesség alapján)
        await wait_for_idle(timeout=step_timeout)
        
        # Limit pin ellenőrzése MOZGÁS UTÁN
        limits = await get_limit_pins()
        if limits.get(grbl_axis, False):
            print(f"      ✓ Végállás: {current_offset:+.1f}° ({steps} lépés)")
            
            # Várakozás hogy a mozgás biztosan befejeződjön
            await wait_for_idle(timeout=step_timeout)
            
            # Alarm reset ha szükséges
            status = await device.get_grbl_status()
            if status and 'alarm' in status.get('state', '').lower():
                await device.send_gcode("$X")
                await asyncio.sleep(0.3)
            
            # Pozíció beállítása G92-vel ha megadva
            if endstop_position is not None:
                await device.send_gcode(f"G92 {grbl_axis}{endstop_position}")
                print(f"      ✓ Pozíció beállítva: {joint} = {endstop_position}°")
                await asyncio.sleep(0.3)
            
            # Visszahúzás a végállásról
            if pulloff_joint is not None:
                actual_pulloff_joint = joint if pulloff_joint == "self" else pulloff_joint
                actual_pulloff_direction = pulloff_direction if pulloff_direction is not None else -direction
                pulloff_amount = actual_pulloff_direction * 5.0
                pulloff_timeout = calculate_move_timeout(pulloff_amount, speed)
                print(f"      (pulloff mozgás után: {actual_pulloff_joint} {pulloff_amount:+.1f}°)")
                await move_single_axis(actual_pulloff_joint, pulloff_amount, speed=speed)
                await wait_for_idle(timeout=pulloff_timeout)
            else:
                print(f"      (nincs pulloff mozgás után)")
            
            return endstop_position if endstop_position is not None else start_position + current_offset
        
        # Progress jelzés
        if steps % 5 == 0:
            print(f"         ... {current_offset:+.1f}°")
    
    # Maximum elérve végállás nélkül
    print(f"      ⚠️  Maximum ({max_angle}°) elérve végállás nélkül!")
    return None


async def calibrate():
    """
    Teljes kalibrációs folyamat.
    
    Lépések:
    1. J2 pozitív végállás keresése (váll felfelé)
    2. J3 negatív végállás keresése (könyök lefelé)
    3. J2 függőlegesre állítása (90° a nullától)
    4. J3 vízszintesre állítása (0°)
    5. J1 pozitív végállás keresése (bázis forgatás)
    
    A kalibráció végén a robotkar home pozícióban van:
    - J2 felfelé (függőleges)
    - J3 vízszintes
    """
    global calibration_stop_requested, calibration_result
    
    if not device:
        print("❌ Nincs csatlakozva!")
        return
    
    # Kalibráció inicializálás
    calibration_stop_requested = False
    calibration_result = None
    
    print("\n" + "="*60)
    print("  KALIBRÁCIÓ INDÍTÁSA")
    print("="*60)
    print("  Ctrl+C = AZONNALI LEÁLLÍTÁS")
    print("="*60)
    
    # Eredmények tárolása
    results = {
        'j2_positive_limit': None,
        'j3_negative_limit': None,
        'j1_positive_limit': None,
        'home_position': {'j1': 0.0, 'j2': 0.0, 'j3': 0.0},
        'timestamp': datetime.now().isoformat(),
        'completed': False,
    }
    
    try:
        # Aktuális pozíció nullázása (ez lesz a referencia)
        print("\n  [0/5] Pozíció nullázása (G92 X0 Y0 Z0)...")
        await device.send_gcode("G92 X0 Y0 Z0")
        await asyncio.sleep(0.5)
        print("        ✓ Nullázva")
        
        # === 1. J2 POZITÍV VÉGÁLLÁS ===
        print("\n  [1/5] J2 (váll) pozitív végállás keresése...")
        if calibration_stop_requested:
            raise KeyboardInterrupt()
        
        j2_limit = await search_endstop_continuous(
            'J2', +1, speed=300,
            endstop_position=ENDSTOP_POSITIONS['J2_max'],
            avoid_joint='J3',
            avoid_direction=+1  # J3 negatív végállásáról pozitív irányba kell mozgatni
        )
        if j2_limit is None:
            if calibration_stop_requested:
                raise KeyboardInterrupt()
            print("        ❌ J2 végállás nem található!")
        else:
            results['j2_positive_limit'] = j2_limit
        
        # === 2. J3 NEGATÍV VÉGÁLLÁS ===
        print("\n  [2/5] J3 (könyök) negatív végállás keresése...")
        if calibration_stop_requested:
            raise KeyboardInterrupt()
        
        j3_limit = await search_endstop_continuous(
            'J3', -1, speed=300,
            endstop_position=ENDSTOP_POSITIONS['J3_min']
        )
        if j3_limit is None:
            if calibration_stop_requested:
                raise KeyboardInterrupt()
            print("        ❌ J3 végállás nem található!")
        else:
            results['j3_negative_limit'] = j3_limit
        
        # === 3. J1 POZITÍV VÉGÁLLÁS ===
        # J2 és J3 maradnak a jelenlegi pozícióban
        print("\n  [3/3] J1 (bázis) pozitív végállás keresése...")
        if calibration_stop_requested:
            raise KeyboardInterrupt()
        
        # Debug: pozíció kiírás J1 keresés előtt
        status = await device.get_grbl_status()
        if status and 'joints' in status:
            print(f"      (pozíció J1 keresés előtt: J1={status['joints'].get('j1', '?'):.1f}°, "
                  f"J2={status['joints'].get('j2', '?'):.1f}°, J3={status['joints'].get('j3', '?'):.1f}°)")
        
        j1_limit = await search_endstop_continuous(
            'J1', +1, speed=300,
            endstop_position=ENDSTOP_POSITIONS['J1_max']
        )
        if j1_limit is None:
            if calibration_stop_requested:
                raise KeyboardInterrupt()
            print("        ❌ J1 végállás nem található!")
        else:
            results['j1_positive_limit'] = j1_limit
        
        # === HOME POZÍCIÓBA ÁLLÁS ===
        # J1 teszt után: J2=90° (függőleges), J3=0° (vízszintes), J1=0° (középen)
        print("\n  Home pozícióba állás (J2=90°, J3=0°, J1=0°)...")
        if calibration_stop_requested:
            raise KeyboardInterrupt()
        
        # Mindhárom tengely egyszerre a home pozícióba (G1 abszolút mozgás)
        # J1=0 -> Z=0, J2=90 -> X=90, J3=0 -> Y=0
        await device.send_gcode("G90")  # Abszolút mód
        await device.send_gcode("G1 X90 Y0 Z0 F3000")  # Gyors mozgás home-ba
        await wait_for_idle(timeout=10.0)
        
        print("      ✓ Home pozíció elérve")
        
        # Home pozíció rögzítése
        status = await device.get_grbl_status()
        if status:
            results['home_position'] = {
                'j1': status['joints']['j1'],
                'j2': status['joints']['j2'],
                'j3': status['joints']['j3'],
            }
        
        results['completed'] = True
        calibration_result = results
        
        # === EREDMÉNYEK KIÍRÁSA ===
        print("\n" + "="*60)
        print("  KALIBRÁCIÓ KÉSZ")
        print("="*60)
        print("\n  Végállások:")
        if results['j2_positive_limit'] is not None:
            print(f"    J2 max: {results['j2_positive_limit']:+.1f}°")
        else:
            print(f"    J2 max: N/A")
        if results['j3_negative_limit'] is not None:
            print(f"    J3 min: {results['j3_negative_limit']:+.1f}°")
        else:
            print(f"    J3 min: N/A")
        if results['j1_positive_limit'] is not None:
            print(f"    J1 max: {results['j1_positive_limit']:+.1f}°")
        else:
            print(f"    J1 max: N/A")
        
        print("\n  Aktuális pozíció (home):")
        hp = results['home_position']
        print(f"    J1: {hp['j1']:.1f}° (bázis)")
        print(f"    J2: {hp['j2']:.1f}° (váll - függőleges)")
        print(f"    J3: {hp['j3']:.1f}° (könyök - vízszintes)")
        print("="*60)
        
    except KeyboardInterrupt:
        print("\n\n  ⛔ KALIBRÁCIÓ LEÁLLÍTVA!")
        await emergency_stop()
        results['completed'] = False
        results['error'] = "Felhasználó leállította"
        calibration_result = results
    except Exception as e:
        print(f"\n  ❌ KALIBRÁCIÓ HIBA: {e}")
        await emergency_stop()
        results['completed'] = False
        results['error'] = str(e)
        calibration_result = results


def setup_calibration_signal_handler():
    """Signal handler beállítása a kalibráció leállításához"""
    global calibration_stop_requested
    
    def signal_handler(sig, frame):
        global calibration_stop_requested
        calibration_stop_requested = True
        print("\n⛔ Ctrl+C - Leállítás kérve...")
    
    signal.signal(signal.SIGINT, signal_handler)


async def test_joint_mode():
    """Joint mód teszt"""
    if not device:
        print("Nincs csatlakozva!")
        return
    
    print("\n" + "="*50)
    print("JOINT MÓD TESZT")
    print("="*50)
    
    await show_status()
    
    while True:
        print("\nJoint mozgatás:")
        print("  1: J1 (bázis) +10°")
        print("  2: J1 (bázis) -10°")
        print("  3: J2 (váll) +10°")
        print("  4: J2 (váll) -10°")
        print("  5: J3 (könyök) +10°")
        print("  6: J3 (könyök) -10°")
        print("  h: Home (J1=0, J2=90, J3=0)")
        print("  s: Státusz")
        print("  q: Vissza a menübe")
        
        cmd = input("> ").strip().lower()
        
        if cmd == 'q':
            break
        elif cmd == 's':
            await show_status()
        elif cmd == 'h':
            print("Home (J1=0, J2=90, J3=0)...")
            await device.move_to_joints(0, 90, 0, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(2)
            await show_status()
        elif cmd == '1':
            print("J1 +10°...")
            await device.jog_joint('J1', 10, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(2)
        elif cmd == '2':
            print("J1 -10°...")
            await device.jog_joint('J1', -10, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(2)
        elif cmd == '3':
            print("J2 +10°...")
            await device.jog_joint('J2', 10, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(2)
        elif cmd == '4':
            print("J2 -10°...")
            await device.jog_joint('J2', -10, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(2)
        elif cmd == '5':
            print("J3 +10°...")
            await device.jog_joint('J3', 10, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(2)
        elif cmd == '6':
            print("J3 -10°...")
            await device.jog_joint('J3', -10, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(2)
        else:
            print("Ismeretlen parancs")


async def test_jog_mode():
    """Jog mód teszt (egyenkénti joint mozgatás)"""
    if not device:
        print("Nincs csatlakozva!")
        return
    
    print("\n" + "="*50)
    print("JOG MÓD TESZT")
    print("="*50)
    
    await show_status()
    
    step = 5.0  # Alapértelmezett lépés
    
    while True:
        print(f"\nJog lépés: {step}°")
        print("  j1+/j1-: J1 (bázis) +/-")
        print("  j2+/j2-: J2 (váll) +/-")
        print("  j3+/j3-: J3 (könyök) +/-")
        print("  step N: Lépés méret beállítása (pl: step 10)")
        print("  h: Home")
        print("  s: Státusz")
        print("  q: Vissza")
        
        cmd = input("> ").strip().lower()
        
        if cmd == 'q':
            break
        elif cmd == 's':
            await show_status()
        elif cmd == 'h':
            print("Home (J1=0, J2=90, J3=0)...")
            await device.move_to_joints(0, 90, 0, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(2)
            await show_status()
        elif cmd.startswith('step '):
            try:
                step = float(cmd.split()[1])
                print(f"Lépés: {step}°")
            except:
                print("Hibás formátum")
        elif cmd == 'j1+':
            await device.jog_joint('J1', step, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(1)
        elif cmd == 'j1-':
            await device.jog_joint('J1', -step, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(1)
        elif cmd == 'j2+':
            await device.jog_joint('J2', step, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(1)
        elif cmd == 'j2-':
            await device.jog_joint('J2', -step, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(1)
        elif cmd == 'j3+':
            await device.jog_joint('J3', step, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(1)
        elif cmd == 'j3-':
            await device.jog_joint('J3', -step, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(1)
        else:
            print("Ismeretlen parancs")


async def test_cartesian_mode():
    """Cartesian mód teszt"""
    if not device:
        print("Nincs csatlakozva!")
        return
    
    print("\n" + "="*50)
    print("CARTESIAN MÓD TESZT")
    print("="*50)
    
    config = device.get_robot_config()
    
    print(f"Robot méretek: L1={config.L1}mm, L2={config.L2}mm, L3={config.L3}mm")
    print(f"Max elérés: {config.L2 + config.L3}mm")
    print()
    print("⚠️  FONTOS: Ha a kar egyenesen ki van nyújtva (j2=0, j3=0),")
    print("    akkor a max elérésen van és nincs mozgástér fel/le!")
    print("    Használd a 'work' parancsot egy jobb kiinduló pozícióhoz.")
    print()
    
    # Aktuális pozíció
    status = await device.get_grbl_status()
    if status:
        j1 = status['joints']['j1']
        j2 = status['joints']['j2']
        j3 = status['joints']['j3']
        cart = forward_kinematics(j1, j2, j3, config)
        print(f"Aktuális joint: J1={j1:.1f}° J2={j2:.1f}° J3={j3:.1f}°")
        print(f"Aktuális cart:  X={cart.x:.1f} Y={cart.y:.1f} Z={cart.z:.1f} mm")
    
    step = 20.0  # mm
    
    while True:
        print(f"\nCartesian lépés: {step}mm")
        print("  x+/x-: X tengely +/-")
        print("  y+/y-: Y tengely +/-")
        print("  z+/z-: Z tengely +/-")
        print("  goto X Y Z: Abszolút pozícióra mozgás")
        print("  ik X Y Z: IK számítás (mozgás nélkül)")
        print("  step N: Lépés méret beállítása")
        print("  --- Egyszerű mozgások (diagnosztika) ---")
        print("  fel/le/elore/hatra: Egyirányú mozgás (joint interpoláció)")
        print("  lfel/lle/lelore/lhatra: Ugyanaz, de lineáris interpolációval")
        print("  box [N]: Négyzet rajzolás (alapért. 30mm)")
        print("  work: Munka pozícióba (J1=0°, J2=45°, J3=0°)")
        print("  h: Home (J1=0, J2=90, J3=0)")
        print("  s: Státusz")
        print("  q: Vissza")
        
        cmd = input("> ").strip().lower()
        
        if cmd == 'q':
            break
        elif cmd == 's':
            await show_status()
            status = await device.get_grbl_status()
            if status:
                j1, j2, j3 = status['joints']['j1'], status['joints']['j2'], status['joints']['j3']
                cart = forward_kinematics(j1, j2, j3, config)
                print(f"FK pozíció: X={cart.x:.1f} Y={cart.y:.1f} Z={cart.z:.1f} mm")
        elif cmd == 'h':
            print("Home (J1=0, J2=90, J3=0)...")
            await device.move_to_joints(0, 90, 0, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(2)
            await show_status()
        elif cmd == 'work':
            print("Munka pozíció (J1=0°, J2=45°, J3=0°)...")
            await device.move_to_joints(0, 45, 0, speed=DEFAULT_TEST_SPEED)
            await asyncio.sleep(2)
            status = await device.get_grbl_status()
            if status:
                j1, j2, j3 = status['joints']['j1'], status['joints']['j2'], status['joints']['j3']
                cart = forward_kinematics(j1, j2, j3, config)
                print(f"Pozíció: X={cart.x:.1f} Y={cart.y:.1f} Z={cart.z:.1f} mm")
        elif cmd in ['fel', 'le', 'elore', 'hatra']:
            # Egyirányú mozgások diagnosztikához
            status = await device.get_grbl_status()
            if not status:
                print("Státusz hiba!")
                continue
            
            j1, j2, j3 = status['joints']['j1'], status['joints']['j2'], status['joints']['j3']
            cart = forward_kinematics(j1, j2, j3, config)
            print(f"Start: X={cart.x:.1f} Y={cart.y:.1f} Z={cart.z:.1f} mm")
            print(f"       J1={j1:.1f}° J2={j2:.1f}° J3={j3:.1f}°")
            
            # Cél pozíció számítása
            if cmd == 'fel':
                nx, ny, nz = cart.x, cart.y, cart.z + step
                print(f"\n>>> FEL {step}mm (csak Z+) <<<")
            elif cmd == 'le':
                nx, ny, nz = cart.x, cart.y, cart.z - step
                print(f"\n>>> LE {step}mm (csak Z-) <<<")
            elif cmd == 'elore':
                nx, ny, nz = cart.x + step, cart.y, cart.z
                print(f"\n>>> ELŐRE {step}mm (csak X+) <<<")
            elif cmd == 'hatra':
                nx, ny, nz = cart.x - step, cart.y, cart.z
                print(f"\n>>> HÁTRA {step}mm (csak X-) <<<")
            
            print(f"Cél: X={nx:.1f} Y={ny:.1f} Z={nz:.1f} mm")
            
            # IK
            angles = inverse_kinematics(nx, ny, nz, config)
            if not angles.valid:
                print(f"❌ IK hiba: {angles.error}")
                continue
            
            # Joint limit ellenőrzés tengelyenként
            limit_errors = []
            if angles.j1 < ENDSTOP_POSITIONS['J1_min']:
                limit_errors.append(f"J1 < min ({angles.j1:.1f}° < {ENDSTOP_POSITIONS['J1_min']}°)")
            if angles.j1 > ENDSTOP_POSITIONS['J1_max']:
                limit_errors.append(f"J1 > max ({angles.j1:.1f}° > {ENDSTOP_POSITIONS['J1_max']}°)")
            if angles.j2 < ENDSTOP_POSITIONS['J2_min']:
                limit_errors.append(f"J2 < min ({angles.j2:.1f}° < {ENDSTOP_POSITIONS['J2_min']}°)")
            if angles.j2 > ENDSTOP_POSITIONS['J2_max']:
                limit_errors.append(f"J2 > max ({angles.j2:.1f}° > {ENDSTOP_POSITIONS['J2_max']}°)")
            if angles.j3 < ENDSTOP_POSITIONS['J3_min']:
                limit_errors.append(f"J3 < min ({angles.j3:.1f}° < {ENDSTOP_POSITIONS['J3_min']}°)")
            if angles.j3 > ENDSTOP_POSITIONS['J3_max']:
                limit_errors.append(f"J3 > max ({angles.j3:.1f}° > {ENDSTOP_POSITIONS['J3_max']}°)")
            
            if limit_errors:
                print(f"❌ Végállás limit: {', '.join(limit_errors)}")
                continue
            
            print(f"Cél joint: J1={angles.j1:.1f}° J2={angles.j2:.1f}° J3={angles.j3:.1f}°")
            print(f"Változás:  ΔJ1={angles.j1-j1:.1f}° ΔJ2={angles.j2-j2:.1f}° ΔJ3={angles.j3-j3:.1f}°")
            
            # Mozgás (sima, nem lineáris interpoláció - hogy lássuk mi történik)
            print("\nMozgás (move_to_xyz - joint interpoláció)...")
            success = await device.move_to_xyz(nx, ny, nz, speed=300)
            print(f"Eredmény: {'✓' if success else '❌'}")
            print("Várakozás a mozgás befejezésére...")
            await asyncio.sleep(5)  # Hosszabb várakozás
            
            # Ellenőrzés
            status = await device.get_grbl_status()
            if status:
                j1, j2, j3 = status['joints']['j1'], status['joints']['j2'], status['joints']['j3']
                cart_end = forward_kinematics(j1, j2, j3, config)
                print(f"\nVége: X={cart_end.x:.1f} Y={cart_end.y:.1f} Z={cart_end.z:.1f} mm")
                print(f"      J1={j1:.1f}° J2={j2:.1f}° J3={j3:.1f}°")
        
        elif cmd in ['lfel', 'lle', 'lelore', 'lhatra']:
            # Lineáris interpolációval mozgás (összehasonlításhoz)
            status = await device.get_grbl_status()
            if not status:
                print("Státusz hiba!")
                continue
            
            j1, j2, j3 = status['joints']['j1'], status['joints']['j2'], status['joints']['j3']
            cart = forward_kinematics(j1, j2, j3, config)
            print(f"Start: X={cart.x:.1f} Y={cart.y:.1f} Z={cart.z:.1f} mm")
            
            # Cél pozíció számítása
            if cmd == 'lfel':
                nx, ny, nz = cart.x, cart.y, cart.z + step
                print(f"\n>>> LINEÁRIS FEL {step}mm <<<")
            elif cmd == 'lle':
                nx, ny, nz = cart.x, cart.y, cart.z - step
                print(f"\n>>> LINEÁRIS LE {step}mm <<<")
            elif cmd == 'lelore':
                nx, ny, nz = cart.x + step, cart.y, cart.z
                print(f"\n>>> LINEÁRIS ELŐRE {step}mm <<<")
            elif cmd == 'lhatra':
                nx, ny, nz = cart.x - step, cart.y, cart.z
                print(f"\n>>> LINEÁRIS HÁTRA {step}mm <<<")
            
            print(f"Cél: X={nx:.1f} Y={ny:.1f} Z={nz:.1f} mm")
            
            # IK ellenőrzés
            angles = inverse_kinematics(nx, ny, nz, config)
            if not angles.valid:
                print(f"❌ IK hiba: {angles.error}")
                continue
            
            # Mozgás LINEÁRIS interpolációval
            print("\nMozgás (move_to_xyz_linear - Cartesian interpoláció)...")
            success = await device.move_to_xyz_linear(nx, ny, nz, speed=300, step_size=5.0)
            print(f"Eredmény: {'✓' if success else '❌'}")
            await asyncio.sleep(1)
            
            # Ellenőrzés
            status = await device.get_grbl_status()
            if status:
                j1, j2, j3 = status['joints']['j1'], status['joints']['j2'], status['joints']['j3']
                cart_end = forward_kinematics(j1, j2, j3, config)
                print(f"\nVége: X={cart_end.x:.1f} Y={cart_end.y:.1f} Z={cart_end.z:.1f} mm")
        
        elif cmd == 'box' or cmd.startswith('box '):
            # Négyzet rajzolás lineáris interpolációval az XZ síkban
            try:
                box_size = 30.0  # Alapértelmezett méret (mm)
                if cmd.startswith('box '):
                    box_size = float(cmd.split()[1])
                
                print(f"\n--- NÉGYZET RAJZOLÁS ({box_size}mm) - Lineáris interpoláció ---")
                print("1. Munka pozícióba mozgás...")
                
                # Először work pozícióba megyünk
                await device.move_to_joints(0, 15, -30, speed=DEFAULT_TEST_SPEED)
                await asyncio.sleep(2)
                
                # Aktuális pozíció lekérdezése
                status = await device.get_grbl_status()
                if not status:
                    print("Státusz hiba!")
                    continue
                
                j1, j2, j3 = status['joints']['j1'], status['joints']['j2'], status['joints']['j3']
                start_pos = forward_kinematics(j1, j2, j3, config)
                print(f"   Start: X={start_pos.x:.1f} Y={start_pos.y:.1f} Z={start_pos.z:.1f} mm")
                
                # Négyzet sarkai (XZ síkban, Y=0 marad):
                #
                #   (2)-------(3)
                #    |         |
                #    |         |
                #   (1)-------(4)
                #  Start
                #
                x, y, z = start_pos.x, start_pos.y, start_pos.z
                
                moves = [
                    ("2. Fel", x, y, z + box_size),
                    ("3. Hátra", x - box_size, y, z + box_size),
                    ("4. Le", x - box_size, y, z),
                    ("5. Előre (vissza)", x, y, z),
                ]
                
                for name, nx, ny, nz in moves:
                    print(f"{name}: X={nx:.1f} Y={ny:.1f} Z={nz:.1f}")
                    
                    # IK ellenőrzés (előzetes)
                    angles = inverse_kinematics(nx, ny, nz, config)
                    if not angles.valid:
                        print(f"   ❌ IK hiba: {angles.error}")
                        print("   Mozgás megszakítva!")
                        break
                    
                    print(f"   Cél IK: J1={angles.j1:.1f}° J2={angles.j2:.1f}° J3={angles.j3:.1f}°")
                    
                    # Lineáris interpolációval mozgás (egyenes vonal a TCP-nek)
                    success = await device.move_to_xyz_linear(nx, ny, nz, speed=300, step_size=5.0)
                    if not success:
                        print("   ❌ Mozgás hiba!")
                        break
                    print("   ✓")
                    await asyncio.sleep(0.5)
                else:
                    print("\n✓ Négyzet kész!")
                
            except ValueError:
                print("Hibás formátum! Használat: box vagy box 30")
            except Exception as e:
                print(f"Hiba: {e}")
        elif cmd.startswith('step '):
            try:
                step = float(cmd.split()[1])
                print(f"Lépés: {step}mm")
            except:
                print("Hibás formátum")
        elif cmd.startswith('ik '):
            try:
                parts = cmd.split()
                x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                angles = inverse_kinematics(x, y, z, config)
                if angles.valid:
                    print(f"IK eredmény: J1={angles.j1:.1f}° J2={angles.j2:.1f}° J3={angles.j3:.1f}°")
                    # FK visszaellenőrzés
                    check = forward_kinematics(angles.j1, angles.j2, angles.j3, config)
                    print(f"FK ellenőrzés: X={check.x:.1f} Y={check.y:.1f} Z={check.z:.1f}")
                else:
                    print(f"IK hiba: {angles.error}")
            except Exception as e:
                print(f"Hiba: {e}")
        elif cmd.startswith('goto '):
            try:
                parts = cmd.split()
                x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                print(f"Mozgás: X={x} Y={y} Z={z}")
                
                # IK
                angles = inverse_kinematics(x, y, z, config)
                if angles.valid:
                    print(f"IK: J1={angles.j1:.1f}° J2={angles.j2:.1f}° J3={angles.j3:.1f}°")
                    success = await device.move_to_xyz(x, y, z, speed=DEFAULT_TEST_SPEED)
                    print(f"Eredmény: {'✓' if success else '❌'}")
                    await asyncio.sleep(3)
                else:
                    print(f"IK hiba: {angles.error}")
            except Exception as e:
                print(f"Hiba: {e}")
        elif cmd in ['x+', 'x-', 'y+', 'y-', 'z+', 'z-']:
            # Relatív mozgás
            status = await device.get_grbl_status()
            if not status:
                print("Státusz hiba")
                continue
            
            j1, j2, j3 = status['joints']['j1'], status['joints']['j2'], status['joints']['j3']
            cart = forward_kinematics(j1, j2, j3, config)
            
            dx = step if cmd == 'x+' else (-step if cmd == 'x-' else 0)
            dy = step if cmd == 'y+' else (-step if cmd == 'y-' else 0)
            dz = step if cmd == 'z+' else (-step if cmd == 'z-' else 0)
            
            new_x, new_y, new_z = cart.x + dx, cart.y + dy, cart.z + dz
            print(f"Cél: X={new_x:.1f} Y={new_y:.1f} Z={new_z:.1f}")
            
            angles = inverse_kinematics(new_x, new_y, new_z, config)
            if angles.valid:
                print(f"IK: J1={angles.j1:.1f}° J2={angles.j2:.1f}° J3={angles.j3:.1f}°")
                success = await device.move_to_xyz(new_x, new_y, new_z, speed=DEFAULT_TEST_SPEED)
                print(f"Eredmény: {'✓' if success else '❌'}")
                await asyncio.sleep(2)
            else:
                print(f"IK hiba: {angles.error}")
        else:
            print("Ismeretlen parancs")


async def send_gcode():
    """Egyedi G-code küldése"""
    if not device:
        print("Nincs csatlakozva!")
        return
    
    print("\n" + "="*50)
    print("G-CODE KÜLDÉS")
    print("="*50)
    print("Írj be G-code parancsot (q = vissza, s = státusz)")
    print("Példák:")
    print("  G1 X90 F500     - J2 90°-ra (váll)")
    print("  G1 Y-30 F500    - J3 -30°-ra (könyök)")
    print("  G1 Z45 F500     - J1 45°-ra (bázis)")
    print("  ?               - GRBL státusz")
    print("  $$              - GRBL beállítások")
    print()
    
    while True:
        cmd = input("GCODE> ").strip()
        if cmd.lower() == 'q':
            break
        if cmd.lower() == 's':
            await show_status()
            continue
        if cmd:
            response = await device.send_gcode(cmd)
            print(f"Válasz: {response}")
            
            # Ha mozgási parancs volt (G0, G1), várunk a befejezésre
            if cmd.upper().startswith('G0') or cmd.upper().startswith('G1'):
                print("Várakozás a mozgás befejezésére...")
                await wait_for_idle(timeout=10.0)
                await show_status()


async def test_pushrod_calibration():
    """
    Pushrod mechanizmus kalibrálása.
    
    A J3 motor a váll közelében van és tolórúddal mozgatja a könyök csuklót.
    Emiatt a motor szög és a valós könyök szög kapcsolata nemlineáris.
    
    Ez a teszt segít meghatározni a pontos kapcsolatot különböző
    motor pozíciókban mért könyök szögekkel.
    """
    if not device:
        print("Nincs csatlakozva!")
        return
    
    print("\n" + "="*50)
    print("PUSHROD KALIBRÁCIÓ")
    print("="*50)
    print()
    print("Ez a teszt segít meghatározni a J3 motor szög és a")
    print("valós könyök szög közötti kapcsolatot.")
    print()
    print("Utasítások:")
    print("  1. A J3 motort különböző pozíciókba állítjuk")
    print("  2. Minden pozíciónál mérd meg a valós könyök szöget")
    print("     (szögmérővel vagy számítással)")
    print("  3. Add meg a mért értéket")
    print()
    print("A 0° könyök szög azt jelenti, hogy az alkar a felkar")
    print("egyenes folytatása. Negatív = lefelé hajlik.")
    print()
    
    # Biztonságos teszt pozíciók (végállásokon belül)
    j3_min = SAFE_LIMITS.get('J3_min', -50.0)
    j3_max = SAFE_LIMITS.get('J3_max', 15.0)
    
    # Csak azokat a pozíciókat teszteljük, amik a biztonságos tartományban vannak
    all_positions = [-90, -60, -45, -30, -15, 0, 15, 30, 45, 60, 90]
    motor_positions = [p for p in all_positions if j3_min <= p <= j3_max]
    
    print(f"J3 biztonságos tartomány: {j3_min}° - {j3_max}°")
    print(f"Tesztelendő pozíciók: {motor_positions}")
    print()
    
    measurements = []
    config = device.get_robot_config()
    
    print("Kezdőpozícióba állás (J2=45°, J3=0°)...")
    await device.move_to_joints(0, 45, 0, speed=300)
    await asyncio.sleep(3)
    
    status = await device.get_grbl_status()
    if status:
        print(f"Jelenlegi: J2={status['joints']['j2']:.1f}° J3={status['joints']['j3']:.1f}°")
    
    print()
    print("Nyomj ENTER-t a kalibráció indításához, vagy 'q' a kilépéshez:")
    if input().strip().lower() == 'q':
        return
    
    for motor_angle in motor_positions:
        print(f"\n--- J3 motor pozíció: {motor_angle}° ---")
        
        # Limit ellenőrzés mozgás előtt
        limits = await get_limit_pins()
        if limits.get('Y', False):  # Y = J3 GRBL-ben
            print(f"  ⚠ J3 limit aktív! Elmozgatás...")
            # Elmozgatás a limitről
            direction = -1 if motor_angle > 0 else +1  # Ellentétes irányba
            for _ in range(10):
                await move_single_axis('J3', direction * 5.0, speed=200)
                await wait_for_idle(timeout=1.0)
                limits = await get_limit_pins()
                if not limits.get('Y', False):
                    print(f"  ✓ J3 limit inaktív")
                    break
            if limits.get('Y', False):
                print(f"  ❌ Nem sikerült eltávolodni a limittől, kihagyva: {motor_angle}°")
                continue
        
        # Mozgás a pozícióba (csak J3, J2 marad)
        print(f"Mozgás J3={motor_angle}°...")
        await device.move_to_joints(0, 45, motor_angle, speed=200)
        await asyncio.sleep(2)
        
        # Ellenőrzés, hogy nem ütköztünk-e limitbe
        limits = await get_limit_pins()
        if limits.get('Y', False):
            print(f"  ⚠ J3 limit aktív {motor_angle}°-nál! Pozíció kihagyva.")
            # Visszamozgás biztonságos pozícióba
            safe_pos = 0 if motor_angle > 0 else -30
            await device.move_to_joints(0, 45, safe_pos, speed=200)
            await asyncio.sleep(2)
            continue
        
        status = await device.get_grbl_status()
        if status:
            print(f"GRBL pozíció: J3={status['joints']['j3']:.1f}°")
        
        # Felhasználói bemenet
        print(f"Add meg a MÉRT valós könyök szöget (vagy 's' = skip, 'q' = kilépés):")
        user_input = input(f"  Valós könyök szög [{motor_angle}]: ").strip()
        
        if user_input.lower() == 'q':
            break
        elif user_input.lower() == 's':
            print("  Kihagyva")
            continue
        elif user_input == '':
            # Ha nincs bemenet, feltételezzük hogy motor szög = könyök szög
            measured = motor_angle
        else:
            try:
                measured = float(user_input)
            except ValueError:
                print("  Érvénytelen szám, kihagyva")
                continue
        
        measurements.append({
            'motor_angle': motor_angle,
            'elbow_angle': measured,
            'difference': measured - motor_angle
        })
        print(f"  Rögzítve: motor={motor_angle}° → könyök={measured}° (diff={measured - motor_angle:+.1f}°)")
    
    # Eredmények
    print("\n" + "="*50)
    print("KALIBRÁCIÓ EREDMÉNYEK")
    print("="*50)
    
    if not measurements:
        print("Nincs mérési adat!")
        return
    
    print("\nMérések:")
    print("-" * 40)
    print(f"{'Motor':>10} {'Könyök':>10} {'Diff':>10}")
    print("-" * 40)
    
    for m in measurements:
        print(f"{m['motor_angle']:>10.1f}° {m['elbow_angle']:>10.1f}° {m['difference']:>+10.1f}°")
    
    # Átlagos különbség
    avg_diff = sum(m['difference'] for m in measurements) / len(measurements)
    max_diff = max(abs(m['difference']) for m in measurements)
    
    print("-" * 40)
    print(f"Átlagos eltérés: {avg_diff:+.1f}°")
    print(f"Max eltérés: {max_diff:.1f}°")
    
    if max_diff < 5:
        print("\n✓ A pushrod hatása minimális (<5°), kompenzáció nem szükséges.")
    else:
        print(f"\n⚠ Jelentős eltérés ({max_diff:.1f}°), pushrod kompenzáció szükséges!")
        print("\nA mérések alapján a kinematics.py PushrodConfig paramétereit")
        print("kell finomhangolni, vagy lookup táblát használni.")
        
        # Lookup tábla generálása
        print("\nLookup tábla (másolható a kinematics.py-ba):")
        print("PUSHROD_LOOKUP = {")
        for m in measurements:
            print(f"    {m['motor_angle']}: {m['elbow_angle']},")
        print("}")


async def main_menu():
    """Főmenü"""
    
    # Signal handler beállítása a kalibráció leállításához
    setup_calibration_signal_handler()
    
    # Csatlakozás
    if not await connect():
        return
    
    try:
        while True:
            print("\n" + "="*50)
            print("FŐMENÜ")
            print("="*50)
            print("  1: Joint mód teszt")
            print("  2: Jog mód teszt")
            print("  3: Cartesian mód teszt")
            print("  4: G-code küldés")
            print("  5: Státusz")
            print("  6: Home (J1=0, J2=90, J3=0)")
            print("  7: Kalibráció (végállások)")
            print("  8: Végállás kapcsoló teszt")
            print("  9: Pushrod kalibráció (J3)")
            print(" 10: Speed tuning (tengely választható)")
            print("  q: Kilépés")
            
            cmd = input("> ").strip().lower()
            
            if cmd == 'q':
                break
            elif cmd == '1':
                await test_joint_mode()
            elif cmd == '2':
                await test_jog_mode()
            elif cmd == '3':
                await test_cartesian_mode()
            elif cmd == '4':
                await send_gcode()
            elif cmd == '5':
                await show_status()
            elif cmd == '6':
                print("Home (J1=0, J2=90, J3=0)...")
                await device.move_to_joints(0, 90, 0, speed=DEFAULT_TEST_SPEED)
                await asyncio.sleep(2)
                await show_status()
            elif cmd == '7':
                await calibrate()
            elif cmd == '8':
                await test_endstop_switches()
            elif cmd == '9':
                await test_pushrod_calibration()
            elif cmd == '10':
                await run_speed_tuning()
            else:
                print("Ismeretlen parancs")
    
    finally:
        if device:
            await device.disconnect()
            print("Kapcsolat bontva")


if __name__ == "__main__":
    asyncio.run(main_menu())
