#!/usr/bin/env python3
"""
Robot Arm Interaktív Teszt Szkript
GRBL firmware és vezérlési módok validálása

Használat:
    python test_robot.py
"""

import asyncio
import sys

# Importok
from robot_arm_driver import RobotArmDevice, ControlMode
from kinematics import RobotConfig, forward_kinematics, inverse_kinematics


# Globális device változó
device = None


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
    
    return True


async def show_status():
    """Státusz megjelenítése"""
    if not device:
        print("Nincs csatlakozva!")
        return
    
    print("\n--- STÁTUSZ ---")
    status = await device.get_grbl_status()
    if status:
        print(f"GRBL állapot: {status['state']}")
        print(f"GRBL pozíció: X={status['grbl']['x']:.2f} Y={status['grbl']['y']:.2f} Z={status['grbl']['z']:.2f}")
        print(f"Joint szögek: J1={status['joints']['j1']:.1f}° J2={status['joints']['j2']:.1f}° J3={status['joints']['j3']:.1f}°")
        if status.get('cartesian'):
            print(f"Cartesian (FK): X={status['cartesian']['x']:.1f}mm Y={status['cartesian']['y']:.1f}mm Z={status['cartesian']['z']:.1f}mm")
    else:
        print("Státusz lekérdezés sikertelen")


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
        print("  h: Home (0, 0, 0)")
        print("  s: Státusz")
        print("  q: Vissza a menübe")
        
        cmd = input("> ").strip().lower()
        
        if cmd == 'q':
            break
        elif cmd == 's':
            await show_status()
        elif cmd == 'h':
            print("Home...")
            await device.move_to_joints(0, 0, 0, speed=500)
            await asyncio.sleep(2)
            await show_status()
        elif cmd == '1':
            print("J1 +10°...")
            await device.jog_joint('J1', 10, speed=500)
            await asyncio.sleep(2)
        elif cmd == '2':
            print("J1 -10°...")
            await device.jog_joint('J1', -10, speed=500)
            await asyncio.sleep(2)
        elif cmd == '3':
            print("J2 +10°...")
            await device.jog_joint('J2', 10, speed=500)
            await asyncio.sleep(2)
        elif cmd == '4':
            print("J2 -10°...")
            await device.jog_joint('J2', -10, speed=500)
            await asyncio.sleep(2)
        elif cmd == '5':
            print("J3 +10°...")
            await device.jog_joint('J3', 10, speed=500)
            await asyncio.sleep(2)
        elif cmd == '6':
            print("J3 -10°...")
            await device.jog_joint('J3', -10, speed=500)
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
            await device.move_to_joints(0, 0, 0, speed=500)
            await asyncio.sleep(2)
            await show_status()
        elif cmd.startswith('step '):
            try:
                step = float(cmd.split()[1])
                print(f"Lépés: {step}°")
            except:
                print("Hibás formátum")
        elif cmd == 'j1+':
            await device.jog_joint('J1', step, speed=500)
            await asyncio.sleep(1)
        elif cmd == 'j1-':
            await device.jog_joint('J1', -step, speed=500)
            await asyncio.sleep(1)
        elif cmd == 'j2+':
            await device.jog_joint('J2', step, speed=500)
            await asyncio.sleep(1)
        elif cmd == 'j2-':
            await device.jog_joint('J2', -step, speed=500)
            await asyncio.sleep(1)
        elif cmd == 'j3+':
            await device.jog_joint('J3', step, speed=500)
            await asyncio.sleep(1)
        elif cmd == 'j3-':
            await device.jog_joint('J3', -step, speed=500)
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
        print("  work: Munka pozícióba (j2=15, j3=-30) - van mozgástér!")
        print("  h: Home (j1=0, j2=0, j3=0) - max elérés!")
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
            print("Home (max elérés - nincs mozgástér fel/le)...")
            await device.move_to_joints(0, 0, 0, speed=500)
            await asyncio.sleep(2)
            await show_status()
        elif cmd == 'work':
            print("Munka pozíció (j2=15°, j3=-30° - van mozgástér)...")
            await device.move_to_joints(0, 15, -30, speed=500)
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
                await device.move_to_joints(0, 15, -30, speed=500)
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
                    success = await device.move_to_xyz(x, y, z, speed=500)
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
                success = await device.move_to_xyz(new_x, new_y, new_z, speed=500)
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
    print("Írj be G-code parancsot (q = vissza)")
    
    while True:
        cmd = input("GCODE> ").strip()
        if cmd.lower() == 'q':
            break
        if cmd:
            response = await device.send_gcode(cmd)
            print(f"Válasz: {response}")


async def main_menu():
    """Főmenü"""
    
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
            print("  6: Home (0, 0, 0)")
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
                print("Home...")
                await device.move_to_joints(0, 0, 0, speed=500)
                await asyncio.sleep(2)
                await show_status()
            else:
                print("Ismeretlen parancs")
    
    finally:
        if device:
            await device.disconnect()
            print("Kapcsolat bontva")


if __name__ == "__main__":
    asyncio.run(main_menu())
