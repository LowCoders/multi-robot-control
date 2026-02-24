"""
Robot Arm Inverse Kinematics
3-DOF robot kar (bázis forgás + váll + könyök)

Méretek:
    L1 = 85mm  (bázis magasság)
    L2 = 140mm (felkar hossz)
    L3 = 165mm (alkar hossz)

GRBL tengely mapping:
    X = J2 (váll)
    Y = J3 (könyök)
    Z = J1 (bázis forgás)

Szög konvenciók:
    J1 (bázis): 0° = +X irány, pozitív = CCW felülről nézve
    J2 (váll): 0° = kar vízszintesen előre, pozitív = felfelé emelés
    J3 (könyök): 0° = alkar egyenesen (felkar folytatása), pozitív = felfelé hajlítás
"""

import math
from dataclasses import dataclass
from typing import Tuple, Optional


@dataclass
class PushrodConfig:
    """
    J3 tolórúd mechanizmus paraméterei.
    
    A motor a váll közelében van és tolórúddal mozgatja a könyök csuklót.
    Ez egy four-bar linkage, ahol a motor szög és a könyök szög kapcsolata
    nemlineáris.
    
    Geometria:
        Motor forgáspont (a váll közelében)
            |
            | r1 (crank - motor kar)
            |
            o-------- r2 (rod - tolórúd) --------o
                                                  |
                                                  | r3 (rocker - alkar kar)
                                                  |
                                            Könyök csukló
    
    Paraméterek:
        r1: Motor kar hossza (crank) - motor tengelytől a rúd csatlakozásig [mm]
        r2: Tolórúd hossza - a két csukló között [mm]
        r3: Alkar kar hossza (rocker) - könyök forgásponttól a rúd csatlakozásig [mm]
        d: Motor tengely és könyök forgáspont távolsága (a felkar mentén) [mm]
        motor_offset: Motor szög offset - milyen motor szögnél van a könyök 0° [fok]
        elbow_offset: Könyök szög offset - korrekcó ha a 0° nem pontos [fok]
    """
    enabled: bool = False         # Pushrod kompenzáció be/ki (False amíg nincs kalibrálva!)
    r1: float = 30.0              # Motor kar (crank) [mm] - MÉRENDŐ!
    r2: float = 140.0              # Tolórúd hossz [mm] - MÉRENDŐ!
    r3: float = 25.0              # Alkar kar (rocker) [mm] - MÉRENDŐ!
    d: float = 140.0               # Motor-könyök távolság [mm] - MÉRENDŐ!
    motor_offset: float = 0.0     # Motor szög offset [fok]
    elbow_offset: float = 0.0     # Könyök szög offset [fok]


@dataclass
class RobotConfig:
    """Robot méretek (mm) és joint limitek (fok)"""
    L1: float = 85.0   # Bázis magasság
    L2: float = 140.0  # Felkar hossz
    L3: float = 165.0  # Alkar hossz
    
    # Joint limitek (fokban) - fizikai végállások alapján
    j1_min: float = -180.0
    j1_max: float = 180.0
    j2_min: float = -10.0    # J2 (váll) minimum - lefelé limit
    j2_max: float = 96.0     # J2 (váll) maximum - felfelé limit (végállás)
    j3_min: float = -55.0    # J3 (könyök) minimum - összecsukott (végállás)
    j3_max: float = 40.0     # J3 (könyök) maximum - kinyújtott (végállás)
    
    # J3 tolórúd mechanizmus konfiguráció
    pushrod: PushrodConfig = None
    
    def __post_init__(self):
        if self.pushrod is None:
            self.pushrod = PushrodConfig()


@dataclass
class JointAngles:
    """Joint szögek fokban"""
    j1: float  # Bázis forgás (Z tengely GRBL-ben)
    j2: float  # Váll (X tengely GRBL-ben)
    j3: float  # Könyök (Y tengely GRBL-ben)
    valid: bool = True
    error: str = ""
    
    def to_grbl(self) -> dict:
        """Konvertálás GRBL tengelyekre"""
        return {
            'X': self.j2,  # Váll
            'Y': self.j3,  # Könyök
            'Z': self.j1,  # Bázis
        }


