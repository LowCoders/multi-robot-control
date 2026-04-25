/**
 * Csőhajlító komponens-regiszter (single source of truth).
 *
 * 7 top-level assembly + 43 komponens, Z-up CAD világban (+X csőelőtolás,
 * +Y operátor, +Z fel). A világtájolást a komponensek `transform.rotation`
 * (Euler XYZ) adja meg; a részegységek pozíciói az assembly-origók és a
 * builder-konvenció (lásd `types.ts`) alapján könnyen hangolhatók.
 *
 * Csoportok (parent: null, mind gyökér-szintű):
 *   1) base-assembly      — base lemez
 *   2) bracket-assembly    — X-bracket sandwich (bracket-1, bracket-2, mounting-rods)
 *   3) spindle-assembly   — spindle: SHF20, EK20, slip-ring (axis +Y)
 *   4) x-drive-assembly  — NEMA 23 X + bevel pár + pinionok + gear-bracket
 *                           (a 2 db Ø8 tengely a gear-bracket-en belül van)
 *   5) tensioner-assembly   — U-groove görgő
 *   6) y-drive-assembly  — HTD pulley pár (70T + 15T)
 *   7) z-drive-assembly  — bolygóhajtómű + NEMA 23 Z motor
 *
 * Tájolási konvenciók (rotation Euler XYZ):
 *   - Álló konzol/lemez (builder +Y = magasság): [π/2, π/2, 0] → +Y→+Z (fel),
 *     +Z→+X (cutout előre).
 *   - Hengeres alkatrész vízszintes shafttal +X mentén (motor X-en): [π/2, π/2, 0].
 *   - Hengeres alkatrész vízszintes shafttal +Y mentén (tengely-csoport): [π/2, 0, 0].
 *     (builder +Z → world -Y; +Y "felül" → world +Z; bore világ Y-tengely körüli.)
 *   - Hengeres alkatrész függőleges shafttal +Z mentén (gearbox, Z-motor): identity.
 *   - Shaft8mm builder +Y = saját tengely. A gear-bracket alatt rotation
 *     [π/2, 0, 0] forgatja: builder +Y → bracket +Z (= world +X).
 */
import { generatePartColor } from './colors'
import type {
  AssemblyDef,
  ComponentDef,
  LodLevel,
  RegistryNode,
} from './types'
import { isComponent } from './types'
import {
  BASE_PLATE_ANCHORS,
  BASE_PLATE_DIMENSIONS,
  BasePlateMedium,
  BasePlateRealistic,
  BasePlateSchematic,
  FRONT_PLATE_DIMENSIONS,
  FrontPlateMedium,
  FrontPlateRealistic,
  FrontPlateSchematic,
  BEVEL_GEAR_ANCHORS,
  BEVEL_GEAR_DIMENSIONS,
  BevelGearMedium,
  BevelGearRealistic,
  BevelGearSchematic,
  EK20_BEARING_ANCHORS,
  EK20_BEARING_DIMENSIONS,
  EK20BearingMedium,
  EK20BearingRealistic,
  EK20BearingSchematic,
  X_GEAR_BRACKET_ANCHORS,
  X_GEAR_BRACKET_DIMENSIONS,
  XGearBracketMedium,
  XGearBracketRealistic,
  XGearBracketSchematic,
  Y_BELT_DIMENSIONS,
  Y_PULLEY_15T_DIMENSIONS,
  Y_PULLEY_70T_DIMENSIONS,
  YBeltMedium,
  YBeltRealistic,
  YBeltSchematic,
  YPulley15TMedium,
  YPulley15TRealistic,
  YPulley15TSchematic,
  YPulley70TMedium,
  YPulley70TRealistic,
  YPulley70TSchematic,
  FEED_ROLLER_DIMENSIONS,
  FeedRollerMedium,
  FeedRollerRealistic,
  FeedRollerSchematic,
  MOUNTING_RODS_ANCHORS,
  MOUNTING_RODS_DIMENSIONS,
  MountingRodsMedium,
  MountingRodsRealistic,
  MountingRodsSchematic,
  Y_MOTOR_MOUNTING_RODS_ANCHORS,
  Y_MOTOR_MOUNTING_RODS_DIMENSIONS,
  YMotorMountingRodsMedium,
  YMotorMountingRodsRealistic,
  YMotorMountingRodsSchematic,
  NEMA23_MOTOR_ANCHORS,
  NEMA23_MOTOR_DIMENSIONS,
  Z_MOTOR_ANCHORS,
  Z_MOTOR_DIMENSIONS,
  Nema23MotorMedium,
  Nema23MotorRealistic,
  Nema23MotorSchematic,
  ZMotorMedium,
  ZMotorRealistic,
  ZMotorSchematic,
  PINION_GEAR_ANCHORS,
  PINION_GEAR_DIMENSIONS,
  PinionGearMedium,
  PinionGearRealistic,
  PinionGearSchematic,
  Z_DRIVE_CONNECTOR_PLATE_DIMENSIONS,
  ZDriveConnectorPlateMedium,
  ZDriveConnectorPlateRealistic,
  ZDriveConnectorPlateSchematic,
  Z_GEARBOX_ANCHORS,
  Z_GEARBOX_DIMENSIONS,
  ZGearboxMedium,
  ZGearboxRealistic,
  ZGearboxSchematic,
  SHAFT_8MM_DIMENSIONS,
  SHAFT_SUPPORT_DIMENSIONS,
  Shaft8mmMedium,
  Shaft8mmRealistic,
  Shaft8mmSchematic,
  ShaftSupportMedium,
  ShaftSupportRealistic,
  ShaftSupportSchematic,
  SPINDLE_DRILLED_BLOCK_DIMENSIONS,
  SpindleDrilledBlockMedium,
  SpindleDrilledBlockRealistic,
  SpindleDrilledBlockSchematic,
  SPINDLE_ROD_PLATE_DIMENSIONS,
  SpindleRodPlateLeftMedium,
  SpindleRodPlateLeftRealistic,
  SpindleRodPlateLeftSchematic,
  SpindleRodPlateRightMedium,
  SpindleRodPlateRightRealistic,
  SpindleRodPlateRightSchematic,
  SLIP_RING_ANCHORS,
  SLIP_RING_DIMENSIONS,
  SlipRingMedium,
  SlipRingRealistic,
  SlipRingSchematic,
  TUBE_SHAFT_DIMENSIONS,
  TubeShaftMedium,
  TubeShaftRealistic,
  TubeShaftSchematic,
  TENSIONER_ROLLER_ANCHORS,
  TENSIONER_ROLLER_DIMENSIONS,
  TensionerRollerMedium,
  TensionerRollerRealistic,
  TensionerRollerSchematic,
  THREADED_ROD_8X120_DIMENSIONS,
  ThreadedRod8x120Medium,
  ThreadedRod8x120Realistic,
  ThreadedRod8x120Schematic,
  VERTICAL_BRACKET_1_ANCHORS,
  VERTICAL_BRACKET_1_DIMENSIONS,
  VERTICAL_BRACKET_2_ANCHORS,
  VERTICAL_BRACKET_2_DIMENSIONS,
  VerticalBracket1Medium,
  VerticalBracket1Realistic,
  VerticalBracket1Schematic,
  VerticalBracket2Medium,
  VerticalBracket2Realistic,
  VerticalBracket2Schematic,
  X_DRIVE_BOTTOM_PLATE_DIMENSIONS,
  X_DRIVE_MIDDLE_PLATE_DIMENSIONS,
  X_DRIVE_TOP_PLATE_DIMENSIONS,
  XDriveBottomPlateMedium,
  XDriveBottomPlateRealistic,
  XDriveBottomPlateSchematic,
  XDriveMiddlePlateMedium,
  XDriveMiddlePlateRealistic,
  XDriveMiddlePlateSchematic,
  XDriveTopPlateMedium,
  XDriveTopPlateRealistic,
  XDriveTopPlateSchematic,
} from './parts'

const PI2 = Math.PI / 2


// Konzol-szint méretek (egy helyen hangolható)
// KONZOL_WORLD_X: a felhasználó által áthelyezett (override-ból bekerült) érték.
// Ezt és a többi *_WORLD_X konstanst úgy állítottuk be, hogy a leszármazott
// elemek default poziciója pontosan az override-okból bekerült értékeknek
// feleljen meg (l. lentebb a komponensek transform-jainak kommentjét).
const KONZOL_WORLD_X = -90
const KONZOL_WORLD_Y = 0
const BRACKET_1_HALF_HEIGHT = VERTICAL_BRACKET_1_DIMENSIONS.height / 2
const BRACKET_2_HALF_HEIGHT = VERTICAL_BRACKET_2_DIMENSIONS.height / 2
const MOTOR_X_OFFSET = 60 // motor body átnyúlik a bracket-1 cutoutján
// Bracket-2 X-eltolása konzol-lokálisan: felhasználói layout-pozíció.
// A korábbi zseb megszűnt, a #3 átmenő motor- és kábelbox-kivágással marad
// a jelenlegi helyén.
const BRACKET_2_DX = -40

// Bracket assembly fedő-/előlap layout helper-ek.
const X_DRIVE_TOP_PLATE_X = 65
const X_DRIVE_BOTTOM_PLATE_X = 105
const X_DRIVE_BOTTOM_PLATE_Z = 116.7
const X_SHAFT_1_POSITION: [number, number, number] = [93, 0, 10]
const X_SHAFT_2_POSITION: [number, number, number] = [132, 0, 35]
const X_SHAFT_2_SCALE: [number, number, number] = [1, 0.6224066390041494, 1]
const DRIVE_SHAFT_1_GROUP_POSITION: [number, number, number] = [
  X_SHAFT_1_POSITION[0],
  X_SHAFT_1_POSITION[1],
  0,
]
const SECONDARY_DRIVE_SHAFT_GROUP_POSITION: [number, number, number] = [
  X_SHAFT_2_POSITION[0],
  X_SHAFT_2_POSITION[1],
  0,
]
const SECONDARY_DRIVE_SHAFT_COPY_GROUP_POSITION: [number, number, number] = [112.5,17,0]
const FEED_ROLLER_1_Z =
  X_SHAFT_1_POSITION[2] + SHAFT_8MM_DIMENSIONS.length / 2 + FEED_ROLLER_DIMENSIONS.height / 2
const FEED_ROLLER_2_Z =
  X_SHAFT_2_POSITION[2] +
  (SHAFT_8MM_DIMENSIONS.length * X_SHAFT_2_SCALE[1]) / 2 +
  FEED_ROLLER_DIMENSIONS.height / 2

