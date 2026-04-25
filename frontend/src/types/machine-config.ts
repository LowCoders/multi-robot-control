// Machine Configuration Types for 3D Visualization

export type AxisName = 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C' | 'J1' | 'J2' | 'J3' | 'J4' | 'J5' | 'J6'
export type AxisType = 'linear' | 'rotary'
export type MachineType = 'cnc_mill' | 'cnc_lathe' | 'laser_cutter' | '5axis' | 'robot_arm' | 'tube_bender' | 'custom'

// Dynamic limits configuration - limits that depend on another axis position
// Base min/max are derived from the axis's own min/max values
// Formulas:
//   - linear_offset: both limits shift linearly with the dependent axis value
//   - inverse_coupled: upper limit decreases as dependent axis decreases (for 90° coupled arms)
export interface DynamicLimitsConfig {
  dependsOn: AxisName                          // Which axis this depends on
  formula: 'linear_offset' | 'inverse_coupled' // Formula type
  factor?: number                              // Factor for inverse_coupled (default: 0.9)
}

export interface AxisConfig {
  name: AxisName
  type: AxisType
  // null = nincs limit (a tengely szabadon mozoghat ezen az oldalon)
  min: number | null
  max: number | null
  color: string
  // Kinematic chain - which axis moves this one
  parent?: AxisName
  // Visual dimensions for the axis carriage (mm)
  dimensions?: {
    width: number
    height: number
    depth: number
  }
  // Driver-level settings
  invert?: boolean      // Tengely irány invertálása
  scale?: number        // Lépés/fok vagy lépés/mm szorzó
  // Dynamic limits - limits that depend on another axis position
  dynamicLimits?: DynamicLimitsConfig
}

// Home position configuration
export interface HomePositionConfig {
  mode: 'absolute' | 'query'
  // Position values per axis (joint names for robot arms)
  positions?: Record<string, number>
}

// Stall detection settings for closed loop motors
export interface StallDetectionConfig {
  timeout?: number       // Mennyi ideig várjon pozíció változásra (mp)
  tolerance?: number     // Mekkora elmozdulás számít változásnak (fok)
  speed?: number         // Kalibráció keresési sebesség
  maxSearchAngle?: number // Maximum keresési szög
  calibrateJoints?: string[] // Mely tengelyeken keresünk végállást
}

// Closed loop motor configuration
export interface ClosedLoopConfig {
  enabled: boolean
  driverType?: 'servo' | 'stepper_encoder'
  stallDetection?: StallDetectionConfig
}

// Driver-level configuration (stored in machine config, used by backend)
export interface DriverConfig {
  maxFeedRate?: number
  protocol?: string
  grblSettings?: Record<string, number>
  homePosition?: HomePositionConfig
  closedLoop?: ClosedLoopConfig
  supportsPanelController?: boolean
}

export interface SpindleConfig {
  maxRpm: number
  minRpm?: number
  diameter?: number
  length?: number
}

// Lézer modul beállítások (laser_cutter / laser_engraver)
export interface LaserConfig {
  // Maximum power (W vagy spindle S érték a firmware-től függően)
  maxPower: number
  // PWM frekvencia (Hz), opcionális
  pwmFreq?: number
  // Default power amikor csak "on"-t küldünk a UI-ból
  defaultPower?: number
}

// Hűtés / coolant módok
export type CoolantMode = 'flood' | 'mist' | 'air'

export interface CoolantConfig {
  mode?: CoolantMode
  // Egyedi M-kód override-ok (alapértelmezetten M7/M8/M9)
  mGcodeOn?: string
  mGcodeOff?: string
}

// A felhasználó által manuálisan deklarált eszköz-képességek
// (a runtime DeviceCapabilities mellett független, párhuzamos forrás).
// Az effective capabilities ezek + a runtime flagek uniója.
export interface DeclaredCapabilities {
  hasGripper?: boolean
  hasSucker?: boolean
  hasLaser?: boolean
  hasSpindle?: boolean
  hasCoolant?: boolean
  hasProbe?: boolean
  hasToolChanger?: boolean
  hasVacuum?: boolean
  // Numerikus felső határok - runtime fallback ha a backend nem adja meg
  maxLaserPower?: number
  maxSpindleSpeed?: number
}

export interface ToolConfig {
  diameter: number
  length: number
  type?: 'endmill' | 'ballnose' | 'drill' | 'laser' | 'custom'
}