@dataclass 
class CartesianPosition:
    """Cartesian pozíció mm-ben"""
    x: float
    y: float
    z: float


def motor_angle_to_elbow_angle(motor_angle: float, config: RobotConfig) -> float:
    """
    Motor szög → valós könyök szög konverzió (four-bar linkage).
    
    A tolórúd mechanizmus miatt a motor szög és a könyök szög kapcsolata
    nemlineáris. Ez a függvény kiszámítja a tényleges könyök szöget
    a motor pozíciójából.
    
    Args:
        motor_angle: Motor szög fokban (GRBL Y tengely értéke)
        config: Robot konfiguráció a pushrod paraméterekkel
    
    Returns:
        Valós könyök szög fokban
    """
    if not config.pushrod.enabled:
        return motor_angle
    
    pr = config.pushrod
    
    # Motor szög radiánban (offset-tel korrigálva)
    theta_m = math.radians(motor_angle + pr.motor_offset)
    
    # Four-bar linkage számítás
    # A motor forgatja a crank-et (r1), ami a rod-on (r2) keresztül
    # mozgatja a rocker-t (r3), ami a könyök szögét adja.
    #
    # A motor crank végpontja:
    #   Mx = r1 * cos(theta_m)
    #   My = r1 * sin(theta_m)
    #
    # A könyök forgáspont d távolságra van a motor tengelytől.
    # A rod (r2) összeköti a crank végét és a rocker végét.
    # A rocker (r3) a könyök forgásponthoz csatlakozik.
    
    # Crank végpont (motor koordináta-rendszerben)
    cx = pr.r1 * math.cos(theta_m)
    cy = pr.r1 * math.sin(theta_m)
    
    # Könyök forgáspont pozíciója (a motor tengelyhez képest)
    # Feltételezzük, hogy a könyök a motor tengelytől d távolságra van
    # a felkar mentén (X irányban)
    ex = pr.d
    ey = 0
    
    # Vektor a könyök forgásponttól a crank végéhez
    dx = cx - ex
    dy = cy - ey
    dist = math.sqrt(dx*dx + dy*dy)
    
    # Ellenőrzés: a rod és rocker el tudja-e érni ezt a pozíciót?
    if dist > pr.r2 + pr.r3:
        # Túl messze - teljes nyújtás
        elbow_angle = math.atan2(dy, dx)
    elif dist < abs(pr.r2 - pr.r3):
        # Túl közel - teljesen összehajtva
        elbow_angle = math.atan2(dy, dx) + math.pi
    else:
        # Normál eset: kiszámítjuk a rocker szögét
        # Cosine law: a rocker és a könyök-crank vonal közötti szög
        cos_alpha = (pr.r3**2 + dist**2 - pr.r2**2) / (2 * pr.r3 * dist)
        cos_alpha = max(-1.0, min(1.0, cos_alpha))
        alpha = math.acos(cos_alpha)
        
        # A crank-hez mutató vektor szöge
        base_angle = math.atan2(dy, dx)
        
        # A rocker szöge (feltételezzük "elbow up" konfigurációt)
        elbow_angle = base_angle + alpha
    
    # Konvertálás fokra és offset korrekció
    result = math.degrees(elbow_angle) + pr.elbow_offset
    
    # Normalizálás -180..180 tartományra
    while result > 180:
        result -= 360
    while result < -180:
        result += 360
    
    return result