// Tengely-csoport világpozíciója (Y-tengely körüli forgás).
// X-et a felhasználói override értékre frissítve (-140), Y/Z változatlan
// (azok eredetileg is megfeleltek az override-nak).
const TENGELY_WORLD_X = -140
const TENGELY_WORLD_Y = -50  // base hátsó éle felé
const TENGELY_WORLD_Z = 100  // base teteje (z=0) fölött 100 mm-rel

const SPINDLE_DRILLED_BLOCK_1_POSITION: [number, number, number] = [310, 24, 123]
const SPINDLE_DRILLED_BLOCK_2_POSITION: [number, number, number] = [310, 100, 123]
const SPINDLE_DRILLED_BLOCK_THREAD_ROD_Z_OFFSET =
  THREADED_ROD_8X120_DIMENSIONS.length / 2 - SPINDLE_DRILLED_BLOCK_DIMENSIONS.heightZ / 2

function threadedRodPositionInBlock(edgeX: number): [number, number, number] {
  return [edgeX, 0, SPINDLE_DRILLED_BLOCK_THREAD_ROD_Z_OFFSET]
}

// Z-hajtás világpozíciója (X felhasználói override-ból frissítve)
const ZDRIVE_WORLD_X = -442.8734728244047
const ZDRIVE_WORLD_Y = 0
const ZDRIVE_WORLD_Z = 0  // base teteje
const GEARBOX_HALF_LEN = Z_GEARBOX_DIMENSIONS.bodyTotalLength / 2
const Z_GEARBOX_POSITION: [number, number, number] = [
  667.8082727242237,
  11.326209289351254,
  90.64841645331325,
]
const Z_DRIVE_CONNECTOR_PLATE_POSITION: [number, number, number] = [
  617.091,
  11.326,
  Z_GEARBOX_POSITION[2] + GEARBOX_HALF_LEN + Z_DRIVE_CONNECTOR_PLATE_DIMENSIONS.thicknessZ / 2,
]

