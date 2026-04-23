/**
 * Csőhajlító komponens-regiszter (single source of truth).
 *
 * 7 top-level assembly + 20 komponens, Z-up CAD világban (+X csőelőtolás,
 * +Y operátor, +Z fel). A világtájolást a komponensek `transform.rotation`
 * (Euler XYZ) adja meg; a részegységek pozíciói az assembly-origók és a
 * builder-konvenció (lásd `types.ts`) alapján könnyen hangolhatók.
 *
 * Csoportok (parent: null, mind gyökér-szintű):
 *   1) alap-assembly      — base lemez
 *   2) konzol-assembly    — X-bracket sandwich (bracket-1, bracket-2, mounting-rods)
 *   3) tengely-assembly   — spindle: SHF20, EK20, slip-ring (axis +Y)
 *   4) x-hajtas-assembly  — NEMA 23 X + bevel pár + pinionok + gear-bracket
 *                           (a 2 db Ø8 tengely a gear-bracket-en belül van)
 *   5) feszito-assembly   — U-groove görgő
 *   6) y-hajtas-assembly  — HTD pulley pár (70T + 15T)
 *   7) z-hajtas-assembly  — bolygóhajtómű + NEMA 23 Z motor
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
  BASE_ANCHORS,
  BASE_DIMENSIONS,
  BaseMedium,
  BaseRealistic,
  BaseSchematic,
  BEVEL_GEAR_15M_20T_45DEG_ANCHORS,
  BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS,
  BevelGear15M20T45degMedium,
  BevelGear15M20T45degRealistic,
  BevelGear15M20T45degSchematic,
  EK20_BEARING_ANCHORS,
  EK20_BEARING_DIMENSIONS,
  EK20BearingMedium,
  EK20BearingRealistic,
  EK20BearingSchematic,
  GEAR_BRACKET_ANCHORS,
  GEAR_BRACKET_DIMENSIONS,
  GearBracketMedium,
  GearBracketRealistic,
  GearBracketSchematic,
  HTD_BELT_600_5M_W15_DIMENSIONS,
  HTD_PULLEY_15T_8B_DIMENSIONS,
  HTD_PULLEY_70T_25B_DIMENSIONS,
  HtdBelt600_5M_W15Medium,
  HtdBelt600_5M_W15Realistic,
  HtdBelt600_5M_W15Schematic,
  HtdPulley15T_8bMedium,
  HtdPulley15T_8bRealistic,
  HtdPulley15T_8bSchematic,
  HtdPulley70T_25bMedium,
  HtdPulley70T_25bRealistic,
  HtdPulley70T_25bSchematic,
  MOUNTING_RODS_ANCHORS,
  MOUNTING_RODS_DIMENSIONS,
  MountingRodsMedium,
  MountingRodsRealistic,
  MountingRodsSchematic,
  NEMA23_MOTOR_ANCHORS,
  NEMA23_MOTOR_DIMENSIONS,
  NEMA23_MOTOR_Z_ANCHORS,
  NEMA23_MOTOR_Z_DIMENSIONS,
  Nema23MotorMedium,
  Nema23MotorRealistic,
  Nema23MotorSchematic,
  Nema23MotorZMedium,
  Nema23MotorZRealistic,
  Nema23MotorZSchematic,
  PINION_GEAR_15M_17T_ANCHORS,
  PINION_GEAR_15M_17T_DIMENSIONS,
  PinionGear15M17TMedium,
  PinionGear15M17TRealistic,
  PinionGear15M17TSchematic,
  PLANETARY_GEARBOX_60_ANCHORS,
  PLANETARY_GEARBOX_60_DIMENSIONS,
  PlanetaryGearbox60Medium,
  PlanetaryGearbox60Realistic,
  PlanetaryGearbox60Schematic,
  SHAFT_8MM_DIMENSIONS,
  SHAFT_SUPPORT_SHF20_DIMENSIONS,
  Shaft8mmMedium,
  Shaft8mmRealistic,
  Shaft8mmSchematic,
  ShaftSupportSHF20Medium,
  ShaftSupportSHF20Realistic,
  ShaftSupportSHF20Schematic,
  SLIP_RING_H2056_12CH_ANCHORS,
  SLIP_RING_H2056_12CH_DIMENSIONS,
  SlipRingH2056_12chMedium,
  SlipRingH2056_12chRealistic,
  SlipRingH2056_12chSchematic,
  TUBE_SHAFT_DIMENSIONS,
  TubeShaftMedium,
  TubeShaftRealistic,
  TubeShaftSchematic,
  U_GROOVE_BEARING_SG10_ANCHORS,
  U_GROOVE_BEARING_SG10_DIMENSIONS,
  UGrooveBearingSG10Medium,
  UGrooveBearingSG10Realistic,
  UGrooveBearingSG10Schematic,
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
  X_DRIVE_TOP_PLATE_DIMENSIONS,
  XDriveBottomPlateMedium,
  XDriveBottomPlateRealistic,
  XDriveBottomPlateSchematic,
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
const BRACKET_HALF_HEIGHT = VERTICAL_BRACKET_1_DIMENSIONS.height / 2 // = 100
const MOTOR_BODY = NEMA23_MOTOR_DIMENSIONS.bodyLength // = 122
const MOTOR_X_OFFSET = 60 // motor body átnyúlik a bracket-1 cutoutján
// Bracket-2 X-eltolása konzol-lokálisan: a zsebe ÉPP a motor hátlapját fogadja.
// Levezetés: motor back face konzol-X = (-MOTOR_BODY/2 + MOTOR_X_OFFSET) - MOTOR_BODY/2
//            bracket-2 zseb-talpa konzol-X = BRACKET_2_DX + bracket-T/2 - pocketDepth
//            equate → BRACKET_2_DX = -MOTOR_BODY + MOTOR_X_OFFSET + pocketDepth
//            = -122 + 60 + 4 = -58
const BRACKET_2_DX = -MOTOR_BODY + MOTOR_X_OFFSET + VERTICAL_BRACKET_2_DIMENSIONS.pocketDepth

// Tengely-csoport világpozíciója (Y-tengely körüli forgás).
// X-et a felhasználói override értékre frissítve (-140), Y/Z változatlan
// (azok eredetileg is megfeleltek az override-nak).
const TENGELY_WORLD_X = -140
const TENGELY_WORLD_Y = -50  // base hátsó éle felé
const TENGELY_WORLD_Z = 100  // base teteje (z=0) fölött 100 mm-rel

// Z-hajtás világpozíciója (X felhasználói override-ból frissítve)
const ZDRIVE_WORLD_X = -442.8734728244047
const ZDRIVE_WORLD_Y = 0
const ZDRIVE_WORLD_Z = 0  // base teteje
const GEARBOX_HALF_LEN = PLANETARY_GEARBOX_60_DIMENSIONS.bodyTotalLength / 2

export const TUBE_BENDER_REGISTRY: RegistryNode[] = [
  // ===========================================================================
  // 1) ALAP — a teljes szerelvény talp-lemeze
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'alap-assembly',
    nameHu: 'Alap',
    nameEn: 'Base',
    parentId: null,
    transform: { position: [0, 0, 0] },
    descriptionHu: 'A keretszerkezet alapja: a base lemezt tartalmazza.',
    descriptionEn: 'Frame base assembly: contains the base plate.',
  },
  {
    id: 'base',
    num: 1,
    nameHu: 'alaplemez',
    nameEn: 'base plate',
    color: generatePartColor(0),
    parentId: 'alap-assembly',
    transform: {
      // Z-up natív: lemez közepe Z = -H/2; teteje a world Z = 0 síkon.
      position: [0, 0, -BASE_DIMENSIONS.height / 2],
    },
    bbox: {
      size: [BASE_DIMENSIONS.length, BASE_DIMENSIONS.depth, BASE_DIMENSIONS.height],
    },
    anchors: BASE_ANCHORS,
    builders: {
      schematic: BaseSchematic,
      medium: BaseMedium,
      realistic: BaseRealistic,
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
    id: 'konzol-assembly',
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
    id: 'konzol-bracket-1',
    num: 2,
    nameHu: 'függőleges konzol 1 (elöl, cutout)',
    nameEn: 'vertical bracket 1 (front, cutout)',
    color: generatePartColor(1),
    parentId: 'konzol-assembly',
    transform: {
      // Bracket-1 a konzol-assembly origójához képest +10 mm-rel +X-en
      // (felhasználó által áthelyezve), állva a base-tetőn (Z = magasság fele).
      // Rotation: builder +Y (magasság) → world +Z, +Z (cutout normál) → world +X.
      position: [10, 0, BRACKET_HALF_HEIGHT],
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
    id: 'konzol-bracket-2',
    num: 3,
    nameHu: 'függőleges konzol 2 (hátul, zseb)',
    nameEn: 'vertical bracket 2 (rear, pocket)',
    color: generatePartColor(2),
    parentId: 'konzol-assembly',
    transform: {
      position: [BRACKET_2_DX, 0, BRACKET_HALF_HEIGHT],
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
    id: 'konzol-mounting-rods',
    num: 4,
    nameHu: 'menetes szár szerelvény (4× M5 + 20 anya)',
    nameEn: 'threaded rod assembly (4× M5 + 20 nuts)',
    color: generatePartColor(3),
    parentId: 'konzol-assembly',
    transform: {
      // A 4 szár a motor tengelyén futnak; builder +Z = motor axis → world +X.
      // X-en a felhasználó áthelyezte (+4 mm), Z a bracket cutout-középvonalához
      // finomhangolva.
      position: [4, 0, 150],
      rotation: [PI2, PI2, 0],
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
      'Four M5 threaded rods (with 20 nuts) clamping the NEMA 23 motor between the two vertical brackets.',
    descriptionHu:
      'Menetes szár szerelvény: 4 db M5 szár 20 anyával fogja össze a NEMA 23 motort a két függőleges konzollal.',
  },

  // ===========================================================================
  // 3) TENGELY — központi forgó (Y-tengely körüli): SHF20, EK20, slip-ring.
  //    A bore-tengely világ +Y/-Y mentén. (A 2 db Ø8 tengely a gear-bracket
  //    alá került — lásd 4) X HAJTÁS.)
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'tengely-assembly',
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
    id: 'tengely-shaft-support',
    num: 5,
    nameHu: 'tengelytámasz SHF20 (Ø20)',
    nameEn: 'shaft support SHF20 (Ø20)',
    color: generatePartColor(4),
    parentId: 'tengely-assembly',
    transform: {
      // Felhasználói pozíció a tengely-assembly parent-frame-ben (override-ból
      // beemelve). A rotation [π/2, π/2, 0]: builder +Y → world +Z (függőleges
      // támasz), builder +Z → world +X (bore szögben — a felhasználó a tengelyt
      // a finomhangolás során X-irányba forgatta).
      position: [208.67392661893277, 93.43888823591145, 121.8759249421762],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      size: [
        SHAFT_SUPPORT_SHF20_DIMENSIONS.totalWidth,
        SHAFT_SUPPORT_SHF20_DIMENSIONS.totalHeight,
        SHAFT_SUPPORT_SHF20_DIMENSIONS.totalThickness,
      ],
    },
    builders: {
      schematic: ShaftSupportSHF20Schematic,
      medium: ShaftSupportSHF20Medium,
      realistic: ShaftSupportSHF20Realistic,
    },
    descriptionEn:
      'SHF20-style shaft support (60 × 50 × 30 mm), Ø20 bore with vertical clamp slot and M5 clamp screw.',
    descriptionHu:
      'SHF20 stílusú tengelytámasz (60 × 50 × 30 mm), Ø20 bore függőleges szorítóréssel és M5 szorítócsavarral. Felhasználó által áthelyezve a tengely-assembly-n belül.',
  },
  {
    id: 'tengely-ek20',
    num: 6,
    nameHu: 'EK20 csapágytartó (Ø20, fixed)',
    nameEn: 'EK20 bearing block (Ø20, fixed side)',
    color: generatePartColor(5),
    parentId: 'tengely-assembly',
    transform: {
      // Felhasználói pozíció a tengely-assembly parent-frame-ben.
      // Rotation [π/2, π/2, 0]: builder +Y → world +Z, builder +Z → world +X
      // (bore axis a felhasználó által X-irányba forgatva).
      position: [309.9944214232049, 97.32162469603502, 129.81156181378756],
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
      'HIWIN EK20 csapágytartó blokk Ø20-as golyósorsóhoz (fixed oldal). Felhasználó által áthelyezve és X-irányba forgatva a tengely-assembly-n belül.',
  },
  {
    id: 'tengely-slip-ring',
    num: 7,
    nameHu: 'csúszógyűrű H2056-12 (12 csatorna)',
    nameEn: 'slip ring H2056-12 (12 channels)',
    color: generatePartColor(6),
    parentId: 'tengely-assembly',
    transform: {
      // Felhasználói pozíció a tengely-assembly parent-frame-ben.
      // Rotation [π/2, π/2, 0]: builder +Y → world +Z, builder +Z → world +X
      // (a többi tengely-csoport elemmel egybeforgatva).
      position: [244.60115017465833, 94.26486744541624, 126.83791754426304],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      size: [
        SLIP_RING_H2056_12CH_DIMENSIONS.outerDiam,
        SLIP_RING_H2056_12CH_DIMENSIONS.outerDiam,
        SLIP_RING_H2056_12CH_DIMENSIONS.totalAxialLength,
      ],
    },
    anchors: SLIP_RING_H2056_12CH_ANCHORS,
    builders: {
      schematic: SlipRingH2056_12chSchematic,
      medium: SlipRingH2056_12chMedium,
      realistic: SlipRingH2056_12chRealistic,
    },
    descriptionEn:
      'SENRING H2056-12 through-bore slip ring (Ø20 bore / Ø56 OD, 12 ch × 10 A). Bore axis along world -Y.',
    descriptionHu:
      'SENRING H2056-12 átmenő furatos csúszógyűrű (Ø20 / Ø56, 12 csatorna × 10 A). Bore világ -Y mentén.',
  },
  {
    id: 'tengely-tube-shaft',
    num: 21,
    nameHu: 'csőtengely (Ø20 / Ø14 × 180)',
    nameEn: 'tube shaft (Ø20 / Ø14 × 180)',
    color: generatePartColor(20),
    parentId: 'tengely-assembly',
    transform: {
      // builder +Y = saját tengely (lathe rotációs tengely). Rotation [0, 0, -π/2]
      // forgatja a builder +Y-t a világ +X-re — a felhasználói specifikáció:
      // "x irányba áll". A pozíció a felhasználó által áthelyezett értékre
      // (override-ból beemelve), a tengely-assembly parent-frame-ében.
      position: [284.17865238456466, 91.6571982335075, 126.77874978476967],
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

  // ===========================================================================
  // 4) X HAJTÁS — NEMA 23 motor + bevel pár + pinionok + gear-bracket
  //    A motor a konzol bracket-1 cutoutjában áll. A 2 db Ø8 acéltengely
  //    a gear-bracket alá tartozik (a fogaskerekek tengelyei).
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'x-hajtas-assembly',
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
      'X-tengelyes léptetőhajtás csoport: NEMA 23 motor + 90°-os bevel pár + 2 pinion + gear-bracket + 2 tengely. LAPOS hierarchia: minden alkatrész (#8..#15) közvetlenül ennek a csoportnak a child-je — a csoporton belül NINCSENEK alcsoportok (a motor mozgatása nem viszi magával a bracket-et és a fogaskerekeket).',
    descriptionEn:
      'X-axis stepper drive group: NEMA 23 motor + 90° bevel pair + 2 pinions + gear bracket + 2 shafts. FLAT hierarchy: every part (#8..#15) is a direct child of this group — there are NO sub-assemblies inside (so moving the motor does not drag the bracket and gears along).',
  },
  {
    id: 'x-motor-nema23',
    num: 8,
    nameHu: 'NEMA 23 motor (X tengely, 122 mm)',
    nameEn: 'NEMA 23 motor (X axis, 122 mm)',
    color: generatePartColor(9),
    parentId: 'x-hajtas-assembly',
    transform: {
      // Builder +Z = motor shaft → rotation [π/2, π/2, 0] mappolja világ +X-re;
      // builder +Y (kábelbevezető oldal) → world +Z (felfelé).
      // Pozíció: motor body közepe a cutoutból +X-irányba MOTOR_X_OFFSET-tel kiállva,
      // a motor body (122 mm) -X irányba nyúlik a cutout-tól.
      position: [-MOTOR_BODY / 2 + MOTOR_X_OFFSET, 0, 0],
      rotation: [PI2, PI2, 0],
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
    id: 'x-bevel-driver',
    num: 9,
    nameHu: 'kúpfogaskerék 1.5M 20T 45° (hajtó)',
    nameEn: 'bevel gear 1.5M 20T 45° (driver)',
    color: generatePartColor(10),
    // LAPOS HIERARCHIA: a felhasználó kérésére az x-drive csoport minden eleme
    // közvetlenül az `x-hajtas-assembly` child-je (nincs nested alcsoport).
    // Korábban: parent = `x-motor-nema23` (motor shaft tip-jén identity rot).
    parentId: 'x-hajtas-assembly',
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
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.totalAxialExtent,
      ],
    },
    anchors: BEVEL_GEAR_15M_20T_45DEG_ANCHORS,
    builders: {
      schematic: BevelGear15M20T45degSchematic,
      medium: BevelGear15M20T45degMedium,
      realistic: BevelGear15M20T45degRealistic,
    },
    descriptionEn:
      'Bevel gear 1.5M 20T 45° (driver) at the X motor shaft tip. Direct child of x-hajtas-assembly (flat hierarchy).',
    descriptionHu:
      'Kúpfogaskerék (1.5M, 20T, 45°), hajtó tag a NEMA 23 X-motor tengely-csúcsán. Az x-hajtás csoport közvetlen child-je (lapos hierarchia).',
  },
  {
    id: 'x-bevel-driven',
    num: 10,
    nameHu: 'kúpfogaskerék 1.5M 20T 45° (hajtott)',
    nameEn: 'bevel gear 1.5M 20T 45° (driven)',
    color: generatePartColor(11),
    // LAPOS HIERARCHIA — közvetlen x-hajtas-assembly child.
    parentId: 'x-hajtas-assembly',
    transform: {
      // VILÁG-EKVIVALENS pozíció: bracket-lokál pos [0, -8.64, -12.76]
      // (régi parent: x-gear-bracket, ami [105, 0, 0] @ rot [π/2, π/2, 0] az
      // x-hajtas frame-ben). R_bracket leképezés:
      //   bracket X(=0) → x-hajtas Y, bracket Y(=-8.64) → x-hajtas Z,
      //   bracket Z(=-12.76) → x-hajtas X.
      //   → x-hajtas pos = [105 + (-12.76), 0 + 0, 0 + (-8.64)] = [92.24, 0, -8.64].
      // Rotation: R_bracket × Rx(-π/2) = Rz(π/2) → Euler [0, 0, π/2].
      position: [92.24, 0, -8.64],
      rotation: [0, 0, PI2],
    },
    bbox: {
      size: [
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.totalAxialExtent,
      ],
    },
    anchors: BEVEL_GEAR_15M_20T_45DEG_ANCHORS,
    builders: {
      schematic: BevelGear15M20T45degSchematic,
      medium: BevelGear15M20T45degMedium,
      realistic: BevelGear15M20T45degRealistic,
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
    // LAPOS HIERARCHIA — közvetlen x-hajtas-assembly child.
    parentId: 'x-hajtas-assembly',
    transform: {
      // Felhasználó által áthelyezve és átforgatva: x-hajtas-frame pos
      // [0, 18.2, -12.76], rotation [π/2, 0, 0] (builder +Y → world +Z, +Z → −Y).
      position: [0, 18.200000000000003, -12.76],
      rotation: [PI2, 0, 0],
    },
    bbox: {
      size: [
        PINION_GEAR_15M_17T_DIMENSIONS.tipDiam,
        PINION_GEAR_15M_17T_DIMENSIONS.tipDiam,
        PINION_GEAR_15M_17T_DIMENSIONS.totalHeight,
      ],
    },
    anchors: PINION_GEAR_15M_17T_ANCHORS,
    builders: {
      schematic: PinionGear15M17TSchematic,
      medium: PinionGear15M17TMedium,
      realistic: PinionGear15M17TRealistic,
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
    // LAPOS HIERARCHIA — közvetlen x-hajtas-assembly child (korábban
    // `x-motor-nema23` child volt). Így a motor mozgatása nem viszi magával
    // a bracket-et és a fogaskerekeket / tengelyeket.
    parentId: 'x-hajtas-assembly',
    transform: {
      // VILÁG-EKVIVALENS pozíció megőrzve: motor x-hajtas frame pos [-1,0,0]
      // + motor builder Z = MOTOR_BODY/2 + bracket builder Z = totalLengthZ/2,
      // motor rot mappolja Z-t world X-re → x-hajtas X = -MOTOR_BODY/2 +
      // MOTOR_X_OFFSET + MOTOR_BODY/2 + totalLengthZ/2 = MOTOR_X_OFFSET +
      // totalLengthZ/2 = 60 + 45 = 105.
      // Rotation = R_motor × identity = [π/2, π/2, 0].
      position: [MOTOR_X_OFFSET + GEAR_BRACKET_DIMENSIONS.totalLengthZ / 2, 0, 0],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      // Csak a megrajzolt base wall mérete (a szárak el lettek távolítva).
      size: [
        GEAR_BRACKET_DIMENSIONS.widthX,
        GEAR_BRACKET_DIMENSIONS.outerHeightY,
        GEAR_BRACKET_DIMENSIONS.materialThickness,
      ],
    },
    anchors: GEAR_BRACKET_ANCHORS,
    builders: {
      schematic: GearBracketSchematic,
      medium: GearBracketMedium,
      realistic: GearBracketRealistic,
    },
    descriptionEn:
      'Aluminium gear bracket — motor-flange base wall only (the two arm plates were removed). 4× Ø5.1 mounting holes (M5 pattern) + central Ø40 hub clearance.',
    descriptionHu:
      'Alumínium gear-bracket — csak a motor flange-csatlakozó base wall (a két szár-lap el lett távolítva). 4 db Ø5.1 rögzítő furat (M5 pattern) + központi Ø40 hub-clearance.',
  },
  {
    id: 'x-pinion-2',
    num: 13,
    nameHu: 'pinion 1.5M 17T (#2, +40 mm)',
    nameEn: 'pinion 1.5M 17T (#2, +40 mm)',
    color: generatePartColor(14),
    // LAPOS HIERARCHIA — közvetlen x-hajtas-assembly child.
    parentId: 'x-hajtas-assembly',
    transform: {
      // VILÁG-EKVIVALENS pozíció: bracket-lokál pos [0, 18.2, 27.24] a
      // bracket-világ-transform [105, 0, 0] @ [π/2, π/2, 0] alá:
      //   x-hajtas pos = [105 + 27.24, 0, 0 + 18.2] = [132.24, 0, 18.2].
      // Rotation: ugyanaz mint a #11 → Euler [π, 0, -π/2].
      position: [132.24, 0, 18.2],
      rotation: [Math.PI, 0, -PI2],
    },
    bbox: {
      size: [
        PINION_GEAR_15M_17T_DIMENSIONS.tipDiam,
        PINION_GEAR_15M_17T_DIMENSIONS.tipDiam,
        PINION_GEAR_15M_17T_DIMENSIONS.totalHeight,
      ],
    },
    anchors: PINION_GEAR_15M_17T_ANCHORS,
    builders: {
      schematic: PinionGear15M17TSchematic,
      medium: PinionGear15M17TMedium,
      realistic: PinionGear15M17TRealistic,
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
    // LAPOS HIERARCHIA — közvetlen x-hajtas-assembly child.
    parentId: 'x-hajtas-assembly',
    transform: {
      // Felhasználó által áthelyezve a x-hajtas-frame-en belül: pos [93, 0, 10],
      // rotation [π/2, 0, 0] (builder +Y → world +Z, +Z (tengely) → world −Y).
      position: [93, 0, 10],
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
    // LAPOS HIERARCHIA — közvetlen x-hajtas-assembly child.
    parentId: 'x-hajtas-assembly',
    transform: {
      // Felhasználó által áthelyezve a x-hajtas-frame-en belül: pos
      // [132, 0, 10.54], rotation [π/2, 0, 0] (a #1 shaft-tal párhuzamos).
      position: [132, 0, 10.54270234297768],
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
      'Hardened Ø8 × 96.4 mm steel shaft #2 inside the gear bracket (parallel to shaft #1, +40 mm in bracket Z).',
    descriptionHu:
      'Edzett szénacél Ø8 × 96.4 mm tengely #2 a gear-bracket-en belül (párhuzamos a #1-gyel, +40 mm bracket Z-ben).',
  },
  {
    id: 'x-drive-top-plate',
    num: 24,
    nameHu: 'felső fedőlap (alumínium, vízszintes, 236×80×10)',
    nameEn: 'top cover plate (aluminium, horizontal, 236×80×10)',
    color: generatePartColor(23),
    // Felhasználói kérés: a fedőlap a konzol (Bracket assembly) csoporthoz
    // tartozik (nem az x-hajtás csoporthoz, ahogy korábban volt).
    parentId: 'konzol-assembly',
    transform: {
      // Pozíció parent-(konzol-assembly) frame-ben (felhasználó által
      // áthelyezve). Identity rotation: a lap builder-natívan vízszintes
      // (builder X-Y síkban, vastagság +Z).
      position: [75, 0, 193],
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
      'Horizontal aluminium top cover plate above the gear bracket (#12), belonging to the Bracket (konzol) assembly. 236 × 80 × 10 mm. Bottom face sits on top of the gear-bracket base wall; min X edge aligns with the rear face (max X) of vertical bracket 1 (#2).',
    descriptionHu:
      'Vízszintes alumínium felső fedőlap a gear-bracket (#12) felett, a Konzol (Bracket assembly) csoporthoz tartozik. 236 × 80 × 10 mm. Az alsó síkja a gear-bracket base wall tetején fekszik; a min X éle a 2-es függőleges konzol (vertical bracket 1) hátsó (max X) síkjához illeszkedik.',
  },
  {
    id: 'x-drive-bottom-plate',
    num: 25,
    nameHu: 'alsó fedőlap (alumínium, vízszintes, 140×80×10)',
    nameEn: 'bottom cover plate (aluminium, horizontal, 140×80×10)',
    color: generatePartColor(24),
    // A felső fedőlap (#24) tükörképe, ugyanahhoz a Konzol (Bracket assembly)
    // csoporthoz tartozik. KÜLÖN BUILDER (`XDriveBottomPlate`), mert a tervezett
    // későbbi átalakítások (furatminták, kivágások stb.) függetlenek a felső
    // lapétól.
    parentId: 'konzol-assembly',
    transform: {
      // X és Y a felső fedőlappal megegyező; csak a Z eltér (felhasználó által
      // áthelyezve). Identity rotation.
      position: [84.6, 0, 116.79473140555986],
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
      'Horizontal aluminium bottom cover plate below the gear bracket (#12), mirror of the top plate (#24). 140 × 80 × 10 mm. Top face sits flush against the bottom of the gear-bracket base wall; min X edge aligns with the rear face (max X) of vertical bracket 1 (#2).',
    descriptionHu:
      'Vízszintes alumínium alsó fedőlap a gear-bracket (#12) alatt, a felső fedőlap (#24) tükörképe. 140 × 80 × 10 mm. A felső síkja a gear-bracket base wall aljához illeszkedik; a min X éle a 2-es függőleges konzol (vertical bracket 1) hátsó (max X) síkjához igazodik.',
  },

  // ===========================================================================
  // 5) FESZÍTŐ — U-groove (V-horony) görgőscsapágy
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'feszito-assembly',
    nameHu: 'Feszítő',
    nameEn: 'Tensioner',
    parentId: null,
    transform: { position: [-140, +80, 100] },
    descriptionHu: 'A csőre ráhajló feszítő görgő (U-hornyos csapágy + M4 csavar). Pozíció később hangolható.',
    descriptionEn: 'Tensioner roller pressing on the tube (U-groove bearing + M4 screw). Position to be tuned.',
  },
  {
    id: 'feszito-u-groove',
    num: 16,
    nameHu: 'U-hornyos görgőscsapágy SG10 + M4×17',
    nameEn: 'U-groove track roller SG10 + M4×17',
    color: generatePartColor(15),
    parentId: 'feszito-assembly',
    transform: {
      // Felhasználó által áthelyezve a feszito-assembly parent-frame-ben.
      // Rotation [-π, 0, 0]: builder +Z (csapágy tengelye) → world -Z, a horony
      // +X mentén áll.
      position: [136.532669560228, -111.98203623438721, 124.8807067312484],
      rotation: [-Math.PI, 0, 0],
    },
    bbox: {
      size: [
        U_GROOVE_BEARING_SG10_DIMENSIONS.outerDiam,
        U_GROOVE_BEARING_SG10_DIMENSIONS.outerDiam,
        U_GROOVE_BEARING_SG10_DIMENSIONS.totalAxialLength,
      ],
    },
    anchors: U_GROOVE_BEARING_SG10_ANCHORS,
    builders: {
      schematic: UGrooveBearingSG10Schematic,
      medium: UGrooveBearingSG10Medium,
      realistic: UGrooveBearingSG10Realistic,
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
    id: 'y-hajtas-assembly',
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
    parentId: 'y-hajtas-assembly',
    transform: {
      // Felhasználói pozíció + tájolás (override-ból). A rotation ≈ [π, π/2, -π]
      // ami ekvivalens a [0, π/2, 0]-val (kvaternion szinten); a felhasználó a
      // pulley shaft-ját közel +X irányba forgatta.
      position: [495.0575048644946, -11.647936702674581, 146.50179194512435],
      rotation: [3.12723749051012, 1.56495533883051, -3.12584024843963],
    },
    bbox: {
      size: [
        HTD_PULLEY_70T_25B_DIMENSIONS.flangeOuterDiam,
        HTD_PULLEY_70T_25B_DIMENSIONS.flangeOuterDiam,
        HTD_PULLEY_70T_25B_DIMENSIONS.totalAxialLength,
      ],
    },
    builders: {
      schematic: HtdPulley70T_25bSchematic,
      medium: HtdPulley70T_25bMedium,
      realistic: HtdPulley70T_25bRealistic,
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
    parentId: 'y-hajtas-assembly',
    transform: {
      // Felhasználói pozíció + tájolás (override-ból). Rotation [π/2, π/2, 0]:
      // builder +Y → world +Z, builder +Z → world +X.
      position: [491.46481919498143, -10.653210732494301, -41.81098325935221],
      rotation: [PI2, PI2, 0],
    },
    bbox: {
      size: [
        HTD_PULLEY_15T_8B_DIMENSIONS.flangeOuterDiam,
        HTD_PULLEY_15T_8B_DIMENSIONS.flangeOuterDiam,
        HTD_PULLEY_15T_8B_DIMENSIONS.totalAxialLength,
      ],
    },
    builders: {
      schematic: HtdPulley15T_8bSchematic,
      medium: HtdPulley15T_8bMedium,
      realistic: HtdPulley15T_8bRealistic,
    },
    descriptionEn:
      'HTD 5M timing pulley 15T (Ø8 bore, 15 mm belt) with hub. Pairs with 70T pulley.',
    descriptionHu:
      'HTD 5M fogasszíj-tárcsa 15 fog (Ø8 furat, 15 mm szíj) hub-bal. A 70T párja.',
  },
  {
    id: 'y-motor-nema23',
    num: 22,
    nameHu: 'NEMA 23 motor (Y tengely, 122 mm)',
    nameEn: 'NEMA 23 motor (Y axis, 122 mm)',
    color: generatePartColor(21),
    parentId: 'y-hajtas-assembly',
    transform: {
      // Felhasználói pozíció + tájolás. Rotation [-π/2, π/2, 0]: builder shaft
      // (+Z) világ +X felé, builder +Y → +Z (felfelé).
      position: [399.40079027375907, -9.833444536347798, -28.18749574540152],
      rotation: [-PI2, PI2, 0],
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
    id: 'y-belt-htd5m-600',
    num: 23,
    nameHu: 'HTD 5M bordásszíj 600-5M (15 mm szélesség)',
    nameEn: 'HTD 5M timing belt 600-5M (15 mm width)',
    color: generatePartColor(22),
    parentId: 'y-hajtas-assembly',
    transform: {
      // Felhasználó által áthelyezve a y-hajtas-frame-en belül. Rotation
      // [0, π/2, 0]: builder síkja a pulley shaft tengelyére merőlegesen áll.
      position: [495.8338472946668, -10.951124155340434, 147.79275808451908],
      rotation: [0, PI2, 0],
    },
    bbox: {
      // A belt befoglaló mérete builder-lokál frame-ben (pre-rotation):
      //   X = pulley center distance + 70T outer diameter (a belt nyúlik mindkét
      //       pulley körül, plusz a pulley sugarak)
      //   Y = belt szélesség (axiális, a registry rotation után world −Y)
      //   Z = 70T_OD + 2·BELT_THICKNESS (vertikális kiterjedés a hurok körül)
      size: [
        HTD_BELT_600_5M_W15_DIMENSIONS.pulleyCenterDistance +
          HTD_PULLEY_70T_25B_DIMENSIONS.outsideDiam,
        HTD_PULLEY_70T_25B_DIMENSIONS.outsideDiam + 8,
        HTD_BELT_600_5M_W15_DIMENSIONS.beltWidth,
      ],
    },
    builders: {
      schematic: HtdBelt600_5M_W15Schematic,
      medium: HtdBelt600_5M_W15Medium,
      realistic: HtdBelt600_5M_W15Realistic,
    },
    descriptionEn:
      'HTD 5M synchronous timing belt 600-5M, 15 mm wide (120 teeth, 5 mm pitch). Open-belt loop around the 70T and 15T pulleys; the required pulley center distance is computed from the belt pitch length using the open-belt formula.',
    descriptionHu:
      'HTD 5M szinkron fogasszíj 600-5M, 15 mm széles (120 fog, 5 mm pitch). Nyitott szíj-hurok a 70T és 15T pulley körül; a szükséges pulley-középponttávolságot a szíj pitch-hosszából a nyitott szíj képletével számítjuk ki.',
  },

  // ===========================================================================
  // 7) Z HAJTÁS — bolygóhajtómű + rövid NEMA 23 motor
  // ===========================================================================
  {
    kind: 'assembly',
    id: 'z-hajtas-assembly',
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
        NEMA23_MOTOR_Z_DIMENSIONS.bodySize,
        NEMA23_MOTOR_Z_DIMENSIONS.bodySize,
        NEMA23_MOTOR_Z_DIMENSIONS.bodyLength +
          NEMA23_MOTOR_Z_DIMENSIONS.bossHeight +
          NEMA23_MOTOR_Z_DIMENSIONS.shaftLength,
      ],
    },
    anchors: NEMA23_MOTOR_Z_ANCHORS,
    builders: {
      schematic: Nema23MotorZSchematic,
      medium: Nema23MotorZMedium,
      realistic: Nema23MotorZRealistic,
    },
    descriptionEn:
      'Short (81 mm) NEMA 23 stepper for the Z bending axis, mounted under the gearbox input flange.',
    descriptionHu:
      'Rövid (81 mm) NEMA 23 léptetőmotor a Z hajlító-tengelyhez, a bolygóhajtómű input flange-ére fogva.',
  },
  {
    id: 'z-gearbox',
    num: 20,
    nameHu: 'bolygóhajtómű 60×60 (20:1)',
    nameEn: 'planetary gearbox 60×60 (20:1)',
    color: generatePartColor(19),
    parentId: 'z-hajtas-assembly',
    transform: {
      // Felhasználói pozíció (override-ból) — a korábbi identity-ből áthelyezve.
      position: [667.8082727242237, 11.326209289351254, 90.64841645331325],
      rotation: [0, 0, 0],
    },
    bbox: {
      size: [
        PLANETARY_GEARBOX_60_DIMENSIONS.flangeWidth,
        PLANETARY_GEARBOX_60_DIMENSIONS.flangeWidth,
        PLANETARY_GEARBOX_60_DIMENSIONS.totalLengthWithShaft,
      ],
    },
    anchors: PLANETARY_GEARBOX_60_ANCHORS,
    builders: {
      schematic: PlanetaryGearbox60Schematic,
      medium: PlanetaryGearbox60Medium,
      realistic: PlanetaryGearbox60Realistic,
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