def elbow_angle_to_motor_angle(elbow_angle: float, config: RobotConfig) -> float:
    """
    Valós könyök szög → motor szög konverzió (inverz four-bar linkage).
    
    Ez az inverz függvény: adott könyök szöghöz meghatározza a szükséges
    motor pozíciót.
    
    Args:
        elbow_angle: Kívánt könyök szög fokban
        config: Robot konfiguráció a pushrod paraméterekkel
    
    Returns:
        Szükséges motor szög fokban (GRBL Y tengely értéke)
    """
    if not config.pushrod.enabled:
        return elbow_angle
    
    pr = config.pushrod
    
    # Könyök szög radiánban (offset-tel korrigálva)
    theta_e = math.radians(elbow_angle - pr.elbow_offset)
    
    # A rocker végpontja (a könyök forgáspontjához képest)
    rx = pr.r3 * math.cos(theta_e)
    ry = pr.r3 * math.sin(theta_e)
    
    # A rocker végpont a motor koordináta-rendszerében
    # (a könyök d távolságra van a motor tengelytől)
    px = pr.d + rx
    py = ry
    
    # A motor crank végének el kell érnie ezt a pontot a rod-on keresztül
    # A crank vég r2 távolságra van ettől a ponttól, r1 távolságra a motor tengelytől
    
    dist = math.sqrt(px*px + py*py)
    
    # Ellenőrzés: a crank és rod el tudja-e érni?
    if dist > pr.r1 + pr.r2:
        # Túl messze
        motor_angle = math.atan2(py, px)
    elif dist < abs(pr.r1 - pr.r2):
        # Túl közel
        motor_angle = math.atan2(py, px) + math.pi
    else:
        # Normál eset: cosine law
        cos_beta = (pr.r1**2 + dist**2 - pr.r2**2) / (2 * pr.r1 * dist)
        cos_beta = max(-1.0, min(1.0, cos_beta))
        beta = math.acos(cos_beta)
        
        base_angle = math.atan2(py, px)
        
        # A motor szöge (feltételezzük megfelelő konfigurációt)
        motor_angle = base_angle - beta
    
    # Konvertálás fokra és offset korrekció
    result = math.degrees(motor_angle) - pr.motor_offset
    
    # Normalizálás -180..180 tartományra
    while result > 180:
        result -= 360
    while result < -180:
        result += 360
    
    return result


def forward_kinematics(
    j1: float, j2: float, j3_motor: float,
    config: RobotConfig = None
) -> CartesianPosition:
    """
    Forward kinematika: Joint szögek → Cartesian (x,y,z)
    
    Args:
        j1: Bázis forgás fokban (0° = +X, CCW pozitív)
        j2: Váll szög fokban (0° = vízszintes, + = fel)
        j3_motor: Könyök MOTOR szög fokban (GRBL Y tengely értéke)
                  Ha pushrod kompenzáció aktív, ez konvertálódik valós könyök szöggé.
        config: Robot méretek
    
    Returns:
        CartesianPosition: x, y, z mm-ben
    """
    if config is None:
        config = RobotConfig()
    
    # Pushrod kompenzáció: motor szög → valós könyök szög
    j3 = motor_angle_to_elbow_angle(j3_motor, config)
    
    j1_rad = math.radians(j1)
    j2_rad = math.radians(j2)
    j3_rad = math.radians(j3)
    
    # Alkar abszolút szöge a vízszinteshez = j2 + j3
    forearm_angle = j2_rad + j3_rad
    
    # Váll pozíció (fix, a bázis tetején)
    # shoulder_x = 0, shoulder_z = L1
    
    # Könyök pozíció
    elbow_r = config.L2 * math.cos(j2_rad)  # vízszintes távolság
    elbow_z = config.L1 + config.L2 * math.sin(j2_rad)  # magasság
    
    # Gripper pozíció
    gripper_r = elbow_r + config.L3 * math.cos(forearm_angle)
    gripper_z = elbow_z + config.L3 * math.sin(forearm_angle)
    
    # 3D pozíció (bázis forgással)
    x = gripper_r * math.cos(j1_rad)
    y = gripper_r * math.sin(j1_rad)
    z = gripper_z
    
    return CartesianPosition(x, y, z)