export const TUBE_BENDER_REGISTRY: RegistryNode[] = [
  // ===========================================================================
  // 1) ALAP — a teljes szerelvény talp-lemeze
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'base-assembly',
    nameHu: 'Alap',
    nameEn: 'Base',
    parentId: null,
    transform: { position: [0, 0, 0] },
    descriptionHu: 'A keretszerkezet alapja: a base lemezt tartalmazza.',
    descriptionEn: 'Frame base assembly: contains the base plate.',
  },
  {
    id: 'base-plate',
    num: 1,
    nameHu: 'alaplemez',
    nameEn: 'base plate',
    color: generatePartColor(0),
    parentId: 'base-assembly',
    transform: {
      // Z-up natív: lemez közepe Z = -H/2; teteje a world Z = 0 síkon.
      position: [0, 0, -BASE_PLATE_DIMENSIONS.height / 2],
    },
    bbox: {
      size: [BASE_PLATE_DIMENSIONS.length, BASE_PLATE_DIMENSIONS.depth, BASE_PLATE_DIMENSIONS.height],
    },
    anchors: BASE_PLATE_ANCHORS,
    builders: {
      schematic: BasePlateSchematic,
      medium: BasePlateMedium,
      realistic: BasePlateRealistic,
    },
    descriptionEn:
      'Base plate (Z-up native): 600 (X) × 200 (Y, depth) × 8 (Z, thickness). Top surface at world Z=0.',
    descriptionHu:
      'Alaplemez (Z-up natív): 600 (X) × 200 (Y, mélység) × 8 (Z, vastagság). Felső lap a világ Z=0 síkon.',
  },

  // ===========================================================================
  // 2) KONZOL — X-tengelyes hajtás bracket-sandwich szerkezete
  //    (a motor maga az X-hajtás csoportban van)
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'bracket-assembly',
    nameHu: 'Konzol',
    nameEn: 'Bracket assembly',
    parentId: null,
    transform: {
      // A konzol-szerelvény origója a base-tetőn, +X-ben eltolva.
      // Egy helyen módosítva az egész konzol-csoport elmozdul.
      position: [KONZOL_WORLD_X, KONZOL_WORLD_Y, 0],
    },
    descriptionHu:
      'X-tengelyes konzol: 2 függőleges alumínium lemez (bracket 1 elöl, 2 hátul) + 4 db M5 menetes szár, melyek közé a NEMA 23 motor van fogva.',
    descriptionEn:
      'X-axis bracket sandwich: two vertical aluminium plates (bracket 1 front, bracket 2 rear) plus four M5 threaded rods clamping the NEMA 23 motor.',
  },
  {
    id: 'vertical-bracket-1',
    num: 2,
    nameHu: 'függőleges konzol 1 (elöl, cutout)',
    nameEn: 'vertical bracket 1 (front, cutout)',
    color: generatePartColor(1),
    parentId: 'bracket-assembly',
    transform: {
      // Bracket-1 a bracket-assembly origójához képest +10 mm-rel +X-en
      // (felhasználó által áthelyezve), állva a base-tetőn (Z = magasság fele).
      // Rotation: builder +Y (magasság) → world +Z, +Z (cutout normál) → world +X.
      position: [40, 20, BRACKET_1_HALF_HEIGHT],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      size: [
        VERTICAL_BRACKET_1_DIMENSIONS.width,
        VERTICAL_BRACKET_1_DIMENSIONS.height,
        VERTICAL_BRACKET_1_DIMENSIONS.thickness,
      ],
    },
    anchors: VERTICAL_BRACKET_1_ANCHORS,
    builders: {
      schematic: VerticalBracket1Schematic,
      medium: VerticalBracket1Medium,
      realistic: VerticalBracket1Realistic,
    },
    descriptionEn:
      'Aluminium vertical bracket plate with NEMA 23 corner-indent cutout and 4 × Ø5.1 holes for M5 threaded rods.',
    descriptionHu:
      'Alumínium függőleges tartólemez NEMA 23 sarok-indent cutouttal + 4 db Ø5.1 furat (47.14 pattern) az M5 menetes szárakhoz. Cutout +X felé néz.',
  },
  {
    id: 'vertical-bracket-2',
    num: 3,
    nameHu: 'függőleges konzol 2 (hátul, zseb)',
    nameEn: 'vertical bracket 2 (rear, pocket)',
    color: generatePartColor(2),
    parentId: 'bracket-assembly',
    transform: {
      position: [BRACKET_2_DX, 20, BRACKET_2_HALF_HEIGHT],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      size: [
        VERTICAL_BRACKET_2_DIMENSIONS.width,
        VERTICAL_BRACKET_2_DIMENSIONS.height,
        VERTICAL_BRACKET_2_DIMENSIONS.thickness,
      ],
    },
    anchors: VERTICAL_BRACKET_2_ANCHORS,
    builders: {
      schematic: VerticalBracket2Schematic,
      medium: VerticalBracket2Medium,
      realistic: VerticalBracket2Realistic,
    },
    descriptionEn:
      'Rear aluminium bracket with 4 mm pocket for the NEMA 23 back face plus 4 × Ø5.1 through-holes.',
    descriptionHu:
      'Hátsó alumínium tartólemez 4 mm-es zsebbel a NEMA 23 motor hátlapjához + 4 db Ø5.1 átmenő furat.',
  },
  {
    id: 'mounting-rods',
    num: 4,
    nameHu: 'motor rögzítő menetes szárak (4× M5)',
    nameEn: 'motor mounting threaded rods (4× M5)',
    color: generatePartColor(3),
    parentId: 'bracket-assembly',
    transform: {
      // A 4 szár a motor tengelyén futnak; builder +Z = motor axis → world +X.
      // X-en a felhasználó áthelyezte (+4 mm), Z a bracket cutout-középvonalához
      // finomhangolva.
      position: [20, 0, 150],
      rotation: [PI2, PI2, -PI2],
    },
    bbox: {
      size: [
        47.14 + MOUNTING_RODS_DIMENSIONS.rodDiam,
        47.14 + MOUNTING_RODS_DIMENSIONS.rodDiam,
        MOUNTING_RODS_DIMENSIONS.rodLength,
      ],
    },
    anchors: MOUNTING_RODS_ANCHORS,
    builders: {
      schematic: MountingRodsSchematic,
      medium: MountingRodsMedium,
      realistic: MountingRodsRealistic,
    },
    descriptionEn:
      'Four plain M5 threaded rods on the NEMA 23 47.14 mm mounting-hole pattern.',
    descriptionHu:
      '4 db sima M5 menetes szár a NEMA 23 47.14 mm-es rögzítőfurat-kiosztásán.',
  },

  // ===========================================================================
  // 3) TENGELY — központi forgó (Y-tengely körüli): SHF20, EK20, slip-ring.
  //    A bore-tengely világ +Y/-Y mentén. (A 2 db Ø8 tengely a gear-bracket
  //    alá került — lásd 4) X HAJTÁS.)
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'spindle-assembly',
    nameHu: 'Tengely',
    nameEn: 'Spindle assembly',
    parentId: null,
    transform: {
      position: [TENGELY_WORLD_X, TENGELY_WORLD_Y, TENGELY_WORLD_Z],
    },
    descriptionHu:
      'Központi csőhajlító forgótengely (Y körüli forgás): SHF20 támasz, EK20 csapágy és slip-ring.',
    descriptionEn:
      'Central tube-bender spindle (rotates around world Y): SHF20 support, EK20 bearing and slip ring.',
  },
  {
    id: 'shaft-support',
    num: 5,
    nameHu: 'tengelytámasz SHF20 (Ø20)',
    nameEn: 'shaft support SHF20 (Ø20)',
    color: generatePartColor(4),
    parentId: 'spindle-assembly',
    transform: {
      // Felhasználói pozíció a spindle-assembly parent-frame-ben (override-ból
      // beemelve). A rotation [π/2, π/2, 0]: builder +Y → world +Z (függőleges
      // támasz), builder +Z → world +X (bore szögben — a felhasználó a tengelyt
      // a finomhangolás során X-irányba forgatta).
      position: [210, 62, 110],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      size: [
        SHAFT_SUPPORT_DIMENSIONS.totalWidth,
        SHAFT_SUPPORT_DIMENSIONS.totalHeight,
        SHAFT_SUPPORT_DIMENSIONS.totalThickness,
      ],
    },
    builders: {
      schematic: ShaftSupportSchematic,
      medium: ShaftSupportMedium,
      realistic: ShaftSupportRealistic,
    },
    descriptionEn:
      'SHF20-style shaft support (60 × 50 × 30 mm), Ø20 bore with vertical clamp slot and M5 clamp screw.',
    descriptionHu:
      'SHF20 stílusú tengelytámasz (60 × 50 × 30 mm), Ø20 bore függőleges szorítóréssel és M5 szorítócsavarral. Felhasználó által áthelyezve a spindle-assembly-n belül.',
  },
  {
    id: 'ek20-bearing',
    num: 6,
    nameHu: 'EK20 csapágytartó (Ø20, fixed)',
    nameEn: 'EK20 bearing block (Ø20, fixed side)',
    color: generatePartColor(5),
    parentId: 'spindle-assembly',
    transform: {
      // Felhasználói pozíció a spindle-assembly parent-frame-ben.
      // Rotation [π/2, π/2, 0]: builder +Y → world +Z, builder +Z → world +X
      // (bore axis a felhasználó által X-irányba forgatva).
      position: [310, 62, 119],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      size: [
        EK20_BEARING_DIMENSIONS.blockWidth,
        EK20_BEARING_DIMENSIONS.blockHeight,
        EK20_BEARING_DIMENSIONS.blockLengthAxial,
      ],
    },
    anchors: EK20_BEARING_ANCHORS,
    builders: {
      schematic: EK20BearingSchematic,
      medium: EK20BearingMedium,
      realistic: EK20BearingRealistic,
    },
    descriptionEn:
      'HIWIN EK20 bearing block for Ø20 ball screw fixed side (BK–EK pair). Bore axis along world +X (user-rotated).',
    descriptionHu:
      'HIWIN EK20 csapágytartó blokk Ø20-as golyósorsóhoz (fixed oldal). Felhasználó által áthelyezve és X-irányba forgatva a spindle-assembly-n belül.',
  },
  {
    id: 'slip-ring',
    num: 7,
    nameHu: 'csúszógyűrű H2056-12 (12 csatorna)',
    nameEn: 'slip ring H2056-12 (12 channels)',
    color: generatePartColor(6),
    parentId: 'spindle-assembly',
    transform: {
      // Felhasználói pozíció a spindle-assembly parent-frame-ben.
      // Rotation [π/2, π/2, 0]: builder +Y → world +Z, builder +Z → world +X
      // (a többi tengely-csoport elemmel egybeforgatva).
      position: [250, 62, 115],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      size: [
        SLIP_RING_DIMENSIONS.outerDiam,
        SLIP_RING_DIMENSIONS.outerDiam,
        SLIP_RING_DIMENSIONS.totalAxialLength,
      ],
    },
    anchors: SLIP_RING_ANCHORS,
    builders: {
      schematic: SlipRingSchematic,
      medium: SlipRingMedium,
      realistic: SlipRingRealistic,
    },
    descriptionEn:
      'SENRING H2056-12 through-bore slip ring (Ø20 bore / Ø56 OD, 12 ch × 10 A). Bore axis along world -Y.',
    descriptionHu:
      'SENRING H2056-12 átmenő furatos csúszógyűrű (Ø20 / Ø56, 12 csatorna × 10 A). Bore világ -Y mentén.',
  },
  {
    id: 'tube-shaft',
    num: 21,
    nameHu: 'csőtengely (Ø20 / Ø14 × 180)',
    nameEn: 'tube shaft (Ø20 / Ø14 × 180)',
    color: generatePartColor(20),
    parentId: 'spindle-assembly',
    transform: {
      // builder +Y = saját tengely (lathe rotációs tengely). Rotation [0, 0, -π/2]
      // forgatja a builder +Y-t a világ +X-re — a felhasználói specifikáció:
      // "x irányba áll". A pozíció a felhasználó által áthelyezett értékre
      // (override-ból beemelve), a spindle-assembly parent-frame-ében.
      position: [299, 62, 115],
      rotation: [0, 0, -PI2],
    },
    bbox: {
      // bbox builder-lokális (a rotation előtti) tájolásban: a hossz +Y mentén.
      size: [
        TUBE_SHAFT_DIMENSIONS.outerDiameter,
        TUBE_SHAFT_DIMENSIONS.length,
        TUBE_SHAFT_DIMENSIONS.outerDiameter,
      ],
    },
    builders: {
      schematic: TubeShaftSchematic,
      medium: TubeShaftMedium,
      realistic: TubeShaftRealistic,
    },
    descriptionEn:
      'Hollow tube shaft (OD Ø20 / bore Ø14, length 180 mm). Mounted along world +X inside the spindle assembly.',
    descriptionHu:
      'Üreges csőtengely (külső Ø20 / furat Ø14, hossz 180 mm). A spindle assembly-ben világ +X irányba áll.',
  },
  {
    id: 'spindle-drilled-block-1',
    num: 32,
    nameHu: 'fúrt hasáb #1 (42×20×15, Ø8)',
    nameEn: 'drilled block #1 (42×20×15, Ø8)',
    color: generatePartColor(32),
    parentId: 'spindle-assembly',
    transform: {
      position: SPINDLE_DRILLED_BLOCK_1_POSITION,
    },
    bbox: {
      size: [
        SPINDLE_DRILLED_BLOCK_DIMENSIONS.widthX,
        SPINDLE_DRILLED_BLOCK_DIMENSIONS.lengthY,
        SPINDLE_DRILLED_BLOCK_DIMENSIONS.heightZ,
      ],
    },
    builders: {
      schematic: SpindleDrilledBlockSchematic,
      medium: SpindleDrilledBlockMedium,
      realistic: SpindleDrilledBlockRealistic,
    },
    descriptionEn:
      'Rectangular spindle block, 42 mm wide, 20 mm long, 15 mm high, with centered Ø8 vertical and lengthwise through-holes.',
    descriptionHu:
      'Spindle hasáb: 42 mm széles, 20 mm hosszú, 15 mm magas; középen Ø8 függőleges és Ø8 hosszanti átmenő furattal.',
  },
  {
    id: 'spindle-drilled-block-2',
    num: 33,
    nameHu: 'fúrt hasáb #2 (42×20×15, Ø8)',
    nameEn: 'drilled block #2 (42×20×15, Ø8)',
    color: generatePartColor(33),
    parentId: 'spindle-assembly',
    transform: {
      position: SPINDLE_DRILLED_BLOCK_2_POSITION,
    },
    bbox: {
      size: [
        SPINDLE_DRILLED_BLOCK_DIMENSIONS.widthX,
        SPINDLE_DRILLED_BLOCK_DIMENSIONS.lengthY,
        SPINDLE_DRILLED_BLOCK_DIMENSIONS.heightZ,
      ],
    },
    builders: {
      schematic: SpindleDrilledBlockSchematic,
      medium: SpindleDrilledBlockMedium,
      realistic: SpindleDrilledBlockRealistic,
    },
    descriptionEn:
      'Second rectangular spindle block, matching block #1, with centered Ø8 vertical and lengthwise through-holes.',
    descriptionHu:
      'A #1 fúrt hasábbal megegyező spindle elem, középen Ø8 függőleges és Ø8 hosszanti átmenő furattal.',
  },
  {
    id: 'spindle-block-1-threaded-rod-left',
    num: 34,
    nameHu: 'M8 menetes szár #1 bal (120)',
    nameEn: 'M8 threaded rod #1 left (120)',
    color: generatePartColor(34),
    parentId: 'spindle-drilled-block-1',
    transform: {
      position: threadedRodPositionInBlock(
        -SPINDLE_DRILLED_BLOCK_DIMENSIONS.edgeHoleCenterX,
      ),
    },
    bbox: {
      size: [
        THREADED_ROD_8X120_DIMENSIONS.diameter,
        THREADED_ROD_8X120_DIMENSIONS.diameter,
        THREADED_ROD_8X120_DIMENSIONS.length,
      ],
    },
    builders: {
      schematic: ThreadedRod8x120Schematic,
      medium: ThreadedRod8x120Medium,
      realistic: ThreadedRod8x120Realistic,
    },
    descriptionEn:
      'Ø8 × 120 mm threaded rod in the left outer hole of drilled block #1, with its bottom end aligned to the block bottom.',
    descriptionHu:
      'Ø8 × 120 mm menetes szár az #1 fúrt hasáb bal szélső furatában, az alsó vége a hasáb aljáig ér.',
  },
  {
    id: 'spindle-block-1-threaded-rod-right',
    num: 35,
    nameHu: 'M8 menetes szár #1 jobb (120)',
    nameEn: 'M8 threaded rod #1 right (120)',
    color: generatePartColor(35),
    parentId: 'spindle-drilled-block-1',
    transform: {
      position: threadedRodPositionInBlock(
        SPINDLE_DRILLED_BLOCK_DIMENSIONS.edgeHoleCenterX,
      ),
    },
    bbox: {
      size: [
        THREADED_ROD_8X120_DIMENSIONS.diameter,
        THREADED_ROD_8X120_DIMENSIONS.diameter,
        THREADED_ROD_8X120_DIMENSIONS.length,
      ],
    },
    builders: {
      schematic: ThreadedRod8x120Schematic,
      medium: ThreadedRod8x120Medium,
      realistic: ThreadedRod8x120Realistic,
    },
    descriptionEn:
      'Ø8 × 120 mm threaded rod in the right outer hole of drilled block #1, with its bottom end aligned to the block bottom.',
    descriptionHu:
      'Ø8 × 120 mm menetes szár az #1 fúrt hasáb jobb szélső furatában, az alsó vége a hasáb aljáig ér.',
  },
  {
    id: 'spindle-block-2-threaded-rod-left',
    num: 36,
    nameHu: 'M8 menetes szár #2 bal (120)',
    nameEn: 'M8 threaded rod #2 left (120)',
    color: generatePartColor(36),
    parentId: 'spindle-drilled-block-2',
    transform: {
      position: threadedRodPositionInBlock(
        -SPINDLE_DRILLED_BLOCK_DIMENSIONS.edgeHoleCenterX,
      ),
    },
    bbox: {
      size: [
        THREADED_ROD_8X120_DIMENSIONS.diameter,
        THREADED_ROD_8X120_DIMENSIONS.diameter,
        THREADED_ROD_8X120_DIMENSIONS.length,
      ],
    },
    builders: {
      schematic: ThreadedRod8x120Schematic,
      medium: ThreadedRod8x120Medium,
      realistic: ThreadedRod8x120Realistic,
    },
    descriptionEn:
      'Ø8 × 120 mm threaded rod in the left outer hole of drilled block #2, with its bottom end aligned to the block bottom.',
    descriptionHu:
      'Ø8 × 120 mm menetes szár a #2 fúrt hasáb bal szélső furatában, az alsó vége a hasáb aljáig ér.',
  },
  {
    id: 'spindle-block-2-threaded-rod-right',
    num: 37,
    nameHu: 'M8 menetes szár #2 jobb (120)',
    nameEn: 'M8 threaded rod #2 right (120)',
    color: generatePartColor(37),
    parentId: 'spindle-drilled-block-2',
    transform: {
      position: threadedRodPositionInBlock(
        SPINDLE_DRILLED_BLOCK_DIMENSIONS.edgeHoleCenterX,
      ),
    },
    bbox: {
      size: [
        THREADED_ROD_8X120_DIMENSIONS.diameter,
        THREADED_ROD_8X120_DIMENSIONS.diameter,
        THREADED_ROD_8X120_DIMENSIONS.length,
      ],
    },
    builders: {
      schematic: ThreadedRod8x120Schematic,
      medium: ThreadedRod8x120Medium,
      realistic: ThreadedRod8x120Realistic,
    },
    descriptionEn:
      'Ø8 × 120 mm threaded rod in the right outer hole of drilled block #2, with its bottom end aligned to the block bottom.',
    descriptionHu:
      'Ø8 × 120 mm menetes szár a #2 fúrt hasáb jobb szélső furatában, az alsó vége a hasáb aljáig ér.',
  },
  {
    id: 'spindle-rod-plate-left',
    num: 38,
    nameHu: 'alu menetes szár lap bal fél (21×90×10)',
    nameEn: 'aluminium threaded rod plate left half (21×90×10)',
    color: generatePartColor(38),
    parentId: 'spindle-assembly',
    transform: {
      position: [298,62,238],
    },
    bbox: {
      size: [
        SPINDLE_ROD_PLATE_DIMENSIONS.halfWidthX,
        SPINDLE_ROD_PLATE_DIMENSIONS.lengthY,
        SPINDLE_ROD_PLATE_DIMENSIONS.thicknessZ,
      ],
    },
    builders: {
      schematic: SpindleRodPlateLeftSchematic,
      medium: SpindleRodPlateLeftMedium,
      realistic: SpindleRodPlateLeftRealistic,
    },
    descriptionEn:
      'Left half of the 42 × 90 × 10 mm aluminium rod plate after a lengthwise split, with two Ø8 threaded-rod holes.',
    descriptionHu:
      'A 42 × 90 × 10 mm alumínium menetes szár lap bal fele hosszirányú vágás után, két Ø8 furattal.',
  },
  {
    id: 'spindle-rod-plate-right',
    num: 39,
    nameHu: 'alu menetes szár lap jobb fél (21×90×10)',
    nameEn: 'aluminium threaded rod plate right half (21×90×10)',
    color: generatePartColor(39),
    parentId: 'spindle-assembly',
    transform: {
      position: [321.5, 62, 238],
    },
    bbox: {
      size: [
        SPINDLE_ROD_PLATE_DIMENSIONS.halfWidthX,
        SPINDLE_ROD_PLATE_DIMENSIONS.lengthY,
        SPINDLE_ROD_PLATE_DIMENSIONS.thicknessZ,
      ],
    },
    builders: {
      schematic: SpindleRodPlateRightSchematic,
      medium: SpindleRodPlateRightMedium,
      realistic: SpindleRodPlateRightRealistic,
    },
    descriptionEn:
      'Right half of the 42 × 90 × 10 mm aluminium rod plate after a lengthwise split, with two Ø8 threaded-rod holes.',
    descriptionHu:
      'A 42 × 90 × 10 mm alumínium menetes szár lap jobb fele hosszirányú vágás után, két Ø8 furattal.',
  },
  {
    id: 'spindle-rod-plate-left-upper',
    num: 42,
    nameHu: 'alu menetes szár lap bal fél felső (21×90×10)',
    nameEn: 'upper aluminium threaded rod plate left half (21×90×10)',
    color: generatePartColor(42),
    parentId: 'spindle-assembly',
    transform: {
      position: [298, 62, 298],
    },
    bbox: {
      size: [
        SPINDLE_ROD_PLATE_DIMENSIONS.halfWidthX,
        SPINDLE_ROD_PLATE_DIMENSIONS.lengthY,
        SPINDLE_ROD_PLATE_DIMENSIONS.thicknessZ,
      ],
    },
    builders: {
      schematic: SpindleRodPlateLeftSchematic,
      medium: SpindleRodPlateLeftMedium,
      realistic: SpindleRodPlateLeftRealistic,
    },
    descriptionEn:
      'Copy of component #38, placed 60 mm higher in +Z within the spindle assembly.',
    descriptionHu:
      'A #38 elem másolata, 60 mm-rel magasabban (+Z) elhelyezve a spindle assembly-ben.',
  },
  {
    id: 'spindle-rod-plate-right-upper',
    num: 43,
    nameHu: 'alu menetes szár lap jobb fél felső (21×90×10)',
    nameEn: 'upper aluminium threaded rod plate right half (21×90×10)',
    color: generatePartColor(43),
    parentId: 'spindle-assembly',
    transform: {
      position: [321.5, 62, 298],
    },
    bbox: {
      size: [
        SPINDLE_ROD_PLATE_DIMENSIONS.halfWidthX,
        SPINDLE_ROD_PLATE_DIMENSIONS.lengthY,
        SPINDLE_ROD_PLATE_DIMENSIONS.thicknessZ,
      ],
    },
    builders: {
      schematic: SpindleRodPlateRightSchematic,
      medium: SpindleRodPlateRightMedium,
      realistic: SpindleRodPlateRightRealistic,
    },
    descriptionEn:
      'Copy of component #39, placed 60 mm higher in +Z within the spindle assembly.',
    descriptionHu:
      'A #39 elem másolata, 60 mm-rel magasabban (+Z) elhelyezve a spindle assembly-ben.',
  },

  // ===========================================================================
  // 4) X HAJTÁS — NEMA 23 motor + bevel pár + pinionok + gear-bracket
  //    A motor a konzol bracket-1 cutoutjában áll. A 2 db Ø8 acéltengely
  //    a gear-bracket alá tartozik (a fogaskerekek tengelyei).
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'x-drive-assembly',
    nameHu: 'X hajtás',
    nameEn: 'X drive',
    parentId: null,
    transform: {
      // Az x-hajtás origója a konzol bracket-1 cutout-jának világpozíciójához
      // illeszkedik: X = konzol world-X (-90) + bracket-1 előlap fele (5),
      // Z a bracket cutout-magasságához finomhangolva.
      position: [-85, 0, 150],
    },
    descriptionHu:
      'X-tengelyes léptetőhajtás csoport: NEMA 23 motor + 90°-os bevel pár + 2 pinion + gear-bracket + 2 tengely. A #14 és #15 tengely köré külön hajtótengely-egységek szervezik a koaxiális elemeket.',
    descriptionEn:
      'X-axis stepper drive group: NEMA 23 motor + 90° bevel pair + 2 pinions + gear bracket + 2 shafts. The coaxial parts around shafts #14 and #15 are grouped into dedicated drive-shaft assemblies.',
  },
  {
    id: 'x-motor',
    num: 8,
    nameHu: 'NEMA 23 motor (X tengely, 122 mm)',
    nameEn: 'NEMA 23 motor (X axis, 122 mm)',
    color: generatePartColor(9),
    parentId: 'x-drive-assembly',
    transform: {
      // Builder +Z = motor shaft → rotation [π/2, π/2, 0] mappolja világ +X-re;
      // builder +Y (kábelbevezető oldal) → world +Z (felfelé).
      // Pozíció: motor body közepe a cutoutból +X-irányba MOTOR_X_OFFSET-tel kiállva,
      // a motor body (122 mm) -X irányba nyúlik a cutout-tól.
      position: [0, 0, 0],
      rotation: [3 * PI2, PI2, 0],
    },
    bbox: {
      size: [
        NEMA23_MOTOR_DIMENSIONS.bodySize,
        NEMA23_MOTOR_DIMENSIONS.bodySize,
        NEMA23_MOTOR_DIMENSIONS.bodyLength,
      ],
    },
    anchors: NEMA23_MOTOR_ANCHORS,
    builders: {
      schematic: Nema23MotorSchematic,
      medium: Nema23MotorMedium,
      realistic: Nema23MotorRealistic,
    },
    descriptionEn:
      'NEMA 23 closed-loop stepper (122 mm, two-profile body). Shaft along world +X.',
    descriptionHu:
      'NEMA 23 closed-loop léptetőmotor (122 mm, két-profilos body). Tengely világ +X felé. Kábelbevezető +Z (felfelé).',
  },
  {
    id: 'x-driver-bevel',
    num: 9,
    nameHu: 'kúpfogaskerék 1.5M 20T 45° (hajtó)',
    nameEn: 'bevel gear 1.5M 20T 45° (driver)',
    color: generatePartColor(10),
    // LAPOS HIERARCHIA: a felhasználó kérésére az x-drive csoport minden eleme
    // közvetlenül az `x-drive-assembly` child-je (nincs nested alcsoport).
    // Korábban: parent = `x-motor` (motor shaft tip-jén identity rot).
    parentId: 'x-drive-assembly',
    transform: {
      // VILÁG-EKVIVALENS pozíció megőrizve: a motor x-hajtas-frame pos
      // [-1, 0, 0] + a motor builder Z-eltolás (bodyLength/2 + boss + shaft =
      // 61 + 1.6 + 22 = 84.6) world +X-re mappolva → x-hajtas frame X = 83.6.
      // Azonosan: MOTOR_X_OFFSET + boss + shaft = 60 + 1.6 + 22 = 83.6.
      // Rotation = R_motor (= [π/2, π/2, 0]) × identity = [π/2, π/2, 0].
      position: [
        MOTOR_X_OFFSET + NEMA23_MOTOR_DIMENSIONS.bossHeight + NEMA23_MOTOR_DIMENSIONS.shaftLength,
        0,
        0,
      ],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      size: [
        BEVEL_GEAR_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_DIMENSIONS.totalAxialExtent,
      ],
    },
    anchors: BEVEL_GEAR_ANCHORS,
    builders: {
      schematic: BevelGearSchematic,
      medium: BevelGearMedium,
      realistic: BevelGearRealistic,
    },
    descriptionEn:
      'Bevel gear 1.5M 20T 45° (driver) at the X motor shaft tip. Direct child of x-drive-assembly (flat hierarchy).',
    descriptionHu:
      'Kúpfogaskerék (1.5M, 20T, 45°), hajtó tag a NEMA 23 X-motor tengely-csúcsán. Az x-hajtás csoport közvetlen child-je (lapos hierarchia).',
  },
  {
    kind: 'assembly',
    id: 'drive-shaft-1-assembly',
    nameHu: 'hajtótengely 1',
    nameEn: 'drive shaft 1',
    parentId: 'x-drive-assembly',
    transform: {
      // A #14 tengely X/Y középvonala. A child elemek Z koordinátáját nem változtatjuk.
      position: DRIVE_SHAFT_1_GROUP_POSITION,
    },
    descriptionEn:
      'Coaxial group for shaft #14: driven bevel (#10), pinion #1 (#11), shaft #1 (#14), and feed roller #1 (#27).',
    descriptionHu:
      'Koaxiális egység a #14 tengelyhez: hajtott kúpfogaskerék (#10), pinion #1 (#11), tengely #1 (#14) és feed roller #1 (#27).',
  },
  {
    id: 'x-driven-bevel',
    num: 10,
    nameHu: 'kúpfogaskerék 1.5M 20T 45° (hajtott)',
    nameEn: 'bevel gear 1.5M 20T 45° (driven)',
    color: generatePartColor(11),
    parentId: 'drive-shaft-1-assembly',
    transform: {
      // A #14 tengelyre központosítva X/Y-ban; Z változatlan.
      position: [0, 0, -8.64],
      rotation: [0, 0, PI2],
    },
    bbox: {
      size: [
        BEVEL_GEAR_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_DIMENSIONS.totalAxialExtent,
      ],
    },
    anchors: BEVEL_GEAR_ANCHORS,
    builders: {
      schematic: BevelGearSchematic,
      medium: BevelGearMedium,
      realistic: BevelGearRealistic,
    },
    descriptionEn:
      'Bevel gear 1.5M 20T 45° (driven), meshing with the driver in the gear-bracket cavity.',
    descriptionHu:
      'Kúpfogaskerék (1.5M, 20T, 45°), hajtott tag a gear-bracket cavity-jében; függőleges (vagy bracket-frame Y) tengelyen meshelődik a hajtó kerékkel.',
  },
  {
    id: 'x-pinion-1',
    num: 11,
    nameHu: 'pinion 1.5M 17T (#1, gear-bracket teteje)',
    nameEn: 'pinion 1.5M 17T (#1, gear-bracket top)',
    color: generatePartColor(12),
    parentId: 'drive-shaft-1-assembly',
    transform: {
      // A #14 tengelyre központosítva X/Y-ban; Z változatlan.
      position: [0, 0, 29.5],
      rotation: [Math.PI, 0, 0],
    },
    bbox: {
      size: [
        PINION_GEAR_DIMENSIONS.tipDiam,
        PINION_GEAR_DIMENSIONS.tipDiam,
        PINION_GEAR_DIMENSIONS.totalHeight,
      ],
    },
    anchors: PINION_GEAR_ANCHORS,
    builders: {
      schematic: PinionGearSchematic,
      medium: PinionGearMedium,
      realistic: PinionGearRealistic,
    },
    descriptionEn:
      'Spur pinion gear (1.5M, 17T, Ø8 bore) on the upper arm of the gear bracket.',
    descriptionHu:
      'Spur fogaskerék (1.5M, 17T, Ø8 furat) a gear-bracket FELSŐ szárán.',
  },
  {
    id: 'x-gear-bracket',
    num: 12,
    nameHu: 'gear-bracket (motor flange alap)',
    nameEn: 'gear bracket (motor flange base)',
    color: generatePartColor(13),
    // LAPOS HIERARCHIA — közvetlen x-drive-assembly child (korábban
    // `x-motor` child volt). Így a motor mozgatása nem viszi magával
    // a bracket-et és a fogaskerekeket / tengelyeket.
    parentId: 'x-drive-assembly',
    transform: {
      // VILÁG-EKVIVALENS pozíció megőrzve: motor x-hajtas frame pos [-1,0,0]
      // + motor builder Z = MOTOR_BODY/2 + bracket builder Z = totalLengthZ/2,
      // motor rot mappolja Z-t world X-re → x-hajtas X = -MOTOR_BODY/2 +
      // MOTOR_X_OFFSET + MOTOR_BODY/2 + totalLengthZ/2 = MOTOR_X_OFFSET +
      // totalLengthZ/2 = 60 + 45 = 105.
      // Rotation = R_motor × identity = [π/2, π/2, 0].
      position: [MOTOR_X_OFFSET + X_GEAR_BRACKET_DIMENSIONS.totalLengthZ / 2, 0, 0],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      // Csak a megrajzolt base wall mérete (a szárak el lettek távolítva).
      size: [
        X_GEAR_BRACKET_DIMENSIONS.widthX,
        X_GEAR_BRACKET_DIMENSIONS.outerHeightY,
        X_GEAR_BRACKET_DIMENSIONS.materialThickness,
      ],
    },
    anchors: X_GEAR_BRACKET_ANCHORS,
    builders: {
      schematic: XGearBracketSchematic,
      medium: XGearBracketMedium,
      realistic: XGearBracketRealistic,
    },
    descriptionEn:
      'Aluminium gear bracket — motor-flange base wall only (the two arm plates were removed). 4× Ø5.1 mounting holes (M5 pattern) + central Ø40 hub clearance.',
    descriptionHu:
      'Alumínium gear-bracket — csak a motor flange-csatlakozó base wall (a két szár-lap el lett távolítva). 4 db Ø5.1 rögzítő furat (M5 pattern) + központi Ø40 hub-clearance.',
  },
  {
    kind: 'assembly',
    id: 'secondary-drive-shaft-assembly',
    nameHu: 'másodlagos hajtótengely',
    nameEn: 'secondary drive shaft',
    parentId: 'x-drive-assembly',
    transform: {
      // A #15 tengely X/Y középvonala. A child elemek Z koordinátáját nem változtatjuk.
      position: SECONDARY_DRIVE_SHAFT_GROUP_POSITION,
    },
    descriptionEn:
      'Coaxial group for shaft #15: pinion #2 (#13), shaft #2 (#15), and feed roller #2 (#28).',
    descriptionHu:
      'Koaxiális egység a #15 tengelyhez: pinion #2 (#13), tengely #2 (#15) és feed roller #2 (#28).',
  },
  {
    id: 'x-pinion-2',
    num: 13,
    nameHu: 'pinion 1.5M 17T (#2, +40 mm)',
    nameEn: 'pinion 1.5M 17T (#2, +40 mm)',
    color: generatePartColor(14),
    parentId: 'secondary-drive-shaft-assembly',
    transform: {
      // A #15 tengelyre központosítva X/Y-ban; Z változatlan.
      position: [0, 0, 29.5],
      rotation: [Math.PI, 0, -PI2],
    },
    bbox: {
      size: [
        PINION_GEAR_DIMENSIONS.tipDiam,
        PINION_GEAR_DIMENSIONS.tipDiam,
        PINION_GEAR_DIMENSIONS.totalHeight,
      ],
    },
    anchors: PINION_GEAR_ANCHORS,
    builders: {
      schematic: PinionGearSchematic,
      medium: PinionGearMedium,
      realistic: PinionGearRealistic,
    },
    descriptionEn:
      'Duplicate pinion (1.5M 17T) on the gear-bracket second shaft reference (+40 mm in bracket Z).',
    descriptionHu:
      'A pinion 1 másolata a gear-bracket 2. tengely-referenciáján (+40 mm bracket-lokális Z-ben).',
  },
  {
    id: 'x-shaft-1',
    num: 14,
    nameHu: 'Ø8 acéltengely #1 (gear-bracket)',
    nameEn: 'Ø8 steel shaft #1 (gear bracket)',
    color: generatePartColor(7),
    parentId: 'drive-shaft-1-assembly',
    transform: {
      // Felhasználó által áthelyezve a x-hajtas-frame-en belül: pos [93, 0, 10],
      // rotation [π/2, 0, 0] (builder +Y → world +Z, +Z (tengely) → world −Y).
      position: [0, 0, X_SHAFT_1_POSITION[2]],
      rotation: [PI2, 0, 0],
    },
    bbox: {
      size: [SHAFT_8MM_DIMENSIONS.diameter, SHAFT_8MM_DIMENSIONS.length, SHAFT_8MM_DIMENSIONS.diameter],
    },
    builders: {
      schematic: Shaft8mmSchematic,
      medium: Shaft8mmMedium,
      realistic: Shaft8mmRealistic,
    },
    descriptionEn:
      'Hardened Ø8 × 96.4 mm steel shaft #1 inside the gear bracket. Rotated 90° around X (axis along bracket +Z = world +X).',
    descriptionHu:
      'Edzett szénacél Ø8 × 96.4 mm tengely #1 a gear-bracket-en belül. 90°-kal forgatva X körül (tengely bracket +Z = world +X mentén).',
  },
  {
    id: 'x-shaft-2',
    num: 15,
    nameHu: 'Ø8 acéltengely #2 (gear-bracket)',
    nameEn: 'Ø8 steel shaft #2 (gear bracket)',
    color: generatePartColor(8),
    parentId: 'secondary-drive-shaft-assembly',
    transform: {
      // Felhasználó által áthelyezve a x-hajtas-frame-en belül: pos
      // [132, 0, 10.54], rotation [π/2, 0, 0] (a #1 shaft-tal párhuzamos).
      position: [0, 0, X_SHAFT_2_POSITION[2]],
      rotation: [PI2, 0, 0],
      scale: X_SHAFT_2_SCALE,
    },
    bbox: {
      size: [SHAFT_8MM_DIMENSIONS.diameter, SHAFT_8MM_DIMENSIONS.length, SHAFT_8MM_DIMENSIONS.diameter],
    },
    builders: {
      schematic: Shaft8mmSchematic,
      medium: Shaft8mmMedium,
      realistic: Shaft8mmRealistic,
    },
    descriptionEn:
      'Hardened Ø8 × 96.4 mm steel shaft #2 inside the gear bracket (parallel to shaft #1, +40 mm in bracket Z).',
    descriptionHu:
      'Edzett szénacél Ø8 × 96.4 mm tengely #2 a gear-bracket-en belül (párhuzamos a #1-gyel, +40 mm bracket Z-ben).',
  },
  {
    id: 'feed-roller-1',
    num: 27,
    nameHu: 'feed roller -1',
    nameEn: 'feed roller -1',
    color: generatePartColor(26),
    parentId: 'drive-shaft-1-assembly',
    transform: {
      // Koaxiálisan a #14 tengely tetejére illesztve: a roller alja a tengely
      // legmagasabb pontján ül.
      position: [0, 0, FEED_ROLLER_1_Z],
      rotation: [PI2, 0, 0],
    },
    bbox: {
      size: [
        FEED_ROLLER_DIMENSIONS.outerDiameter,
        FEED_ROLLER_DIMENSIONS.height,
        FEED_ROLLER_DIMENSIONS.outerDiameter,
      ],
    },
    builders: {
      schematic: FeedRollerSchematic,
      medium: FeedRollerMedium,
      realistic: FeedRollerRealistic,
    },
    descriptionEn:
      'Feed roller, OD 16 mm, ID 8 mm, height 11 mm, mounted on top of shaft #14.',
    descriptionHu:
      'Feed roller -1: Ø16 külső, Ø8 belső, 11 mm magas henger, a #14 tengely tetejére szerelve.',
  },
  {
    id: 'feed-roller-2',
    num: 28,
    nameHu: 'feed roller -2',
    nameEn: 'feed roller -2',
    color: generatePartColor(27),
    parentId: 'secondary-drive-shaft-assembly',
    transform: {
      // Koaxiálisan a #15 tengely tetejére illesztve: a roller alja a tengely
      // legmagasabb pontján ül.
      position: [0, 0, FEED_ROLLER_2_Z],
      rotation: [PI2, 0, 0],
    },
    bbox: {
      size: [
        FEED_ROLLER_DIMENSIONS.outerDiameter,
        FEED_ROLLER_DIMENSIONS.height,
        FEED_ROLLER_DIMENSIONS.outerDiameter,
      ],
    },
    builders: {
      schematic: FeedRollerSchematic,
      medium: FeedRollerMedium,
      realistic: FeedRollerRealistic,
    },
    descriptionEn:
      'Feed roller, OD 16 mm, ID 8 mm, height 11 mm, mounted on top of shaft #15.',
    descriptionHu:
      'Feed roller -2: Ø16 külső, Ø8 belső, 11 mm magas henger, a #15 tengely tetejére szerelve.',
  },
  {
    kind: 'assembly',
    id: 'secondary-drive-shaft-copy-assembly',
    nameHu: 'másodlagos hajtótengely másolat',
    nameEn: 'secondary drive shaft copy',
    parentId: 'x-drive-assembly',
    transform: {
      // A #15 tengelycsoport másolata, az eredetihez képest +20 mm Y irányban.
      position: SECONDARY_DRIVE_SHAFT_COPY_GROUP_POSITION,
    },
    descriptionEn:
      'Copy of the secondary drive shaft group, shifted +20 mm along the parent Y axis.',
    descriptionHu:
      'A másodlagos hajtótengely-csoport másolata, az eredetihez képest +20 mm-rel parent Y irányban eltolva.',
  },
  {
    id: 'x-pinion-3',
    num: 30,
    nameHu: 'pinion 1.5M 17T (#3, másodlagos másolat)',
    nameEn: 'pinion 1.5M 17T (#3, secondary copy)',
    color: generatePartColor(29),
    parentId: 'secondary-drive-shaft-copy-assembly',
    transform: {
      position: [0, 0, 29.5],
      rotation: [Math.PI, 0, -PI2],
    },
    bbox: {
      size: [
        PINION_GEAR_DIMENSIONS.tipDiam,
        PINION_GEAR_DIMENSIONS.tipDiam,
        PINION_GEAR_DIMENSIONS.totalHeight,
      ],
    },
    anchors: PINION_GEAR_ANCHORS,
    builders: {
      schematic: PinionGearSchematic,
      medium: PinionGearMedium,
      realistic: PinionGearRealistic,
    },
    descriptionEn:
      'Copy of pinion #2, coaxial with the copied secondary shaft group.',
    descriptionHu:
      'A pinion #2 másolata, a másolt másodlagos tengelycsoporttal koaxiálisan.',
  },
  {
    id: 'x-shaft-3',
    num: 31,
    nameHu: 'Ø8 acéltengely #3 (másodlagos másolat)',
    nameEn: 'Ø8 steel shaft #3 (secondary copy)',
    color: generatePartColor(30),
    parentId: 'secondary-drive-shaft-copy-assembly',
    transform: {
      position: [0, 0, 29],
      rotation: [PI2, 0, 0],
      scale: X_SHAFT_2_SCALE,
    },
    bbox: {
      size: [SHAFT_8MM_DIMENSIONS.diameter, SHAFT_8MM_DIMENSIONS.length, SHAFT_8MM_DIMENSIONS.diameter],
    },
    builders: {
      schematic: Shaft8mmSchematic,
      medium: Shaft8mmMedium,
      realistic: Shaft8mmRealistic,
    },
    descriptionEn:
      'Copy of shaft #2, shifted with the copied secondary drive shaft group.',
    descriptionHu:
      'A #15 tengely másolata, a másolt másodlagos hajtótengely-csoporttal együtt eltolva.',
  },
  {
    id: 'x-drive-top-plate',
    num: 24,
    nameHu: 'felső fedőlap (alumínium, vízszintes, 200×100×10)',
    nameEn: 'top cover plate (aluminium, horizontal, 200×100×10)',
    color: generatePartColor(23),
    // Felhasználói kérés: a fedőlap a konzol (Bracket assembly) csoporthoz
    // tartozik (nem az x-hajtás csoporthoz, ahogy korábban volt).
    parentId: 'bracket-assembly',
    transform: {
      // Pozíció parent-(bracket-assembly) frame-ben (felhasználó által
      // áthelyezve). Identity rotation: a lap builder-natívan vízszintes
      // (builder X-Y síkban, vastagság +Z).
      position: [X_DRIVE_TOP_PLATE_X, 20, 195],
    },
    bbox: {
      size: [
        X_DRIVE_TOP_PLATE_DIMENSIONS.lengthX,
        X_DRIVE_TOP_PLATE_DIMENSIONS.depthY,
        X_DRIVE_TOP_PLATE_DIMENSIONS.thickness,
      ],
    },
    builders: {
      schematic: XDriveTopPlateSchematic,
      medium: XDriveTopPlateMedium,
      realistic: XDriveTopPlateRealistic,
    },
    descriptionEn:
      'Horizontal aluminium top cover plate above the gear bracket (#12), belonging to the Bracket assembly. 200 × 100 × 10 mm.',
    descriptionHu:
      'Vízszintes alumínium felső fedőlap a gear-bracket (#12) felett, a Bracket assembly csoporthoz tartozik. 200 × 100 × 10 mm.',
  },
  {
    id: 'x-drive-bottom-plate',
    num: 25,
    nameHu: 'alsó fedőlap (alumínium, vízszintes, 60×60×10)',
    nameEn: 'bottom cover plate (aluminium, horizontal, 60×60×10)',
    color: generatePartColor(24),
    // A felső fedőlap (#24) tükörképe, ugyanahhoz a Konzol (Bracket assembly)
    // csoporthoz tartozik. KÜLÖN BUILDER (`XDriveBottomPlate`), mert a tervezett
    // későbbi átalakítások (furatminták, kivágások stb.) függetlenek a felső
    // lapétól.
    parentId: 'bracket-assembly',
    transform: {
      // X és Y a felső fedőlappal megegyező; csak a Z eltér (felhasználó által
      // áthelyezve). Identity rotation.
      position: [X_DRIVE_BOTTOM_PLATE_X, 0, X_DRIVE_BOTTOM_PLATE_Z],
    },
    bbox: {
      size: [
        X_DRIVE_BOTTOM_PLATE_DIMENSIONS.lengthX,
        X_DRIVE_BOTTOM_PLATE_DIMENSIONS.depthY,
        X_DRIVE_BOTTOM_PLATE_DIMENSIONS.thickness,
      ],
    },
    builders: {
      schematic: XDriveBottomPlateSchematic,
      medium: XDriveBottomPlateMedium,
      realistic: XDriveBottomPlateRealistic,
    },
    descriptionEn:
      'Horizontal aluminium bottom cover plate below the gear bracket (#12), with absorbed size override. 60 × 60 × 10 mm.',
    descriptionHu:
      'Vízszintes alumínium alsó fedőlap a gear-bracket (#12) alatt, beemelt méret override-dal. 60 × 60 × 10 mm.',
  },
  {
    id: 'x-drive-middle-plate',
    num: 29,
    nameHu: 'középső fedőlap (alumínium, vízszintes, 70×80×10)',
    nameEn: 'middle cover plate (aluminium, horizontal, 70×80×10)',
    color: generatePartColor(28),
    parentId: 'bracket-assembly',
    transform: {
      // Az alsó fedőlap (#25) másolata, ugyanazon X/Y pozícióval, 30 mm-rel feljebb.
      position: [140, 10, 160],
    },
    bbox: {
      size: [
        X_DRIVE_MIDDLE_PLATE_DIMENSIONS.lengthX,
        X_DRIVE_MIDDLE_PLATE_DIMENSIONS.depthY,
        X_DRIVE_MIDDLE_PLATE_DIMENSIONS.thickness,
      ],
    },
    builders: {
      schematic: XDriveMiddlePlateSchematic,
      medium: XDriveMiddlePlateMedium,
      realistic: XDriveMiddlePlateRealistic,
    },
    descriptionEn:
      'Horizontal aluminium middle cover plate in the Bracket assembly, copied from x-drive-bottom-plate and adjusted to the absorbed override position and size.',
    descriptionHu:
      'Vízszintes alumínium középső fedőlap a Bracket assembly-ben, az x-drive-bottom-plate másolata beemelt pozíció és méret override-dal.',
  },
  {
    id: 'front-plate',
    num: 26,
    nameHu: 'előlap (alumínium, függőleges, 80×80×10)',
    nameEn: 'front plate (aluminium, vertical, 80×80×10)',
    color: generatePartColor(25),
    parentId: 'bracket-assembly',
    transform: {
      // Függőleges X-Z síkú előlap. Az alja a #25 alsó fedőlap felső síkján ül,
      // bal/min-X éle a #24 felső fedőlap bal/min-X élével egyvonalban van.
      // Y-ban a fedőlapok előoldalára (+Y) kerül.
      position: [170, 10, 205],
      rotation: [0, 0, PI2],
    },
    bbox: {
      size: [
        FRONT_PLATE_DIMENSIONS.widthX,
        FRONT_PLATE_DIMENSIONS.thicknessY,
        FRONT_PLATE_DIMENSIONS.heightZ,
      ],
    },
    builders: {
      schematic: FrontPlateSchematic,
      medium: FrontPlateMedium,
      realistic: FrontPlateRealistic,
    },
    descriptionEn:
      'Vertical aluminium front plate in the Bracket assembly, with absorbed size and position overrides. 80 × 80 × 10 mm.',
    descriptionHu:
      'Függőleges alumínium előlap a Bracket assembly-ben, beemelt méret és pozíció override-dal. 80 × 80 × 10 mm.',
  },

  // ===========================================================================
  // 5) FESZÍTŐ — U-groove (V-horony) görgőscsapágy
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'tensioner-assembly',
    nameHu: 'Feszítő',
    nameEn: 'Tensioner',
    parentId: null,
    transform: { position: [-140, +80, 100] },
    descriptionHu: 'A csőre ráhajló feszítő görgő (U-hornyos csapágy + M4 csavar).',
    descriptionEn: 'Tensioner roller pressing on the tube (U-groove bearing + M4 screw).',
  },
  {
    id: 'tensioner-roller',
    num: 16,
    nameHu: 'U-hornyos görgőscsapágy SG10 + M4×17',
    nameEn: 'U-groove track roller SG10 + M4×17',
    color: generatePartColor(15),
    parentId: 'tensioner-assembly',
    transform: {
      // Felhasználó által áthelyezve a tensioner-assembly parent-frame-ben.
      // Rotation [-π, 0, 0]: builder +Z (csapágy tengelye) → world -Z, a horony
      // +X mentén áll.
      position: [188, -55, 115],
      rotation: [-Math.PI, 0, 0],
    },
    bbox: {
      size: [
        TENSIONER_ROLLER_DIMENSIONS.outerDiam,
        TENSIONER_ROLLER_DIMENSIONS.outerDiam,
        TENSIONER_ROLLER_DIMENSIONS.totalAxialLength,
      ],
    },
    anchors: TENSIONER_ROLLER_ANCHORS,
    builders: {
      schematic: TensionerRollerSchematic,
      medium: TensionerRollerMedium,
      realistic: TensionerRollerRealistic,
    },
    descriptionEn: 'SG10 U-groove (V-groove) track roller bearing with M4×17 shoulder screw.',
    descriptionHu:
      'SG10 U-hornyos (V-groove) görgőscsapágy M4×17 vállas csavarral. Forgástengely Y körüli (a tengely-csoporttal párhuzamos).',
  },

  // ===========================================================================
  // 6) Y HAJTÁS — HTD pulley pár (motor még nincs definiálva ebben a fázisban)
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'y-drive-assembly',
    nameHu: 'Y hajtás',
    nameEn: 'Y drive',
    parentId: null,
    // X-en a felhasználó áthelyezte (-400.02), Y és Z változatlan.
    transform: { position: [-400.0162570042641, 60, 80] },
    descriptionHu:
      'Y-tengelyes léptetőhajtás: HTD 5M fogasszíj-tárcsa pár (70T + 15T, 4.67:1). A hajtó motor későbbi iterációban kerül definiálásra.',
    descriptionEn:
      'Y-axis stepper drive: HTD 5M timing pulley pair (70T + 15T, 4.67:1). Driver motor TBD in a later iteration.',
  },
  {
    id: 'y-pulley-70t',
    num: 17,
    nameHu: 'HTD 5M pulley 70T (Ø25 furat, 15 mm szíj)',
    nameEn: 'HTD 5M pulley 70T (Ø25 bore, 15 mm belt)',
    color: generatePartColor(16),
    parentId: 'y-drive-assembly',
    transform: {
      // Felhasználói pozíció + tájolás (override-ból). A rotation ≈ [π, π/2, -π]
      // ami ekvivalens a [0, π/2, 0]-val (kvaternion szinten); a felhasználó a
      // pulley shaft-ját közel +X irányba forgatta.
      position: [495, -50, 130],
      rotation: [1.3717398628107738, 1.5699963187631378, -1.3647937014531595],
    },
    bbox: {
      size: [
        Y_PULLEY_70T_DIMENSIONS.flangeOuterDiam,
        Y_PULLEY_70T_DIMENSIONS.flangeOuterDiam,
        Y_PULLEY_70T_DIMENSIONS.totalAxialLength,
      ],
    },
    builders: {
      schematic: YPulley70TSchematic,
      medium: YPulley70TMedium,
      realistic: YPulley70TRealistic,
    },
    descriptionEn:
      'HTD 5M timing pulley 70T (Ø25 bore, 15 mm belt). Pairs with 15T pulley for 4.67:1 reduction.',
    descriptionHu:
      'HTD 5M fogasszíj-tárcsa 70 fog (Ø25 furat, 15 mm szíj). A 15T-vel együtt 4.67:1 áttétel.',
  },
  {
    id: 'y-pulley-15t',
    num: 18,
    nameHu: 'HTD 5M pulley 15T (Ø8 furat, 15 mm szíj + hub)',
    nameEn: 'HTD 5M pulley 15T (Ø8 bore, 15 mm belt + hub)',
    color: generatePartColor(17),
    parentId: 'y-drive-assembly',
    transform: {
      // Felhasználói pozíció + tájolás (override-ból). Rotation [π/2, π/2, 0]:
      // builder +Y → world +Z, builder +Z → world +X.
      position: [495, -50, 280],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      size: [
        Y_PULLEY_15T_DIMENSIONS.flangeOuterDiam,
        Y_PULLEY_15T_DIMENSIONS.flangeOuterDiam,
        Y_PULLEY_15T_DIMENSIONS.totalAxialLength,
      ],
    },
    builders: {
      schematic: YPulley15TSchematic,
      medium: YPulley15TMedium,
      realistic: YPulley15TRealistic,
    },
    descriptionEn:
      'HTD 5M timing pulley 15T (Ø8 bore, 15 mm belt) with hub. Pairs with 70T pulley.',
    descriptionHu:
      'HTD 5M fogasszíj-tárcsa 15 fog (Ø8 furat, 15 mm szíj) hub-bal. A 70T párja.',
  },
  {
    id: 'y-motor',
    num: 22,
    nameHu: 'NEMA 23 motor (Y tengely, 122 mm)',
    nameEn: 'NEMA 23 motor (Y axis, 122 mm)',
    color: generatePartColor(21),
    parentId: 'y-drive-assembly',
    transform: {
      // Felhasználói pozíció + tájolás. Rotation [-π/2, 3π/2, 0]: builder shaft
      // (+Z) világ +X felé, builder +Y → +Z (felfelé).
      position: [570, -50, 282],
      rotation: [-PI2, 3 * PI2, 0],
    },
    bbox: {
      size: [
        NEMA23_MOTOR_DIMENSIONS.bodySize,
        NEMA23_MOTOR_DIMENSIONS.bodySize,
        NEMA23_MOTOR_DIMENSIONS.bodyLength,
      ],
    },
    anchors: NEMA23_MOTOR_ANCHORS,
    builders: {
      schematic: Nema23MotorSchematic,
      medium: Nema23MotorMedium,
      realistic: Nema23MotorRealistic,
    },
    descriptionEn:
      'NEMA 23 closed-loop stepper (122 mm) driving the Y axis through a HTD 5M timing belt → 15T pulley → 70T pulley reduction. Shaft along world −Y, cable exit +Z.',
    descriptionHu:
      'NEMA 23 closed-loop léptetőmotor (122 mm) az Y tengely hajtásához. A motor a 15T pulley shaft-ján keresztül a HTD 5M fogasszíjon át hajtja a 70T pulley-t. Tengely világ −Y, kábelbevezető +Z (felfelé).',
  },
  {
    id: 'y-motor-mounting-rods',
    num: 40,
    nameHu: 'Y motor rögzítő menetes szárak (4× M5)',
    nameEn: 'Y motor mounting threaded rods (4× M5)',
    color: generatePartColor(40),
    parentId: 'y-drive-assembly',
    transform: {
      // A #4 mounting-rods másolata. A builder origója a motor középpontja,
      // lokális +Z tengelye a motor tengelye, ezért a y-motor transformját
      // másolva a szárak átmennek a Y motor 47.14 mm-es furatkiosztásán.
      position: [549, -50, 282],
      rotation: [-PI2, 3 * PI2, 0],
    },
    bbox: {
      size: [
        47.14 + Y_MOTOR_MOUNTING_RODS_DIMENSIONS.rodDiam,
        47.14 + Y_MOTOR_MOUNTING_RODS_DIMENSIONS.rodDiam,
        Y_MOTOR_MOUNTING_RODS_DIMENSIONS.rodLength,
      ],
    },
    anchors: Y_MOTOR_MOUNTING_RODS_ANCHORS,
    builders: {
      schematic: YMotorMountingRodsSchematic,
      medium: YMotorMountingRodsMedium,
      realistic: YMotorMountingRodsRealistic,
    },
    descriptionEn:
      'Copy of component #4 shortened by 30 mm and positioned on the Y motor so the four M5 threaded rods pass through the motor mounting holes.',
    descriptionHu:
      'A #4 motor rögzítő menetes szárak 30 mm-rel rövidebb másolata a Y motoron, hogy a 4 db M5 szár átmenjen a motor rögzítő furatain.',
  },
  {
    id: 'y-belt',
    num: 23,
    nameHu: 'HTD 5M bordásszíj 530-5M (15 mm szélesség)',
    nameEn: 'HTD 5M timing belt 530-5M (15 mm width)',
    color: generatePartColor(22),
    parentId: 'y-drive-assembly',
    transform: {
      // Felhasználó által áthelyezve a y-hajtas-frame-en belül. Rotation
      // [0, π/2, 0]: builder síkja a pulley shaft tengelyére merőlegesen áll.
      position: [495, -50, 130],
      rotation: [0, PI2, 0],
    },
    bbox: {
      // A belt befoglaló mérete builder-lokál frame-ben (pre-rotation):
      //   X = pulley center distance + 70T outer diameter (a belt nyúlik mindkét
      //       pulley körül, plusz a pulley sugarak)
      //   Y = belt szélesség (axiális, a registry rotation után world −Y)
      //   Z = 70T_OD + 2·BELT_THICKNESS (vertikális kiterjedés a hurok körül)
      size: [
        Y_BELT_DIMENSIONS.pulleyCenterDistance +
          Y_PULLEY_70T_DIMENSIONS.outsideDiam,
        Y_PULLEY_70T_DIMENSIONS.outsideDiam + 8,
        Y_BELT_DIMENSIONS.beltWidth,
      ],
    },
    builders: {
      schematic: YBeltSchematic,
      medium: YBeltMedium,
      realistic: YBeltRealistic,
    },
    descriptionEn:
      'HTD 5M synchronous timing belt 530-5M, 15 mm wide (106 teeth, 5 mm pitch). Open-belt loop around the 70T and 15T pulleys; the required pulley center distance is computed from the belt pitch length using the open-belt formula.',
    descriptionHu:
      'HTD 5M szinkron fogasszíj 530-5M, 15 mm széles (106 fog, 5 mm pitch). Nyitott szíj-hurok a 70T és 15T pulley körül; a szükséges pulley-középponttávolságot a szíj pitch-hosszából a nyitott szíj képletével számítjuk ki.',
  },

  // ===========================================================================
  // 7) Z HAJTÁS — bolygóhajtómű + rövid NEMA 23 motor
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'z-drive-assembly',
    nameHu: 'Z hajtás',
    nameEn: 'Z drive',
    parentId: null,
    transform: {
      // A z-hajtás origója a base tetején, gearbox tengelye világ +Z (felfelé).
      position: [ZDRIVE_WORLD_X, ZDRIVE_WORLD_Y, ZDRIVE_WORLD_Z + GEARBOX_HALF_LEN],
    },
    descriptionHu:
      'Z-tengelyes léptetőhajtás: 60×60 mm bolygóhajtómű (20:1) + alá felfogott rövid (81 mm) NEMA 23 motor. Output tengely felfelé (+Z).',
    descriptionEn:
      'Z-axis stepper drive: 60×60 mm planetary gearbox (20:1) with a short (81 mm) NEMA 23 motor below it. Output shaft points world +Z (up).',
  },
  {
    id: 'z-motor',
    num: 19,
    nameHu: 'NEMA 23 motor (Z tengely, rövid 81 mm)',
    nameEn: 'NEMA 23 motor (Z axis, short 81 mm)',
    color: generatePartColor(18),
    parentId: 'z-gearbox',
    transform: {
      // Felhasználói pozíció (override-ból). A korábbi anchor-mate (mount) ki
      // lett kapcsolva, mert a felhasználó manuálisan finomhangolta a motor
      // pozícióját a gearbox-hoz képest.
      position: [1.5149042123665595, 1.6424996366693136, -87.45618645053398],
      rotation: [0, 0, 0],
    },
    bbox: {
      size: [
        Z_MOTOR_DIMENSIONS.bodySize,
        Z_MOTOR_DIMENSIONS.bodySize,
        Z_MOTOR_DIMENSIONS.bodyLength +
          Z_MOTOR_DIMENSIONS.bossHeight +
          Z_MOTOR_DIMENSIONS.shaftLength,
      ],
    },
    anchors: Z_MOTOR_ANCHORS,
    builders: {
      schematic: ZMotorSchematic,
      medium: ZMotorMedium,
      realistic: ZMotorRealistic,
    },
    descriptionEn:
      'Short (81 mm) NEMA 23 stepper for the Z bending axis, mounted under the gearbox input flange.',
    descriptionHu:
      'Rövid (81 mm) NEMA 23 léptetőmotor a Z hajlító-tengelyhez, a bolygóhajtómű input flange-ére fogva.',
  },
  {
    id: 'z-drive-connector-plate',
    num: 41,
    nameHu: 'Z hajtás összekötő alu lemez (EK20–gearbox)',
    nameEn: 'Z drive aluminium connector plate (EK20 to gearbox)',
    color: generatePartColor(41),
    parentId: 'z-drive-assembly',
    transform: {
      position: Z_DRIVE_CONNECTOR_PLATE_POSITION,
    },
    bbox: {
      size: [
        Z_DRIVE_CONNECTOR_PLATE_DIMENSIONS.widthX,
        Z_DRIVE_CONNECTOR_PLATE_DIMENSIONS.depthY,
        Z_DRIVE_CONNECTOR_PLATE_DIMENSIONS.thicknessZ,
      ],
    },
    builders: {
      schematic: ZDriveConnectorPlateSchematic,
      medium: ZDriveConnectorPlateMedium,
      realistic: ZDriveConnectorPlateRealistic,
    },
    descriptionEn:
      '10 mm aluminium connector plate under the Z drive. It combines the EK20 #6 bottom mounting footprint with the #20 gearbox 60×60 flange footprint, including matching Ø6.6 and Ø5.5 mounting holes.',
    descriptionHu:
      '10 mm vastag alumínium összekötő lemez a Z hajtás alatt. A #6 EK20 alsó felfekvő téglalapját X irányban bővíti a #20 gearbox 60×60-as rögzítő alapjáig, illeszkedő Ø6.6 és Ø5.5 furatokkal.',
  },
  {
    id: 'z-gearbox',
    num: 20,
    nameHu: 'bolygóhajtómű 60×60 (20:1)',
    nameEn: 'planetary gearbox 60×60 (20:1)',
    color: generatePartColor(19),
    parentId: 'z-drive-assembly',
    transform: {
      // Felhasználói pozíció (override-ból) — a korábbi identity-ből áthelyezve.
      position: Z_GEARBOX_POSITION,
      rotation: [0, 0, 0],
    },
    bbox: {
      size: [
        Z_GEARBOX_DIMENSIONS.flangeWidth,
        Z_GEARBOX_DIMENSIONS.flangeWidth,
        Z_GEARBOX_DIMENSIONS.totalLengthWithShaft,
      ],
    },
    anchors: Z_GEARBOX_ANCHORS,
    builders: {
      schematic: ZGearboxSchematic,
      medium: ZGearboxMedium,
      realistic: ZGearboxRealistic,
    },
    descriptionEn:
      'STEPPERONLINE 60 × 60 mm planetary gearbox for NEMA 23, ratio ≈ 20:1, Ø8 input bore, Ø14 D-cut output shaft.',
    descriptionHu:
      'STEPPERONLINE 60 × 60 mm bolygóhajtómű NEMA 23-hoz, ≈ 20:1 áttétel, Ø8 input bore, Ø14 D-cut output tengely.',
  },
]