export type EndEffectorType = 'gripper' | 'sucker' | 'none'

export interface EndEffectorConfig {
  type: EndEffectorType
  // Gripper dimensions (mm)
  gripperWidth?: number
  gripperLength?: number
  gripperFingerCount?: number
}

// Robot arm link dimensions for 3D visualization
export interface RobotArmConfig {
  baseDiameter: number     // Bázis átmérő (mm)
  baseHeight: number       // Bázis magasság (mm)
  lowerArmLength: number   // Alsó kar hossz (mm)
  lowerArmWidth: number    // Alsó kar szélesség (mm)
  upperArmLength: number   // Felső kar hossz (mm)
  upperArmWidth: number    // Felső kar szélesség (mm)
  endEffector: EndEffectorConfig
  // Firmware érték -> fok szorzó tengelyenként (alapértelmezés: 1.0)
  // Ha a firmware egysége nem felel meg a fizikai foknak,
  // ezzel kalibrálható a vizualizáció.
  jointAngleScale?: { x?: number; y?: number; z?: number }
  // Vizuális offset fokokban - a firmware értékhez adódik hozzá
  // a 3D modell helyes orientációjához
  jointAngleOffset?: { x?: number; y?: number; z?: number }
}

// Tube bender specific config - 3D vizualizációs paraméterek
export interface TubeBenderConfig {
  // Alap méretei (mm)
  baseLength?: number
  baseWidth?: number
  baseHeight?: number
  // Csőtengely-tartó (SpindleSupport) C-profil geometriája (mm)
  // A C profil X irányba nyitott, hogy a hajlító egység Y motorja
  // körbeforgáskor át tudjon haladni rajta (ne ütközzön a tömör rúdba).
  supportSpineThickness?: number    // gerinc vastagsága X-irányban (default 12)
  supportFlangeThickness?: number   // felső és alsó szár vastagsága Y-irányban (default 12)
  supportChannelOpenSide?: 'positive' | 'negative' // X+ (default) vagy X- felé nyitott
  // Csőtengely méretei (mm)
  tubeSpindleLength?: number
  tubeSpindleDiameter?: number
  // Munkadarab cső méretei (mm)
  tubeDiameter?: number
  tubeLength?: number
  // Hajlítási sugár (mm) - a hajlítókerék hornyának sugara
  bendDieRadius?: number
  // Görgős előtoló méretei (mm)
  feedRollerDiameter?: number
  feedRollerWidth?: number
  // Hajlító egység kar méretei (mm)
  upperArmLength?: number
  lowerArmLength?: number
  armWidth?: number
  // Motor házak méretei (mm)
  motorSize?: number
  // Fix bordástárcsa (mm)
  fixedPulleyDiameter?: number
  fixedPulleyThickness?: number
  // Hajlítókerék (mm)
  bendDieDiameter?: number
  bendDieThickness?: number
  // Drive típus - 'belt' = bordásszíjas + ellensúlyos (default), 'direct' = egyszerűbb
  drive?: 'belt' | 'direct'
  // Vizuális opciók
  showBelt?: boolean
  showCounterweightMotor?: boolean
  showClampDie?: boolean
  // Y motor szíjtárcsa pozíciója: ha true, a tárcsa a motor felett van
  // (ekkor a szíj felfelé fut és a fix bordástárcsa felett halad át).
  // Ha false, a tárcsa a motor alatt (régi viselkedés).
  yMotorPulleyOnTop?: boolean
  // Limitek a vizualizációhoz (max határ a hajlítási és forgatási értékekre)
  maxBendAngle?: number
  // Adattár leírás (firmware/üzemi adatok, opcionális)
  maxTubeDiameter?: number
  minBendRadius?: number
  feedLength?: number
}