def inverse_kinematics(
    x: float, y: float, z: float,
    config: RobotConfig = None,
    elbow_up: bool = True
) -> JointAngles:
    """
    Inverz kinematika: Cartesian (x,y,z) → Joint szögek (j1,j2,j3_motor)
    
    Args:
        x, y, z: Robot-fej pozíció mm-ben
        config: Robot méretek
        elbow_up: True = könyök felfelé konfiguráció
    
    Returns:
        JointAngles: j1, j2, j3_motor fokban (j3 a motor szög, nem a valós könyök szög!)
                     Ha pushrod kompenzáció aktív, j3 konvertálva van motor szöggé.
    """
    if config is None:
        config = RobotConfig()
    
    # J1: Bázis forgás (felülnézetből)
    j1 = math.degrees(math.atan2(y, x))
    
    # 2D probléma az r-z síkban
    r = math.sqrt(x*x + y*y)  # vízszintes távolság a bázistól
    h = z - config.L1  # magasság a váll szintje felett
    
    # Távolság a vállízelettől a célpontig
    d_sq = r*r + h*h
    d = math.sqrt(d_sq)
    
    # Speciális eset: célpont nagyon közel van a vállhoz
    if d < 0.001:
        # Váll felett, kar összehajtva
        j3_real = -90
        j3_motor = elbow_angle_to_motor_angle(j3_real, config)
        return JointAngles(j1, 90, j3_motor, True, "")
    
    # Cosine law a könyök belső szögére
    # d² = L2² + L3² - 2*L2*L3*cos(belső_szög)
    # belső_szög = 180° - j3 (ahol j3 a hajlítási szög)
    cos_inner = (config.L2**2 + config.L3**2 - d_sq) / (2 * config.L2 * config.L3)
    cos_inner = max(-1.0, min(1.0, cos_inner))
    
    inner_angle = math.acos(cos_inner)  # Belső szög a könyöknél (radiánban)
    
    # j3_real = valós könyök hajlítási szög (0° = egyenes kar, negatív = behajlítva lefelé)
    j3_rad = -(math.pi - inner_angle)
    if not elbow_up:
        j3_rad = -j3_rad
    
    # Váll szög számítása
    # alpha = szög a vízszinteshez képest a célpont irányába
    alpha = math.atan2(h, r)
    
    # beta = szög a felkar és a váll-célpont vonal között
    # Szinusz tétel: sin(beta)/L3 = sin(inner_angle)/d
    sin_beta = config.L3 * math.sin(inner_angle) / d
    sin_beta = max(-1.0, min(1.0, sin_beta))
    beta = math.asin(sin_beta)
    
    if elbow_up:
        j2_rad = alpha + beta
    else:
        j2_rad = alpha - beta
    
    j2 = math.degrees(j2_rad)
    j3_real = math.degrees(j3_rad)
    
    # Joint limit ellenőrzés
    if j1 < config.j1_min or j1 > config.j1_max:
        return JointAngles(j1, j2, j3_real, False,
                          f"J1 végállás: {j1:.1f}° kívül [{config.j1_min}, {config.j1_max}]")
    if j2 < config.j2_min or j2 > config.j2_max:
        return JointAngles(j1, j2, j3_real, False,
                          f"J2 végállás: {j2:.1f}° kívül [{config.j2_min}, {config.j2_max}]")
    if j3_real < config.j3_min or j3_real > config.j3_max:
        return JointAngles(j1, j2, j3_real, False,
                          f"J3 végállás: {j3_real:.1f}° kívül [{config.j3_min}, {config.j3_max}]")
    
    # Pushrod kompenzáció: valós könyök szög → motor szög
    j3_motor = elbow_angle_to_motor_angle(j3_real, config)
    
    return JointAngles(j1, j2, j3_motor, True, "")


def grbl_to_joints(grbl_pos: dict) -> JointAngles:
    """GRBL pozíció konvertálása joint szögekre"""
    return JointAngles(
        j1=grbl_pos.get('Z', 0),
        j2=grbl_pos.get('X', 0),
        j3=grbl_pos.get('Y', 0),
    )


def joints_to_grbl(joints: JointAngles) -> dict:
    """Joint szögek konvertálása GRBL pozícióra"""
    return joints.to_grbl()