/**
 * Lekérdezi a regiszter-node-ot id alapján. Lehet `ComponentDef` vagy `AssemblyDef`;
 * a hívó az `isAssembly`/`isComponent` type-guard-okkal szűkítheti.
 */
export function getRegistryNode(id: string): RegistryNode | undefined {
  return TUBE_BENDER_REGISTRY.find((c) => c.id === id)
}

/**
 * Lekérdezi a komponens-alkatrészt id alapján. Ha a node assembly, `undefined`-t ad.
 * Visszafelé kompatibilis: a meglévő hívók (highlightStore, exportStl, ComponentTable)
 * komponens-id-vel hívnak.
 */
export function getComponent(id: string): ComponentDef | undefined {
  const node = getRegistryNode(id)
  return node && isComponent(node) ? node : undefined
}

/** Lekérdezi az assembly-t id alapján; ha komponens, undefined. */
export function getAssembly(id: string): AssemblyDef | undefined {
  const node = getRegistryNode(id)
  return node && !isComponent(node) ? node : undefined
}

/**
 * Visszaadja egy adott szülő közvetlen gyermekeit (komponensek + assembly-k).
 * null = gyökér-szintűek.
 */
export function getChildren(parentId: string | null): RegistryNode[] {
  return TUBE_BENDER_REGISTRY.filter((c) => c.parentId === parentId)
}