export interface MachineConfig {
  id: string
  name: string
  type: MachineType
  axes: AxisConfig[]
  workEnvelope: {
    x: number
    y: number
    z: number
  }
  spindle?: SpindleConfig
  tool?: ToolConfig
  // Lézer modul (csak ha az eszköznek van lézere)
  laser?: LaserConfig
  // Hűtés (coolant) konfiguráció
  coolant?: CoolantConfig
  // Manuálisan deklarált képességek (UI-ról szerkesztve, runtime-mal uniózva)
  declaredCapabilities?: DeclaredCapabilities
  // Robot arm specific config
  robotArm?: RobotArmConfig
  // Tube bender specific config
  tubeBender?: TubeBenderConfig
  // Base/frame dimensions
  base?: {
    width: number
    height: number
    depth: number
  }
  // Visual settings
  visuals?: {
    showGrid?: boolean
    showAxesHelper?: boolean
    backgroundColor?: string
    frameColor?: string      // Gép váz színe
    carriageColor?: string   // Tengelyszán alapszín
    /**
     * A `cameraPosition` / `cameraTarget` koordinátarendszere.
     *   - `'z-up'` (default 2026-04-tól): a V2 vizualizáció CAD-natív Z-up
     *     konvenciója. +X = tengely-előtolás, +Y = operátor felé, +Z = függőleges fel.
     *   - `'y-up'` (legacy): a régi Y-up konvenció, +Y = függőleges fel. A V2
     *     renderer beolvasáskor a megfelelő tengely-csere transzformációt alkalmazza.
     *
     * Új konfigurációkban mindig `'z-up'`-ot használj. A mező hiánya egyenértékű
     * a `'z-up'`-pal a 2026-04-i Phase 10 cleanup után — a régi Y-up alapú
     * konfigokat explicit módon `'y-up'`-tal kell jelölni a migrációhoz.
     */
    coordSystem?: 'z-up' | 'y-up'
    // Default camera position (a fenti coordSystem szerinti koordinátákban)
    cameraPosition?: {
      x: number
      y: number
      z: number
    }
    // Camera look-at target (default: center of work envelope)
    cameraTarget?: {
      x: number
      y: number
      z: number
    }
    cameraFov?: number       // Field of view (degrees)
    /**
     * Felhasználó által manuálisan átállított V2 alkatrész-poz/forg override-ok.
     * Kulcs: registry node id (komponens vagy assembly), érték: parent-lokális
     * opcionális `position` (mm) és/vagy `rotation` (XYZ Euler, rad). Ha jelen
     * van, a renderer és az STL exporter csak a megadott mezőket írja felül; a
     * hiányzó mezők a registry defaultból jönnek. A scale-t nem érinti.
     */
    componentOverrides?: Record<string, {
      position?: [number, number, number]
      rotation?: [number, number, number]
    }>
    /**
     * Felhasználó által manuálisan átállított V2 alkatrész VIZUÁLIS
     * tulajdonság-override-jai (a `componentOverrides` transzformációs
     * párja). Kulcs: registry node id.
     *
     * # Shape (v2)
     *
     * A material-jellegű mezők (`color`, `opacity`, `metalness`,
     * `roughness`) color-scheme-enként (PBR vs. Registry) tárolódnak a
     * `schemes.<mode>` map-ben — így a felhasználó pl. PBR módban más
     * színt / fényességet rendelhet egy alkatrészhez, mint Registry
     * módban, és a két "paletta" függetlenül perzisztálódik.
     *
     * A mode-független mezők (`scale`, `hidden`, `displayName`, `num`)
     * a top-szinten maradnak.
     *
     * # Backward-compat (v1)
     *
     * A régi lapos shape (`{color, opacity, metalness, roughness, ...}`
     * a top szinten) is olvasható — a frontend `loadFromConfig` migrál:
     * a top-level material-mezőket BEEMELI mindkét scheme-be (`pbr` és
     * `registry`), mivel a v1-ben az override colorMode-független volt.
     * Az új mentés mindig az új shape-et írja.
     */
    componentVisualOverrides?: Record<string, {
      schemes?: {
        pbr?: {
          color?: string
          opacity?: number
          metalness?: number
          roughness?: number
        }
        registry?: {
          color?: string
          opacity?: number
          metalness?: number
          roughness?: number
        }
      }
      scale?: [number, number, number]
      hidden?: boolean
      displayName?: string
      num?: string
      // Legacy v1 mezők — már nem írjuk, csak olvasáskor (loadFromConfig)
      // migráljuk schemes alá. Ne használd új kódban.
      /** @deprecated v1 → migrálva schemes.{pbr,registry}.color alá */
      color?: string
      /** @deprecated v1 → migrálva schemes.{pbr,registry}.opacity alá */
      opacity?: number
      /** @deprecated v1 → migrálva schemes.{pbr,registry}.metalness alá */
      metalness?: number
      /** @deprecated v1 → migrálva schemes.{pbr,registry}.roughness alá */
      roughness?: number
    }>
  }
  // Driver-level configuration (used by backend)
  driverConfig?: DriverConfig
}

