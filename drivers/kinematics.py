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
class RobotConfig:
    """Robot méretek (mm)"""
    L1: float = 85.0   # Bázis magasság
    L2: float = 140.0  # Felkar hossz
    L3: float = 165.0  # Alkar hossz


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


def forward_kinematics(
    j1: float, j2: float, j3: float,
    config: RobotConfig = None
) -> CartesianPosition:
    """
    Forward kinematika: Joint szögek → Cartesian (x,y,z)
    
    Args:
        j1: Bázis forgás fokban (0° = +X, CCW pozitív)
        j2: Váll szög fokban (0° = vízszintes, + = fel)
        j3: Könyök szög fokban (0° = egyenes, + = hajlít fel)
        config: Robot méretek
    
    Returns:
        CartesianPosition: x, y, z mm-ben
    """
    if config is None:
        config = RobotConfig()
    
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
    Inverz kinematika: Cartesian (x,y,z) → Joint szögek (j1,j2,j3)
    
    Args:
        x, y, z: Robot-fej pozíció mm-ben
        config: Robot méretek
        elbow_up: True = könyök felfelé konfiguráció
    
    Returns:
        JointAngles: j1, j2, j3 fokban, valid flag, error message
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
    
    # Elérhetőség ellenőrzés
    max_reach = config.L2 + config.L3
    min_reach = abs(config.L2 - config.L3)
    
    if d > max_reach:
        return JointAngles(j1, 0, 0, False, 
                          f"Túl messze: {d:.1f}mm > {max_reach:.1f}mm")
    if d < min_reach and d > 0.001:
        return JointAngles(j1, 0, 0, False,
                          f"Túl közel: {d:.1f}mm < {min_reach:.1f}mm")
    if d < 0.001:
        return JointAngles(j1, 90, -90, True, "")  # Váll felett, kar összehajtva
    
    # Cosine law a könyök belső szögére
    # d² = L2² + L3² - 2*L2*L3*cos(belső_szög)
    # belső_szög = 180° - j3 (ahol j3 a hajlítási szög)
    cos_inner = (config.L2**2 + config.L3**2 - d_sq) / (2 * config.L2 * config.L3)
    cos_inner = max(-1.0, min(1.0, cos_inner))
    
    inner_angle = math.acos(cos_inner)  # Belső szög a könyöknél (radiánban)
    
    # j3 = hajlítási szög (0° = egyenes kar, negatív = könyök behajlítva lefelé)
    # Az FK-ban j3 pozitív = felfelé hajlít, de a tipikus robot kar
    # konfigurációban a könyök lefelé hajlik (negatív j3)
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
    j3 = math.degrees(j3_rad)
    
    return JointAngles(j1, j2, j3, True, "")


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
    config = RobotConfig()
    
    print("Robot konfiguráció:")
    print(f"  L1 (bázis): {config.L1} mm")
    print(f"  L2 (felkar): {config.L2} mm")
    print(f"  L3 (alkar): {config.L3} mm")
    print(f"  Max elérés: {config.L2 + config.L3} mm")
    print(f"  Min elérés: {abs(config.L2 - config.L3)} mm")
    print()
    
    # Teszt esetek
    test_cases = [
        (0, 0, 0, "Home (kar egyenesen előre)"),
        (0, 45, 0, "Váll 45° fel, könyök egyenes"),
        (0, 0, 45, "Váll 0°, könyök 45° hajlítva"),
        (0, 45, 45, "Váll 45°, könyök 45°"),
        (45, 30, 30, "Bázis 45°, váll 30°, könyök 30°"),
    ]
    
    print("Forward Kinematics teszt:")
    print("-" * 60)
    for j1, j2, j3, desc in test_cases:
        pos = forward_kinematics(j1, j2, j3, config)
        print(f"{desc}")
        print(f"  J: ({j1}°, {j2}°, {j3}°) → X={pos.x:.1f}, Y={pos.y:.1f}, Z={pos.z:.1f} mm")
    print()
    
    # IK teszt - különböző célpontok
    print("Inverse Kinematics teszt (oda-vissza):")
    print("-" * 60)
    
    test_positions = [
        (200, 0, 150),
        (150, 150, 200),
        (250, 0, 85),  # Max elérés közelében, váll magasságban
        (100, 0, 250),
    ]
    
    for x, y, z in test_positions:
        print(f"Cél: ({x}, {y}, {z}) mm")
        
        angles = inverse_kinematics(x, y, z, config)
        if angles.valid:
            print(f"  IK: j1={angles.j1:.1f}°, j2={angles.j2:.1f}°, j3={angles.j3:.1f}°")
            
            # FK visszaellenőrzés
            check = forward_kinematics(angles.j1, angles.j2, angles.j3, config)
            print(f"  FK: ({check.x:.1f}, {check.y:.1f}, {check.z:.1f}) mm")
            
            error = math.sqrt((check.x - x)**2 + (check.y - y)**2 + (check.z - z)**2)
            status = "✓" if error < 0.1 else "✗"
            print(f"  Hiba: {error:.3f} mm {status}")
        else:
            print(f"  Hiba: {angles.error}")
        print()