/**
 * Visszaadja egy szülő összes leszármazott komponensét rekurzívan (mély bejárás).
 * Asszemblik át vannak ugorva (csak a komponens-leveleket adja vissza).
 */
export function getDescendantComponents(parentId: string): ComponentDef[] {
  const out: ComponentDef[] = []
  const stack: string[] = [parentId]
  while (stack.length > 0) {
    const pid = stack.pop()!
    for (const child of getChildren(pid)) {
      if (isComponent(child)) out.push(child)
      stack.push(child.id)
    }
  }
  return out
}

/**
 * Visszaadja egy node ÖSSZES leszármazottjának id-jét rekurzívan
 * (komponensek ÉS sub-assembly-k vegyesen).
 */
export function getDescendantNodeIds(rootId: string): string[] {
  const out: string[] = []
  const stack: string[] = [rootId]
  while (stack.length > 0) {
    const pid = stack.pop()!
    for (const child of getChildren(pid)) {
      out.push(child.id)
      stack.push(child.id)
    }
  }
  return out
}

/**
 * Visszaadja egy komponens közvetlen TARTALMAZÓ assembly-jének id-jét: a
 * `parentId`-láncon felfelé sétálva az első `AssemblyDef` ős id-jét.
 */
export function getContainingAssemblyId(componentId: string): string | undefined {
  let current = getRegistryNode(componentId)
  if (!current) return undefined
  let parentId: string | null = current.parentId
  while (parentId) {
    const parent: RegistryNode | undefined = getRegistryNode(parentId)
    if (!parent) return undefined
    if (!isComponent(parent)) return parent.id
    parentId = parent.parentId
  }
  return undefined
}