// Default configurations for common machine types
export const DEFAULT_3AXIS_CNC: MachineConfig = {
  id: 'default_3axis',
  name: 'Default 3-Axis CNC',
  type: 'cnc_mill',
  workEnvelope: { x: 300, y: 400, z: 80 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 300, color: '#ef4444' },
    { name: 'Y', type: 'linear', min: 0, max: 400, color: '#22c55e', parent: 'X' },
    { name: 'Z', type: 'linear', min: -80, max: 0, color: '#3b82f6', parent: 'Y' },
  ],
  spindle: {
    maxRpm: 24000,
    diameter: 52,
    length: 80,
  },
  tool: {
    diameter: 6,
    length: 30,
    type: 'endmill',
  },
  declaredCapabilities: {
    hasSpindle: true,
    hasCoolant: false,
    maxSpindleSpeed: 24000,
  },
  base: {
    width: 400,
    height: 50,
    depth: 500,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
  },
}

export const DEFAULT_5AXIS_CNC: MachineConfig = {
  id: 'default_5axis',
  name: 'Default 5-Axis CNC',
  type: '5axis',
  workEnvelope: { x: 300, y: 300, z: 200 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 300, color: '#ef4444' },
    { name: 'Y', type: 'linear', min: 0, max: 300, color: '#22c55e', parent: 'X' },
    { name: 'Z', type: 'linear', min: -200, max: 0, color: '#3b82f6', parent: 'Y' },
    { name: 'A', type: 'rotary', min: -90, max: 90, color: '#f59e0b', parent: 'Z' },
    { name: 'B', type: 'rotary', min: -180, max: 180, color: '#8b5cf6', parent: 'A' },
  ],
  spindle: {
    maxRpm: 20000,
    diameter: 65,
    length: 100,
  },
  tool: {
    diameter: 6,
    length: 40,
    type: 'endmill',
  },
  declaredCapabilities: {
    hasSpindle: true,
    hasCoolant: false,
    maxSpindleSpeed: 20000,
  },
  base: {
    width: 450,
    height: 80,
    depth: 450,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
  },
}

export const DEFAULT_CNC_LATHE: MachineConfig = {
  id: 'default_lathe',
  name: 'Default CNC Lathe',
  type: 'cnc_lathe',
  workEnvelope: { x: 200, y: 200, z: 400 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 200, color: '#ef4444' },
    { name: 'Z', type: 'linear', min: 0, max: 400, color: '#3b82f6', parent: 'X' },
  ],
  spindle: {
    maxRpm: 4000,
    diameter: 120,
    length: 150,
  },
  tool: {
    diameter: 12,
    length: 25,
    type: 'custom',
  },
  declaredCapabilities: {
    hasSpindle: true,
    hasCoolant: true,
    maxSpindleSpeed: 4000,
  },
  base: {
    width: 300,
    height: 60,
    depth: 500,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
  },
}

export const DEFAULT_LASER_CUTTER: MachineConfig = {
  id: 'default_laser',
  name: 'Default Laser Cutter',
  type: 'laser_cutter',
  workEnvelope: { x: 600, y: 400, z: 50 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 600, color: '#ef4444' },
    { name: 'Y', type: 'linear', min: 0, max: 400, color: '#22c55e', parent: 'X' },
    { name: 'Z', type: 'linear', min: -50, max: 0, color: '#3b82f6', parent: 'Y' },
  ],
  tool: {
    diameter: 0.1,
    length: 20,
    type: 'laser',
  },
  laser: {
    maxPower: 1000,
    pwmFreq: 1000,
    defaultPower: 500,
  },
  declaredCapabilities: {
    hasLaser: true,
    maxLaserPower: 1000,
  },
  base: {
    width: 700,
    height: 40,
    depth: 500,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
  },
}

export const DEFAULT_CUSTOM: MachineConfig = {
  id: 'default_custom',
  name: 'Custom Machine',
  type: 'custom',
  workEnvelope: { x: 200, y: 200, z: 100 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 200, color: '#ef4444' },
    { name: 'Y', type: 'linear', min: 0, max: 200, color: '#22c55e', parent: 'X' },
    { name: 'Z', type: 'linear', min: -100, max: 0, color: '#3b82f6', parent: 'Y' },
  ],
  base: {
    width: 300,
    height: 50,
    depth: 300,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
  },
}