# Teszt
if __name__ == "__main__":
    # Pushrod kompenzáció nélküli teszt
    config_no_pushrod = RobotConfig()
    config_no_pushrod.pushrod.enabled = False
    
    # Pushrod kompenzációval
    config = RobotConfig()
    
    print("=" * 60)
    print("ROBOT KINEMATIKA TESZT")
    print("=" * 60)
    print()
    print("Robot konfiguráció:")
    print(f"  L1 (bázis): {config.L1} mm")
    print(f"  L2 (felkar): {config.L2} mm")
    print(f"  L3 (alkar): {config.L3} mm")
    print(f"  Max elérés: {config.L2 + config.L3} mm")
    print(f"  Min elérés: {abs(config.L2 - config.L3)} mm")
    print()
    print("Pushrod konfiguráció:")
    print(f"  Enabled: {config.pushrod.enabled}")
    print(f"  r1 (motor kar): {config.pushrod.r1} mm")
    print(f"  r2 (tolórúd): {config.pushrod.r2} mm")
    print(f"  r3 (alkar kar): {config.pushrod.r3} mm")
    print(f"  d (motor-könyök táv): {config.pushrod.d} mm")
    print()
    
    # Pushrod konverzió teszt
    print("-" * 60)
    print("Pushrod konverzió teszt (motor szög → könyök szög → motor szög):")
    print("-" * 60)
    for motor_angle in [-90, -60, -30, 0, 30, 60, 90]:
        elbow_angle = motor_angle_to_elbow_angle(motor_angle, config)
        motor_back = elbow_angle_to_motor_angle(elbow_angle, config)
        diff = abs(motor_angle - motor_back)
        status = "✓" if diff < 0.1 else f"✗ (diff={diff:.2f}°)"
        print(f"  Motor {motor_angle:+4.0f}° → Könyök {elbow_angle:+6.1f}° → Motor {motor_back:+6.1f}° {status}")
    print()
    
    # Teszt esetek
    test_cases = [
        (0, 0, 0, "Home (kar egyenesen előre)"),
        (0, 45, 0, "Váll 45° fel, könyök egyenes"),
        (0, 0, -45, "Váll 0°, könyök -45° (motor szög)"),
        (0, 45, -45, "Váll 45°, könyök -45° (motor szög)"),
        (45, 30, -30, "Bázis 45°, váll 30°, könyök -30° (motor szög)"),
    ]
    
    print("-" * 60)
    print("Forward Kinematics teszt (pushrod kompenzációval):")
    print("-" * 60)
    for j1, j2, j3_motor, desc in test_cases:
        pos = forward_kinematics(j1, j2, j3_motor, config)
        j3_real = motor_angle_to_elbow_angle(j3_motor, config)
        print(f"{desc}")
        print(f"  Motor: J1={j1}°, J2={j2}°, J3_motor={j3_motor}°")
        print(f"  Valós könyök: {j3_real:.1f}°")
        print(f"  Pozíció: X={pos.x:.1f}, Y={pos.y:.1f}, Z={pos.z:.1f} mm")
    print()
    
    # IK teszt - különböző célpontok
    print("-" * 60)
    print("Inverse Kinematics teszt (oda-vissza, pushrod kompenzációval):")
    print("-" * 60)
    
    test_positions = [
        (200, 0, 150),
        (150, 150, 200),
        (250, 0, 85),
        (100, 0, 250),
    ]
    
    for x, y, z in test_positions:
        print(f"Cél: ({x}, {y}, {z}) mm")
        
        angles = inverse_kinematics(x, y, z, config)
        if angles.valid:
            j3_real = motor_angle_to_elbow_angle(angles.j3, config)
            print(f"  IK: j1={angles.j1:.1f}°, j2={angles.j2:.1f}°, j3_motor={angles.j3:.1f}° (valós könyök: {j3_real:.1f}°)")
            
            # FK visszaellenőrzés
            check = forward_kinematics(angles.j1, angles.j2, angles.j3, config)
            print(f"  FK: ({check.x:.1f}, {check.y:.1f}, {check.z:.1f}) mm")
            
            error = math.sqrt((check.x - x)**2 + (check.y - y)**2 + (check.z - z)**2)
            status = "✓" if error < 0.1 else "✗"
            print(f"  Hiba: {error:.3f} mm {status}")
        else:
            print(f"  Hiba: {angles.error}")
        print()