/** Az összes regisztrált assembly id-je (a typed `AssemblyDef` node-okból). */
export function getAssemblyIds(): string[] {
  return getAssemblies().map((a) => a.id)
}

/** Visszaadja a regiszterben szereplő összes `AssemblyDef`-et. */
export function getAssemblies(): AssemblyDef[] {
  return TUBE_BENDER_REGISTRY.filter((c) => !isComponent(c)) as AssemblyDef[]
}

/**
 * A regiszter komponens-szintű, sorrend szerint rendezett verziója — a táblázat
 * ezt jeleníti meg (sorszám szerint). Az assembly-k (üres groupok) NEM kerülnek a
 * táblázatba.
 */
export function getOrderedComponents(): ComponentDef[] {
  return TUBE_BENDER_REGISTRY.filter(isComponent).sort((a, b) => a.num - b.num)
}

export const LOD_LEVELS: LodLevel[] = ['schematic', 'medium', 'realistic']

export const LOD_LABELS_HU: Record<LodLevel, string> = {
  schematic: 'sematikus',
  medium: 'közepes',
  realistic: 'realisztikus',
}

export const LOD_LABELS_EN: Record<LodLevel, string> = {
  schematic: 'Schematic',
  medium: 'Medium',
  realistic: 'Realistic',
}