export const DEFAULT_ROBOT_ARM: MachineConfig = {
  id: 'default_robot_arm',
  name: 'Default 3-Axis Robot Arm',
  type: 'robot_arm',
  workEnvelope: { x: 580, y: 580, z: 400 },  // Elérési tartomány (sugár: ~290mm)
  axes: [
    { name: 'X', type: 'rotary', min: -180, max: 180, color: '#ef4444' },             // Bázis forgás (függőleges tengely)
    { name: 'Y', type: 'rotary', min: -90, max: 90, color: '#22c55e', parent: 'X' },  // Váll (vízszintes tengely)
    { name: 'Z', type: 'rotary', min: -120, max: 120, color: '#3b82f6', parent: 'Y' }, // Könyök (vízszintes tengely)
  ],
  robotArm: {
    baseDiameter: 120,
    baseHeight: 60,
    lowerArmLength: 200,
    lowerArmWidth: 50,
    upperArmLength: 200,
    upperArmWidth: 40,
    endEffector: {
      type: 'gripper',
      gripperWidth: 60,
      gripperLength: 50,
      gripperFingerCount: 2,
    },
    jointAngleScale: { x: 1.0, y: 1.0, z: 1.0 },
  },
  declaredCapabilities: {
    hasGripper: true,
    hasSucker: false,
  },
  base: {
    width: 150,
    height: 20,
    depth: 150,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
    coordSystem: 'z-up',
    cameraPosition: { x: 400, y: -400, z: 350 },
    cameraTarget: { x: 0, y: 0, z: 150 },
  },
}

export const DEFAULT_TUBE_BENDER: MachineConfig = {
  id: 'default_tube_bender',
  name: 'Default Csőhajlító',
  type: 'tube_bender',
  // X = cső előtolás (mm), Y = hajlító egység forgatása (°), Z = hajlítási szög (°)
  workEnvelope: { x: 500, y: 360, z: 180 },
  axes: [
    { name: 'X', type: 'linear', min: 0, max: 500, color: '#ef4444' },
    { name: 'Y', type: 'rotary', min: -180, max: 180, color: '#22c55e' },
    { name: 'Z', type: 'rotary', min: -180, max: 180, color: '#3b82f6' },
  ],
  tubeBender: {
    baseLength: 600,
    baseWidth: 200,
    baseHeight: 50,
    supportSpineThickness: 12,
    supportFlangeThickness: 12,
    supportChannelOpenSide: 'positive',
    tubeSpindleLength: 220,
    tubeSpindleDiameter: 40,
    tubeDiameter: 20,
    tubeLength: 600,
    bendDieRadius: 60,
    feedRollerDiameter: 60,
    feedRollerWidth: 40,
    upperArmLength: 150,
    lowerArmLength: 150,
    armWidth: 30,
    motorSize: 50,
    fixedPulleyDiameter: 100,
    fixedPulleyThickness: 20,
    bendDieDiameter: 120,
    bendDieThickness: 30,
    drive: 'belt',
    showBelt: true,
    showCounterweightMotor: true,
    showClampDie: true,
    yMotorPulleyOnTop: true,
    maxBendAngle: 180,
  },
  base: {
    width: 600,
    height: 50,
    depth: 200,
  },
  visuals: {
    showGrid: true,
    showAxesHelper: true,
    coordSystem: 'z-up',
    cameraPosition: { x: 500, y: -500, z: 350 },
    cameraTarget: { x: 0, y: 0, z: 100 },
  },
}

// Get default config for a machine type
export function getDefaultConfigForType(type: MachineType): MachineConfig {
  switch (type) {
    case 'cnc_mill':
      return DEFAULT_3AXIS_CNC
    case '5axis':
      return DEFAULT_5AXIS_CNC
    case 'cnc_lathe':
      return DEFAULT_CNC_LATHE
    case 'laser_cutter':
      return DEFAULT_LASER_CUTTER
    case 'robot_arm':
      return DEFAULT_ROBOT_ARM
    case 'tube_bender':
      return DEFAULT_TUBE_BENDER
    case 'custom':
    default:
      return DEFAULT_CUSTOM
  }
}
