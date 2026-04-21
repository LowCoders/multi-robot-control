/**
 * Csőhajlító komponens-regiszter (single source of truth).
 *
 * A V2 vizualizáció minden alkatrészét innen olvassa: ez adja a sorszámot,
 * a magyar/angol megnevezést, az egyedi színt, a hierarchiát, a transzformációt
 * és a 3 LOD-szint builder-eit. A táblázat panel és az STL exporter is innen dolgozik.
 *
 * Új alkatrész felvitele:
 *   1. parts/_template.tsx alapján hozz létre `parts/<Name>.tsx`-et.
 *   2. Importáld ide.
 *   3. Adj hozzá egy bejegyzést a TUBE_BENDER_REGISTRY tömbhöz; a `num` legyen az
 *      egyel következő szám, a `color` lehet `generatePartColor(num - 1)`.
 */
import { generatePartColor } from './colors'
import type { ComponentDef, LodLevel } from './types'
import {
  BASE_DIMENSIONS,
  BaseMedium,
  BaseRealistic,
  BaseSchematic,
  BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS,
  BevelGear15M20T45degMedium,
  BevelGear15M20T45degRealistic,
  BevelGear15M20T45degSchematic,
  EK20_BEARING_DIMENSIONS,
  EK20BearingMedium,
  EK20BearingRealistic,
  EK20BearingSchematic,
  GEAR_BRACKET_DIMENSIONS,
  GearBracketMedium,
  GearBracketRealistic,
  GearBracketSchematic,
  HTD_PULLEY_15T_8B_DIMENSIONS,
  HTD_PULLEY_70T_25B_DIMENSIONS,
  HtdPulley15T_8bMedium,
  HtdPulley15T_8bRealistic,
  HtdPulley15T_8bSchematic,
  HtdPulley70T_25bMedium,
  HtdPulley70T_25bRealistic,
  HtdPulley70T_25bSchematic,
  MOUNTING_RODS_DIMENSIONS,
  MountingRodsMedium,
  MountingRodsRealistic,
  MountingRodsSchematic,
  NEMA23_MOTOR_DIMENSIONS,
  NEMA23_MOTOR_Z_DIMENSIONS,
  Nema23MotorMedium,
  Nema23MotorRealistic,
  Nema23MotorSchematic,
  Nema23MotorZMedium,
  Nema23MotorZRealistic,
  Nema23MotorZSchematic,
  PINION_GEAR_15M_17T_DIMENSIONS,
  PinionGear15M17TMedium,
  PinionGear15M17TRealistic,
  PinionGear15M17TSchematic,
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
  SLIP_RING_H2056_12CH_DIMENSIONS,
  SlipRingH2056_12chMedium,
  SlipRingH2056_12chRealistic,
  SlipRingH2056_12chSchematic,
  U_GROOVE_BEARING_SG10_DIMENSIONS,
  UGrooveBearingSG10Medium,
  UGrooveBearingSG10Realistic,
  UGrooveBearingSG10Schematic,
  VERTICAL_BRACKET_1_DIMENSIONS,
  VERTICAL_BRACKET_2_DIMENSIONS,
  VerticalBracket1Medium,
  VerticalBracket1Realistic,
  VerticalBracket1Schematic,
  VerticalBracket2Medium,
  VerticalBracket2Realistic,
  VerticalBracket2Schematic,
} from './parts'

/**
 * A motor +X irányú eltolása a konzol HÁTSÓ síkjához képest. Az eredeti, motor face =
 * konzol back face mounting helyett a motort 60 mm-rel előre csúsztatjuk: a motor body
 * keresztülmegy a konzol cutout-ján, és a body ~felénél a konzol és a motor menetes
 * szárak + anyák segítségével van összefogva. A `MountingRods` komponens-pozíciónak
 * is ehhez kell igazodnia.
 */
const MOTOR_X_OFFSET = 60

export const TUBE_BENDER_REGISTRY: ComponentDef[] = [
  {
    id: 'base',
    num: 1,
    nameHu: 'alap',
    nameEn: 'base plate',
    color: generatePartColor(0),
    parentId: null,
    assemblyId: 'frame',
    transform: {
      // Az alap a globális [0,0,0]-ban, a teteje Y=0-n.
      position: [0, -BASE_DIMENSIONS.height / 2, 0],
    },
    bbox: {
      size: [BASE_DIMENSIONS.length, BASE_DIMENSIONS.height, BASE_DIMENSIONS.width],
    },
    builders: {
      schematic: BaseSchematic,
      medium: BaseMedium,
      realistic: BaseRealistic,
    },
    descriptionEn:
      'Base plate of the tube-bender frame. Holds the tube spindle bracket, roller infeed and bending unit.',
    descriptionHu:
      'A csőhajlító keretének alaplemeze. Erre kerül a csőtengely-tartó, a görgős előtoló és a hajlító egység.',
  },
  {
    id: 'vertical-bracket-1',
    num: 2,
    nameHu: 'függőleges konzol 1',
    nameEn: 'vertical bracket 1',
    color: generatePartColor(1),
    parentId: 'base',
    assemblyId: 'frame',
    transform: {
      // A lemez az 'alap' lokális koordinátarendszerében:
      //   - alap-középpont = lokális [0,0,0],
      //   - alap teteje az alap-lokálisban: Y = +BASE_HEIGHT/2 = +4 mm.
      //   - lemez-magasság fele = 100 mm → lemez-középpont magassága az alap-lokálisban:
      //       Y = BASE_HEIGHT/2 + PLATE_HEIGHT/2 = 4 + 100 = 104.
      //
      // X-pozíció (bracket_X = 64.5):
      //   Történeti pozíció, amit egy korábbi (motor face = bracket back) konfiguráció
      //   esetén a teljes szerelvény világ X=0 köré centrálásához számoltunk. A
      //   23HS40-5004D-E1K-1M5 hivatalos műszaki rajza szerint a TELJES motor hossz
      //   122 mm (ezen belül a hátsó 19 mm a plast driver-fedő, az első 103 mm az
      //   iron body), a kábelbevezető pedig csak (32) mm hosszan a motor TETEJÉN ül
      //   — nem nyúlik túl a hátlapon. Emiatt a szerelvény természetes centrálása már
      //   nem indokolja a 64.5-öt, de felhasználói előírás szerint a konzol pozícióját
      //   nem változtatjuk (a motor +60 mm-es +X eltolása óta a konzol egyhelyben marad).
      //   A formula numerikusan most is 64.5-et ad, így megtartjuk visszafelé kompatibilitásból.
      //
      // Forgatás: a builder lokálisan a lemez X-Y síkban van, +Z-be extrudálva
      // (vagyis a "szembenéző" oldal a builder lokális +Z felé néz). A +π/2-es
      // Y körüli forgatás mappolja: builder-lokális +Z → world +X, így a cutout
      // a világ +X irányba néz.
      position: [
        VERTICAL_BRACKET_1_DIMENSIONS.thickness / 2 +
          (NEMA23_MOTOR_DIMENSIONS.bodyLength +
            NEMA23_MOTOR_DIMENSIONS.coverLength -
            NEMA23_MOTOR_DIMENSIONS.shaftLength) /
            2,
        BASE_DIMENSIONS.height / 2 + VERTICAL_BRACKET_1_DIMENSIONS.height / 2,
        0,
      ],
      rotation: [0, Math.PI / 2, 0],
    },
    bbox: {
      // A bbox a builder lokális orientációjában van megadva (forgatás előtt):
      // szélesség (X) × magasság (Y) × vastagság (Z).
      size: [
        VERTICAL_BRACKET_1_DIMENSIONS.width,
        VERTICAL_BRACKET_1_DIMENSIONS.height,
        VERTICAL_BRACKET_1_DIMENSIONS.thickness,
      ],
    },
    builders: {
      schematic: VerticalBracket1Schematic,
      medium: VerticalBracket1Medium,
      realistic: VerticalBracket1Realistic,
    },
    descriptionEn:
      'Aluminium vertical bracket plate for mounting a NEMA 23 servo. Cuts the standard NEMA 23 outline with fastener holes; motor body passes through the cutout; shaft faces +X.',
    descriptionHu:
      'Alumínium függőleges tartólemez egy NEMA 23 (23HS40-5004D-E1K-1M5) szervo motor felfogásához. ' +
      'A NEMA 23 (56.4×56.4) sarok-indent (R=4, 1 mm kifelé eltolt center) + R=2 fillet body-profilját ' +
      'kivágva, a 4 befelé álló fülön 1-1 Ø5.1 menetes-szár furattal. A motor body keresztülmegy a ' +
      'cutout-on, a tengely +X irányba néz.',
  },
  {
    id: 'nema23-motor-1',
    num: 3,
    nameHu: 'NEMA 23 motor (X tengely)',
    nameEn: 'NEMA 23 motor (X axis)',
    color: generatePartColor(2),
    parentId: 'vertical-bracket-1',
    assemblyId: 'x-axis-drive',
    transform: {
      // A motor a függőleges konzol gyermeke. A bracket-lokális frame-ben
      // (a bracket forgatása ELŐTT) a motor builder a saját Z tengelyén
      // (motor-lokális +Z) tartja a tengelyt; a body közepe az origóban,
      // body-front face Z = +61.
      //
      // Eredeti (érintő) pozíció: Z = -(PLATE_T/2 + BODY_LENGTH/2) = -(5 + 61) = -66.
      // Most +60 mm-rel +X irányba (= bracket-lokális +Z irányba) csúsztatva,
      // tehát a motor body keresztül megy a konzol cutout-ján:
      //   Z = -66 + 60 = -6
      //
      // Eredmény (forgatás után, world-ben):
      //   - motor center world X = bracket_X - 6 = 64.5 - 6 = 58.5
      //   - motor body (122 mm TELJES hossz) world X = -2.5 .. +119.5
      //     A body két különböző keresztmetszet-profilú szakaszra oszlik:
      //       * mounting flange (front 5 mm, lekerekített négyzet + 4 Ø5.1 ÁTMENŐ
      //         furat): world X = +114.5 .. +119.5
      //       * iron body main (98 mm, sarok-indent R=4 + R=2 fillet, indent-center 1mm kifelé): world X = +16.5 .. +114.5
      //       * hátsó plast driver-fedő (19 mm, ugyanaz a sarok-indent profil): world X = -2.5 .. +16.5
      //   - a konzol world X = +59.5 .. +69.5 (az iron main indented szakaszán BELÜL — a szárak
      //     láthatóak a body OLDALÁN az indent voidokban)
      //   - tengely a cutout-on át +X-be lóg ki, csúcsa world X = +141.5
      //   - kábelbevezető a motor tetején, world X = -2.5 .. +29.5 (32 mm hosszan,
      //     a hátlaptól indulva +Z [= world +X] irányba)
      //
      // A motort a `menetes-szar-szerelveny-1` komponens (4 db M5 menetes szár +
      // 16 db M5 hex anya) tartja a konzolhoz. A szárak útja:
      //   - A mounting flange (front 5 mm) 4 db Ø5.1 ÁTMENŐ furatán haladnak át,
      //     anyaggal körülvéve — itt mechanikailag rögzítenek.
      //   - Az iron body main (98 mm) és a hátsó plast cover (19 mm) sarok-indent
      //     silhouette-jében a 4 sarok ívben befelé hajlik a M5 csavarpozíciók köré,
      //     így a Ø5 szárak az indent voidokban LÁTHATÓAN futnak a body oldalán
      //     anyag NÉLKÜL — ez a két-profilos design pont ezt a vizuálisan átlátható
      //     menetes-szár-elrendezést szolgálja.
      position: [
        0,
        VERTICAL_BRACKET_1_DIMENSIONS.cutoutCenterY,
        -(VERTICAL_BRACKET_1_DIMENSIONS.thickness / 2 + NEMA23_MOTOR_DIMENSIONS.bodyLength / 2) +
          MOTOR_X_OFFSET,
      ],
    },
    bbox: {
      // Builder-lokálisban: body 56.4×56.4 (X×Y), 122 mm hosszan a Z tengely mentén.
      size: [
        NEMA23_MOTOR_DIMENSIONS.bodySize,
        NEMA23_MOTOR_DIMENSIONS.bodySize,
        NEMA23_MOTOR_DIMENSIONS.bodyLength,
      ],
    },
    builders: {
      schematic: Nema23MotorSchematic,
      medium: Nema23MotorMedium,
      realistic: Nema23MotorRealistic,
    },
    descriptionEn:
      'NEMA 23 closed-loop stepper with dual-profile body (56.4×56.4 mm), mounted for the X-axis drive.',
    descriptionHu:
      'NEMA 23 closed-loop léptetőmotor két-profilos body-val (NEMA standard 56.4×56.4): ' +
      'front 5 mm mounting flange (lekerekített négyzet + 4 db Ø5.1 furat) + 98 mm iron main + ' +
      '19 mm plast cover sarok-indent (R=4, indent-center 1 mm kifelé eltolva) + R=2 fillet ' +
      'profilú szakaszokkal. A 4 db M5 menetes szár a flange-en megy át, a body főtömegén az ' +
      'indent voidokban LÁTHATÓAN halad. Tengely +X irányba néz.',
  },
  {
    id: 'vertical-bracket-2',
    num: 4,
    nameHu: 'függőleges konzol 2',
    nameEn: 'vertical bracket 2',
    color: generatePartColor(3),
    parentId: 'base',
    assemblyId: 'frame',
    transform: {
      // Bracket-2 a NEMA 23 motor HÁTLAPJÁHOZ illesztve: a 4 mm mély zseb feneke
      // pontosan a motor back face síkjához ér, így a motor body BELEFEKSZIK a
      // zsebbe (a sarok-indent profilú back-cover hozzáilleszkedik a zseb falához).
      //
      // Pozíció-számítás (world X-ben, mert base-local X = world X, a base
      // position-jének X komponense 0):
      //   bracket-1 world X = T1/2 + (bodyL + coverL - shaftL) / 2 = 5 + 59.5 = 64.5
      //   motor world X     = bracket-1 X + (motor bracket-1-local Z)
      //                     = 64.5 + (-T1/2 - bodyL/2 + MOTOR_X_OFFSET)
      //                     = 64.5 + (-5 - 61 + 60) = 64.5 - 6 = 58.5
      //   motor back face X = motor X - bodyL/2 = 58.5 - 61 = -2.5
      //   bracket-2 X       = motor back X + pocketDepth - T2/2
      //                     = -2.5 + 4 - 5 = -3.5
      //
      // Magasság (Y): ugyanaz mint bracket-1 (cutout / pocket = bolt-pattern közepe
      // = +50 mm-rel a lemez közepe felett, ami épp a motor magasságába esik a
      // base-tetőn nyugvó konzolon).
      //
      // Forgatás: ugyanaz +π/2 Y-körüli, mint bracket-1: a builder lokális +Z
      // (a zseb felőli oldal) → world +X felé néz, vagyis a motor felé.
      position: [
        VERTICAL_BRACKET_1_DIMENSIONS.thickness / 2 +
          (NEMA23_MOTOR_DIMENSIONS.bodyLength +
            NEMA23_MOTOR_DIMENSIONS.coverLength -
            NEMA23_MOTOR_DIMENSIONS.shaftLength) /
            2 +
          // + motor bracket-1-local Z eltolás:
          (-VERTICAL_BRACKET_1_DIMENSIONS.thickness / 2 -
            NEMA23_MOTOR_DIMENSIONS.bodyLength / 2 +
            MOTOR_X_OFFSET) -
          // - bodyL/2 (motor back face) + pocketDepth - T2/2:
          NEMA23_MOTOR_DIMENSIONS.bodyLength / 2 +
          VERTICAL_BRACKET_2_DIMENSIONS.pocketDepth -
          VERTICAL_BRACKET_2_DIMENSIONS.thickness / 2,
        BASE_DIMENSIONS.height / 2 + VERTICAL_BRACKET_2_DIMENSIONS.height / 2,
        0,
      ],
      rotation: [0, Math.PI / 2, 0],
    },
    bbox: {
      // Builder-lokális bbox: szélesség (X) × magasság (Y) × vastagság (Z).
      size: [
        VERTICAL_BRACKET_2_DIMENSIONS.width,
        VERTICAL_BRACKET_2_DIMENSIONS.height,
        VERTICAL_BRACKET_2_DIMENSIONS.thickness,
      ],
    },
    builders: {
      schematic: VerticalBracket2Schematic,
      medium: VerticalBracket2Medium,
      realistic: VerticalBracket2Realistic,
    },
    descriptionEn:
      'Rear aluminium bracket plate for the NEMA 23 back face with pockets for cabling and fasteners.',
    descriptionHu:
      'Hátsó alumínium tartólemez a NEMA 23 motor hátlapjához. 4 mm mély zseb (motor ' +
      'body sarok-indent silhouette) fogadja a motor hátát + 4 db Ø5.1 átmenő furat a ' +
      'menetes szárak számára. A motor a flange előlapi anya és a bracket-2 hátsó vég-' +
      'anyája között van összeszorítva.',
  },
  {
    id: 'menetes-szar-szerelveny-1',
    num: 5,
    nameHu: 'menetes szár szerelvény (4 db M5 + 20 anya)',
    nameEn: 'threaded rod assembly (4× M5 + 20 nuts)',
    color: generatePartColor(4),
    parentId: 'vertical-bracket-1',
    assemblyId: 'x-axis-drive',
    transform: {
      // A komponens-lokális origó a motor közepével esik egybe (a szárak így
      // a motor tengelyén futnak). A komponens bracket-1 GYERMEKE, így a
      // pozíció bracket-1-lokálisban van megadva. A bracket-1 +π/2 Y-körüli
      // forgatása után a komponens-lokális +Z = world +X = motor tengelye.
      //   X = 0   (a lemez szélességi középvonalán)
      //   Y = +50 (cutout középpont = bolt-pattern középpont)
      //   Z = motor bracket-1-lokális Z (= -T1/2 - bodyL/2 + MOTOR_X_OFFSET = -6)
      position: [
        0,
        VERTICAL_BRACKET_1_DIMENSIONS.cutoutCenterY,
        -(VERTICAL_BRACKET_1_DIMENSIONS.thickness / 2 + NEMA23_MOTOR_DIMENSIONS.bodyLength / 2) +
          MOTOR_X_OFFSET,
      ],
    },
    bbox: {
      // Builder-lokális bbox: 47×47 mm (a 47.14 pattern + szár-átmérő) × szár-hossz a Z tengely mentén.
      size: [
        47.14 + MOUNTING_RODS_DIMENSIONS.rodDiam,
        47.14 + MOUNTING_RODS_DIMENSIONS.rodDiam,
        MOUNTING_RODS_DIMENSIONS.rodLength,
      ],
    },
    builders: {
      schematic: MountingRodsSchematic,
      medium: MountingRodsMedium,
      realistic: MountingRodsRealistic,
    },
    descriptionEn:
      'Threaded rod assembly: four M5 rods clamp the NEMA 23 motor between the two vertical brackets.',
    descriptionHu:
      'Menetes szár szerelvény: 4 db M5 szár fogja össze a NEMA 23 motort a két ' +
      'függőleges konzollal és a `gear-bracket-1`-gyel. A motor a bracket-1 ' +
      'cutout-ján átnyúlik, hátulja a bracket-2 4 mm-es zsebébe fekszik. ' +
      '5 anya/szár (összesen 20 db): (1) bracket-2 hátsó vég-anya; (2,3) bracket-1 ' +
      'két oldalán; (4) motor előlap MÖGÖTT (az iron body belsejében — fade-módban ' +
      'látható); (5) gear-bracket BELSEJÉBEN (U-cavity-ben). A motor flange front ' +
      'face-e és a gear-bracket base wall back face-e KÖZVETLENÜL érintkezik, ' +
      'NINCS anya közöttük.',
  },
  {
    id: 'pinion-gear-1',
    num: 6,
    nameHu: 'fogaskerék 1.5M 17T (gear-bracket tetején, #8 felett)',
    nameEn: 'pinion gear 1.5M 17T (on gear-bracket top, above #8)',
    color: generatePartColor(5),
    parentId: 'gear-bracket-1',
    assemblyId: 'x-axis-drive',
    transform: {
      // A pinion most a `gear-bracket-1` (#16) GYERMEKE, a felső arm tetején ülve,
      // a `bevel-gear-driven-1` (#8) furatával EGYVONALBAN (közös függőleges
      // axis). Rotáció [-π/2, 0, 0]: builder +Z (a pinion tengelye) → world +Y
      // (az +Y axis a bracket-1 +π/2 Y-körüli forgatása alatt változatlan),
      // így gear face (builder Z = -10..0) lent, hub (builder Z = 0..+14) fent.
      //
      // POZÍCIÓ a gear-bracket-1 lokális frame-ben:
      //   - X (bracket) = 0  — közös motor YZ síkban a #8-cal (world Z = 0)
      //   - Z (bracket) = -12.76  — a #8 axisa = a driver pitch cone apex X-ében
      //                            (apex motor-Z 93.24 - bracket center motor-Z 106)
      //   - Y (bracket) = +18.2  — origin_Y = OUTER_HEIGHT_Y/2 - gearFaceWidth
      //                            + ARM_Y_OFFSET. A [π/2,0,0] rotáció miatt builder
      //                            Z = -GEAR_FACE_W → world +Y eltolás +10, ezért
      //                            a pinion gear-face TETEJE world-Y = +28.2
      //                            (= a LEEMELT felső arm tetején, mert ARM_Y_OFFSET
      //                            = -10), ALJA = +18.2 - HUB_HEIGHT = +4.2. Az érték
      //                            a felhasználói kéréseknek megfelelően lépésről
      //                            lépésre lett módosítva: +48.2 (eredeti) → +28.2
      //                            (a gear face tető a bracket felső arm tetejéhez
      //                            illesztve, -20) → +18.2 (még -10) → +28.2
      //                            (visszaemelve +10, együtt a #18 tengelyel) →
      //                            +18.2 (lejjebb -10, együtt a leeresztett arm-okkal
      //                            és a #18 tengelyel).
      //
      // A pinion bore (Ø8) függőlegesen átmegy az egész fogaskeréken; a #8 driven
      // gear bore-jával eredetileg PONTOSAN egy tengelyen volt (bracket X=0,
      // Z=-12.76, az apex függőleges vonalán), de a felhasználói kérésre
      // ÁTHELYEZVE +40 mm-rel +X-be (bracket X=+40), ahol a 16. elem oldalain
      // található MÁSIK Ø8 furat van. A #8 (driven bevel) ÉRINTETLEN az X=0-on
      // — a meshing így megszűnik, de a kísérlet célja a fizikai illeszkedés
      // ellenőrzése a második furathoz.
      position: [
        +40,
        GEAR_BRACKET_DIMENSIONS.outerHeightY / 2 -
          PINION_GEAR_15M_17T_DIMENSIONS.gearFaceWidth +
          GEAR_BRACKET_DIMENSIONS.armYOffset,
        -12.76,
      ],
      rotation: [Math.PI / 2, 0, 0],
    },
    bbox: {
      // Builder-lokális bbox: tipDiam × tipDiam × totalHeight.
      size: [
        PINION_GEAR_15M_17T_DIMENSIONS.tipDiam,
        PINION_GEAR_15M_17T_DIMENSIONS.tipDiam,
        PINION_GEAR_15M_17T_DIMENSIONS.totalHeight,
      ],
    },
    builders: {
      schematic: PinionGear15M17TSchematic,
      medium: PinionGear15M17TMedium,
      realistic: PinionGear15M17TRealistic,
    },
    descriptionEn:
      'Spur gear module 1.5, 17 teeth, Ø8 bore with hub/set screws. Pinion on motor shaft above the gear bracket.',
    descriptionHu:
      'Spur fogaskerék: modul 1.5, 17 fog, Ø8 furat, set screw collar (hub). A ' +
      '`gear-bracket-1` U-bracket FELSŐ arm-jánál — az X körüli 180°-os fordítás ' +
      'után a gear face FELÜL (a bracket teteje SZINTJÉN), a hub LEFELÉ a bracket ' +
      'belseje felé nyúlik. A `bevel-gear-driven-1` (#8) furatával EGY KÖZÖS ' +
      'FÜGGŐLEGES TENGELYEN (world axis +Y, X = driver apex X). A pinion gear ' +
      'face TETEJE PONTOSAN a gear-bracket felső szárának tetején (Y = +38.2) van.',
  },
  {
    id: 'bevel-gear-driver-1',
    num: 7,
    nameHu: 'kúpfogaskerék 1.5M 20T 45° (hajtó, X motoron)',
    nameEn: 'bevel gear 1.5M 20T 45° (driver, on X motor)',
    color: generatePartColor(6),
    parentId: 'nema23-motor-1',
    assemblyId: 'x-axis-drive',
    transform: {
      // A kúpfogaskerék MÁSOLATA, hajtó (driver) gyanánt a NEMA 23 X-motor
      // tengelyére (Ø8 × 22 mm) feltolva. A motor builder +Z = a tengely iránya
      // (a szülő bracket-1 [0, +π/2, 0] rotációja után ez world +X-be mappolódik).
      // A fogaskerék builder +Z is a saját tengelye → identity rotációval a
      // gear axisa egybeesik a motor tengelyével.
      //
      // Pozicionálás motor-lokális Z-ben:
      //   - motor body front face: motor-Z = +61 (= bodyLength/2)
      //   - boss tető:             motor-Z = +62.6 (= bodyLength/2 + bossHeight)
      //   - shaft:                 motor-Z = +62.6 .. +84.6 (22 mm hosszú)
      //
      // A bevel gear builder-Z = HUB_Z_BOTTOM (-16.36) .. Z_TOOTH_TOP (0).
      // A fogazat KIS vége (Z = 0) PONTOSAN a tengely végéhez illesztve:
      //   gear_origin_Z = shaft tip motor-Z
      //                 = bodyLength/2 + bossHeight + shaftLength
      //                 = 61 + 1.6 + 22 = 84.6
      // Így:
      //   - hub alja          motor-Z = 84.6 - 16.36 = 68.24 (a gear-bracket-1
      //                       base wall belsejében — szükséges hozzá a
      //                       Ø40 átmenő furat a base wall-on, lásd `gear-bracket-1`)
      //   - hub teteje / cone wide  motor-Z = 78.24
      //   - fogazat kis vége (tip)  motor-Z = 84.6 = shaft tip
      //
      // A gear NEM fekszik fel a motor előlapjára / boss-ra (a tengely + a
      // beépített Ø8 furat radiális vezetése + esetleges set-screw / locktite tartja).
      position: [
        0,
        0,
        NEMA23_MOTOR_DIMENSIONS.bodyLength / 2 +
          NEMA23_MOTOR_DIMENSIONS.bossHeight +
          NEMA23_MOTOR_DIMENSIONS.shaftLength,
      ],
    },
    bbox: {
      size: [
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.totalAxialExtent,
      ],
    },
    builders: {
      schematic: BevelGear15M20T45degSchematic,
      medium: BevelGear15M20T45degMedium,
      realistic: BevelGear15M20T45degRealistic,
    },
    descriptionEn:
      'Bevel gear 1.5M 20T 45° — driver stage on the X motor.',
    descriptionHu:
      'Kúpfogaskerék — 1.5M, 20T, 45° osztókúpszög, hajtó (driver) tag a NEMA 23 ' +
      'X-motor tengelyén. Hub a motor felé (boss fölött), fogazat a motortól el ' +
      'irányba (világ +X). Azonos építésű mint a `bevel-gear-driven-1` partner.',
  },
  {
    id: 'bevel-gear-driven-1',
    num: 8,
    nameHu: 'kúpfogaskerék 1.5M 20T 45° (hajtott)',
    nameEn: 'bevel gear 1.5M 20T 45° (driven)',
    color: generatePartColor(7),
    parentId: 'gear-bracket-1',
    assemblyId: 'x-axis-drive',
    transform: {
      // A `bevel-gear-driver-1` partnere — a `gear-bracket-1` GYERMEKÉKÉNT, a U
      // belsejében (cavity-ben) elhelyezve, axisa +Y felé (FORGATÁS VÁLTOZATLAN
      // a preview-höz képest: [-π/2, 0, 0]).
      //
      // MESHING SZÁMÍTÁS (45° osztókúpszögű bevel pair, közös pitch cone apex):
      //   - Driver (#7) origin (= teeth tip) motor-Z = +84.6
      //   - Driver pitch back face motor-Z = 84.6 - toothAxialExtent (6.36) = 78.24
      //   - Apex axiális távolság a back face-től = pitchR_BACK / tan(45°) = 15 mm
      //   - Driver pitch cone APEX motor-Z = 78.24 + 15 = 93.24
      //     (= world X = motor_world_X + 93.24)
      //
      //   - Driven axisa = world +Y, az apex-en keresztül
      //   - Driven origin (= teeth tip, builder Z=0) az apex-től lefelé 8.64 mm
      //     (apex builder Z = +8.64 = pitchR_BACK - toothAxialExtent)
      //   - Driven origin world: (apex_X, motor_Y - 8.64, 0)
      //
      // POZÍCIÓ a gear-bracket-1 lokális frame-ben:
      //   - Gear-bracket center motor-Z = bodyLength/2 + TOTAL_Z/2 = 61 + 45 = 106
      //   - bracket +Z = motor +Z = world +X (bracket-1 [0, π/2, 0] miatt)
      //   - bracket +Y = world +Y (változatlan)
      //   - bracket +X = world -Z
      //   - X (bracket) = 0  (driven axis = motor axis YZ síkban, world Z = 0)
      //   - Y (bracket) = -8.64  (driven origin world Y - bracket center Y = -APEX_AXIAL)
      //   - Z (bracket) = 93.24 - 106 = -12.76  (apex motor-Z minus bracket center motor-Z)
      //
      // ÉRINTKEZÉSI PONT: a driver pitch back körének legalsó pontja (world Y =
      // motor_Y - 15) megegyezik a driven pitch back körének leg-X pontjával —
      // egy közös pitch pontban érintkeznek (mesh).
      position: [0, -8.64, -12.76],
      rotation: [-Math.PI / 2, 0, 0],
    },
    bbox: {
      size: [
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.tipDiamBack,
        BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS.totalAxialExtent,
      ],
    },
    builders: {
      schematic: BevelGear15M20T45degSchematic,
      medium: BevelGear15M20T45degMedium,
      realistic: BevelGear15M20T45degRealistic,
    },
    descriptionEn:
      'Bevel gear 1.5M 20T 45° — driven stage with mesh/shaft geometry.',
    descriptionHu:
      'Kúpfogaskerék — 1.5M, 20T, 45° osztókúpszög, fogazat + root cone + ' +
      'Ø24×10 mm hub cilinder Ø8 furattal. A `bevel-gear-driver-1` MESHELŐ ' +
      'partnere: gear-bracket-1 U-cavity-jében felfüggesztve, axisa függőleges ' +
      '(+Y), a driver pitch cone apex-én osztva közös találkozási pontot. A ' +
      'driven hub a gear-bracket alsó arm-ja közelében lóg le (Y ~ -25), a ' +
      'fogazat felfelé mutat és a driver fogazatával felülről érintkezik.',
  },
  {
    id: 'gearbox-1',
    num: 9,
    nameHu: 'bolygóhajtómű 60×60 (i = 20:1)',
    nameEn: 'planetary gearbox 60×60 (ratio 20:1)',
    color: generatePartColor(8),
    parentId: 'base',
    assemblyId: 'preview-shelf',
    transform: {
      // KÜLÖNÁLLÓ ELŐNÉZETI POZÍCIÓ — a felhasználó később illeszti a fő szerelvényhez.
      // Jelenleg a base-en kívül, +Z irányba (operátor felé) 200 mm-rel eltolva,
      // és a motor magasságában (Y = 150 mm world) látható, hogy a Z-motorral
      // együtt inspektálható legyen.
      //
      // Pozíció-számítás (base-local = world − base_world_pos, ahol
      // base_world_pos = (0, -BASE_DIMENSIONS.height/2, 0)):
      //   world (0, 150, +200) → base-local (0, 150 + BASE_HEIGHT/2, +200)
      //                                    = (0, 154, +200)
      //
      // Forgatás -π/2 X körül: builder +Z (= a hajtómű tengelye, output shaft
      // iránya) → world +Y. Vagyis az output shaft FELFELÉ (+Y) mutat, a Z-tengely
      // iránya ez lesz. A Z-motor (gearbox-1 gyermeke, identity rotáció) szintén
      // ebben az orientációban áll: a motor tengelye felfelé nyúlik a gearbox
      // input bore-jába.
      position: [
        0,
        BASE_DIMENSIONS.height / 2 + 150,
        200,
      ],
      rotation: [-Math.PI / 2, 0, 0],
    },
    bbox: {
      // Builder-lokális bbox: 60 × 60 (X×Y, flange-méret) × totalLengthWithShaft
      // (Z, az input flange hátlapjától az output shaft tetejéig).
      size: [
        PLANETARY_GEARBOX_60_DIMENSIONS.flangeWidth,
        PLANETARY_GEARBOX_60_DIMENSIONS.flangeWidth,
        PLANETARY_GEARBOX_60_DIMENSIONS.totalLengthWithShaft,
      ],
    },
    builders: {
      schematic: PlanetaryGearbox60Schematic,
      medium: PlanetaryGearbox60Medium,
      realistic: PlanetaryGearbox60Realistic,
    },
    descriptionEn:
      '60×60 mm planetary gearbox for NEMA 23, reduction about 20:1 (STEPPERONLINE-style).',
    descriptionHu:
      'STEPPERONLINE NEMA 23-hoz tervezett bolygóhajtómű, 60×60 mm flange, ' +
      '20:1 áttétel, Ø8 input bore, Ø14 D-cut output shaft, M5 menetes motor-' +
      'rögzítő furatokkal. Egyfokozatú planetary speed reducer: a Z-motor ' +
      '8 mm-es tengelye belép az input bore-ba, a kimenetnél nagyobb forgató-' +
      'nyomatékot ad a 14 mm-es output tengelyen. Output tengely +Y felé (felfelé).',
  },
  {
    id: 'nema23-motor-z',
    num: 10,
    nameHu: 'Z-tengely NEMA 23 léptetőmotor (rövid, 81 mm)',
    nameEn: 'Z-axis NEMA 23 stepper motor (short, 81 mm)',
    color: generatePartColor(9),
    parentId: 'gearbox-1',
    assemblyId: 'preview-shelf',
    transform: {
      // A Z-motor a gearbox GYERMEKE, így a transzformációk gearbox-builder-local
      // koordinátákban vannak megadva. A gearbox builder +Z = főtengely (input→output),
      // origó a body középpontjában.
      //
      // - Motor ROTÁCIÓ: identity [0, 0, 0]. Mivel a szülő gearbox rotation =
      //   [-π/2, 0, 0] (builder +Z → world +Y), a motor builder +Z szintén world +Y-ba
      //   mappolódik — vagyis a motor tengelye FELFELÉ mutat a gearbox input bore-ba.
      //
      // - Motor POZÍCIÓ gearbox-local: a motor front-face-ét (builder +Z end, ahol a
      //   tengely + boss kiáll) a gearbox input face-éhez (builder Z = -bodyTotalLength/2)
      //   illesztjük. Így:
      //     motor_center_Z = -bodyTotalLength/2 - bodyLength_Z/2
      //                    = -89.5/2 - 81/2 = -44.75 - 40.5 = -85.25
      //   X, Y = 0 (koaxiális a gearbox főtengelyével).
      //
      // Világkoordinátában ez így néz ki (gearbox world origo = (0, 150, 200),
      // rotation = [-π/2, 0, 0] applied): a motor világ-középpontja
      //   world = (0, 150 + 85.25 * sin(-π/2) * irány-jel..., ...) — konkrétan:
      //   (0, 150 - 40.5 - 44.75, 200) = (0, 64.75, 200) world,
      // a motor tengelye pedig (0, +105.25 .. +127.25, 200) — a gearbox input
      // face-étől indul felfelé 22 mm-en át, belemegy az input bore-ba.
      position: [
        0,
        0,
        -(
          PLANETARY_GEARBOX_60_DIMENSIONS.bodyTotalLength / 2 +
          NEMA23_MOTOR_Z_DIMENSIONS.bodyLength / 2
        ),
      ],
      rotation: [0, 0, 0],
    },
    bbox: {
      // Builder-lokális bbox: bodySize × bodySize × (body + boss + shaft).
      size: [
        NEMA23_MOTOR_Z_DIMENSIONS.bodySize,
        NEMA23_MOTOR_Z_DIMENSIONS.bodySize,
        NEMA23_MOTOR_Z_DIMENSIONS.bodyLength +
          NEMA23_MOTOR_Z_DIMENSIONS.bossHeight +
          NEMA23_MOTOR_Z_DIMENSIONS.shaftLength,
      ],
    },
    builders: {
      schematic: Nema23MotorZSchematic,
      medium: Nema23MotorZMedium,
      realistic: Nema23MotorZRealistic,
    },
    descriptionEn:
      'Short NEMA 23 stepper (~81 mm body) for the Z bending axis.',
    descriptionHu:
      'Z-tengelyes NEMA 23 léptetőmotor — 81 mm-es rövidebb törzs-variáns, a ' +
      'bolygóhajtómű (gearbox-1) alá szerelve, tengelye felfelé a gearbox input ' +
      'bore-jába nyúlik. A gearbox-szal együtt a Z-tengely léptetőhajtása.',
  },
  {
    id: 'y-bearing-ek20',
    num: 11,
    nameHu: 'Y-tengely csapágytartó (EK20, fixed oldal)',
    nameEn: 'Y-axis bearing support (EK20, fixed side)',
    color: generatePartColor(10),
    parentId: 'base',
    assemblyId: 'preview-shelf',
    transform: {
      // KÜLÖNÁLLÓ ELŐNÉZETI POZÍCIÓ — a felhasználó később illeszti a Y-tengely
      // golyósorsójához. A gearbox+Z-motor szerelvénytől BALRA helyezzük el
      // (-X irányba 200 mm-rel), ugyanazon a "preview shelf" Z magasságon
      // (Z = +200, operátor felé), és Y = 100 mm-en (jól látható szemmagasságban).
      //
      // Builder lokális orientáció: bore tengely = +Z, pedestal felfelé = +Y.
      // Identity rotáció megtartja ezt világban — vagyis a bore vízszintesen,
      // operátor felé (+Z) néz, a pedestal pedig felfelé (+Y) áll. Ez nem
      // a végleges Y-tengelyes orientáció (ott a bore függőleges lenne), de
      // INSPEKCIÓRA praktikus, mert így a furat jól látható szemből.
      //
      // base-local pozíció = world − base_world_pos, base_world = (0, -BASE_HEIGHT/2, 0):
      //   world (-200, 100, +200) → base-local (-200, 100 + BASE_HEIGHT/2, +200)
      //                                       = (-200, 104, +200)
      position: [
        -200,
        BASE_DIMENSIONS.height / 2 + 100,
        200,
      ],
      rotation: [0, 0, 0],
    },
    bbox: {
      // Builder-lokális bbox: B × H × L = 95 × 58 × 42.
      size: [
        EK20_BEARING_DIMENSIONS.blockWidth,
        EK20_BEARING_DIMENSIONS.blockHeight,
        EK20_BEARING_DIMENSIONS.blockLengthAxial,
      ],
    },
    builders: {
      schematic: EK20BearingSchematic,
      medium: EK20BearingMedium,
      realistic: EK20BearingRealistic,
    },
    descriptionEn:
      'HIWIN EK20-type bearing block for Ø20 ball screw fixed side (BK–EK pair).',
    descriptionHu:
      'HIWIN EK20-C5 csapágytartó blokk Ø20-as golyósorsóhoz (BK-EK sorozat, ' +
      'fixed oldal). Alaplemez (95×25×42 mm, H1=25 mm a bore-tengelyig) 2 db ' +
      'Ø6.6 átmenő furattal a P=75 pattern szerinti füleken (a 2 központi ' +
      'mounting furat eltávolítva). Pedestal (56×33×42 mm) T-shape Z-extrudált ' +
      'profillal, amely magába foglalja az alap felső 10 mm-ét is — így a ' +
      'TELJES Ø20 bore-tengely Z oldalról egyetlen körlapként látszik (a foot ' +
      'felső felében is). A Y-tengely golyósorsójának rögzített végét fogja meg, ' +
      'szögbeállású csapágy-párral (7204B P0; a belső csapágyak nincsenek ' +
      'modellezve).',
  },
  {
    id: 'slip-ring-h2056-12ch',
    num: 12,
    nameHu: 'csúszógyűrű (SENRING H2056-12, 20×56 mm, 12 csatorna)',
    nameEn: 'slip ring (SENRING H2056-12, 20×56 mm, 12 channels)',
    color: generatePartColor(11),
    parentId: 'base',
    assemblyId: 'preview-shelf',
    transform: {
      // KÜLÖNÁLLÓ ELŐNÉZETI POZÍCIÓ — a felhasználó később illeszti a
      // forgótengelyhez. A Y-bearing (-200, 100, 200) FÖLÉ helyezzük 80 mm-rel,
      // ugyanazon Z-síkon, hogy könnyen összevethető legyen vele.
      //
      // Forgatás: a builder lokális +Z = bore-tengely. A felhasználó kérésére
      // a bore világban +X felé álljon → rotation [0, π/2, 0] mappolja: builder
      // +Z → world +X.
      //
      // base-local = world − base_world_pos, base_world = (0, -BASE_HEIGHT/2, 0):
      //   world (-200, 180, +200) → base-local (-200, 184, +200)
      position: [
        -200,
        BASE_DIMENSIONS.height / 2 + 180,
        200,
      ],
      rotation: [0, Math.PI / 2, 0],
    },
    bbox: {
      // Builder-lokális bbox: OD × OD (X×Y) × body axiális hossz (Z).
      size: [
        SLIP_RING_H2056_12CH_DIMENSIONS.outerDiam,
        SLIP_RING_H2056_12CH_DIMENSIONS.outerDiam,
        SLIP_RING_H2056_12CH_DIMENSIONS.totalAxialLength,
      ],
    },
    builders: {
      schematic: SlipRingH2056_12chSchematic,
      medium: SlipRingH2056_12chMedium,
      realistic: SlipRingH2056_12chRealistic,
    },
    descriptionEn:
      'SENRING H2056-12 slip ring Ø20 bore / Ø56 OD, 12 channels for rotating electrical passes.',
    descriptionHu:
      'SENRING H2056-12 átmenő furatos csúszógyűrű — Ø20 mm belső furat, Ø56 mm ' +
      'külső átmérő, 12 csatorna × 10 A. EGYSZERŰSÍTETT geometria: csak a központi ' +
      'henger (flange / vezetékek / csatornagyűrűk nélkül). Bore tengely világban ' +
      '+X felé.',
  },
  {
    id: 'u-groove-bearing-sg10',
    num: 13,
    nameHu: 'U-hornyolatos görgőscsapágy (SG10 + M4×17 csavar)',
    nameEn: 'U-groove track roller bearing (SG10 + M4×17 screw)',
    color: generatePartColor(12),
    parentId: 'base',
    assemblyId: 'preview-shelf',
    transform: {
      // KÜLÖNÁLLÓ ELŐNÉZETI POZÍCIÓ. Mivel a csapágy nagyon kicsi (Ø13 × 6 mm),
      // a Y-bearing MELLÉ (-200, 100, 200) helyezzük +X-felé 60 mm-rel,
      // ugyanabban a magasságban hogy a méretarány érzékelhető legyen.
      //
      // base-local = world − base_world_pos:
      //   world (-140, 100, +200) → base-local (-140, 104, +200)
      //
      // Forgatás: a csavar tengelye builder +Z. -π/2 X körül forgatva: builder +Z
      // → world +Y, vagyis a csavar/csapágy tengelye FÜGGŐLEGESEN áll, a fej
      // alulra kerül. Így a U-horony szembe néz az operátorral, a csapágy
      // szerkezete jól látszik.
      position: [
        -140,
        BASE_DIMENSIONS.height / 2 + 100,
        200,
      ],
      rotation: [-Math.PI / 2, 0, 0],
    },
    bbox: {
      // Builder-lokális bbox: OD × OD (X×Y) × csavar teljes hossz (Z).
      size: [
        U_GROOVE_BEARING_SG10_DIMENSIONS.outerDiam,
        U_GROOVE_BEARING_SG10_DIMENSIONS.outerDiam,
        U_GROOVE_BEARING_SG10_DIMENSIONS.totalAxialLength,
      ],
    },
    builders: {
      schematic: UGrooveBearingSG10Schematic,
      medium: UGrooveBearingSG10Medium,
      realistic: UGrooveBearingSG10Realistic,
    },
    descriptionEn:
      'SG10 U-groove track roller with M4×17 mounting hardware.',
    descriptionHu:
      'SG10 U-hornyolatos (V-groove) görgőscsapágy a hozzá készített M4×17 mm ' +
      'vállas csavarral. Belső furat Ø4, külső Ø13, vastagság 6 mm, hornyolat ' +
      '4×1 mm. Vezetősíneken futó vezető-görgőként vagy U-profil mentén görgőzött ' +
      'kis tartó-csapágyként használatos.',
  },
  {
    id: 'htd-pulley-70t-25b',
    num: 14,
    nameHu: 'HTD 5M fogasszíj-tárcsa 70T (Ø25 furat, 15 mm szíj, AF)',
    nameEn: 'HTD 5M timing pulley 70T (Ø25 bore, 15 mm belt, AF)',
    color: generatePartColor(13),
    parentId: 'base',
    assemblyId: 'preview-shelf',
    transform: {
      // KÜLÖNÁLLÓ ELŐNÉZETI POZÍCIÓ. A "preview shelf"-en a csúszógyűrű ALATT,
      // mert a 70T pulley nagy (Ø ~117 mm flange-szel) — kell neki hely.
      // World (-200, 60, +200), tengely vízszintesen +Z felé (operátor felé),
      // így a fogazat profilja oldalról jól látható.
      //
      // base-local = world − base_world_pos = (-200, 64, +200).
      position: [
        -200,
        BASE_DIMENSIONS.height / 2 + 60,
        200,
      ],
      rotation: [0, 0, 0],
    },
    bbox: {
      // Builder-lokális bbox: flange OD × flange OD (X×Y) × teljes axiális hossz (Z).
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
      'HTD 5M timing pulley 70T, Ø25 bore, 15 mm belt, AF series.',
    descriptionHu:
      'HTD 5M AF típusú fogasszíj-tárcsa 70 fogszámmal, Ø25 furattal, 15 mm ' +
      'szíjszélességhez. Külső Ø ≈ 110.65 mm, flange Ø ≈ 116.65 mm. A 15T ' +
      'társával együtt 4.67:1 lassító áttételt ad.',
  },
  {
    id: 'htd-pulley-15t-8b',
    num: 15,
    nameHu: 'HTD 5M fogasszíj-tárcsa 15T (Ø8 furat, 15 mm szíj, AF + hub)',
    nameEn: 'HTD 5M timing pulley 15T (Ø8 bore, 15 mm belt, AF + hub)',
    color: generatePartColor(14),
    parentId: 'base',
    assemblyId: 'preview-shelf',
    transform: {
      // KÜLÖNÁLLÓ ELŐNÉZETI POZÍCIÓ — a 70T pulley MELLETT (+X felé 100 mm-rel),
      // hasonló magasságban, hogy a méretarány (15T ≈ Ø23 mm vs 70T ≈ Ø117 mm)
      // szemmel látható legyen. A tengelye szintén +Z (operátor felé).
      //
      // base-local = world − base_world_pos = (-100, 64, +200).
      position: [
        -100,
        BASE_DIMENSIONS.height / 2 + 60,
        200,
      ],
      rotation: [0, 0, 0],
    },
    bbox: {
      // Builder-lokális bbox: flange OD × flange OD (X×Y) × teljes axiális hossz
      // (Z, body + 2 flange + hub).
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
      'HTD 5M timing pulley 15T, Ø8 bore, 15 mm belt with hub.',
    descriptionHu:
      'HTD 5M AF típusú fogasszíj-tárcsa 15 fogszámmal, Ø8 furattal, 15 mm ' +
      'szíjszélességhez, kiemelt hub-bal (Ø14 × 8 mm) és 2 db M4 set screw-vel. ' +
      'Külső Ø ≈ 23.11 mm, flange Ø ≈ 28.11 mm. A 70T-vel együtt 4.67:1 lassító ' +
      'áttételt ad — a motor tengelyén (Ø8 NEMA 23) ülve hajtja a nagy pulley-t.',
  },
  {
    id: 'gear-bracket-1',
    num: 16,
    nameHu: 'gear konzol (X motor előtt, U-tartó pinion + követő fogaskerékhez)',
    nameEn: 'gear bracket (in front of X motor, U-frame for pinion + driven gear)',
    color: generatePartColor(15),
    parentId: 'nema23-motor-1',
    assemblyId: 'x-axis-drive',
    transform: {
      // A bracket a NEMA 23 motor (X-tengely, #3) GYERMEKE. A motor builder
      // lokális +Z = motor shaft iránya, így a bracket builder identity rotációval
      // helyesen tájolódik: a builder +Z (a U szárainak iránya) = motor +Z =
      // bracket-1 forgatása ([0, π/2, 0]) után world +X — vagyis a U a
      // csőelőtolás (és a hajtott komponensek) irányába nyitva áll.
      //
      // POZÍCIÓ-SZÁMÍTÁS (motor-lokális Z mentén):
      //   - Motor flange front face:           motor-Z = +BODY/2 = +61
      //   - Bracket base wall back face KÖZVETLENÜL érintkezik a motor flange
      //     front face-ével (motor-Z = +61). NINCS anya közöttük (lásd
      //     `menetes-szar-szerelveny-1` átszervezett anyák) — a motor flange
      //     a bracket base wall-jára szorítva, a két felület tisztán egymáson.
      //   - Bracket base wall front face: +61 + MATERIAL_T = +71
      //   - Bracket arm vég:               +61 + TOTAL_Z = +151
      //   - Bracket builder GEOMETRIAI KÖZÉPPONT (origó) motor-lokálisban:
      //     +61 + TOTAL_Z/2 = +61 + 45 = +106
      //
      // X, Y = 0 (a base wall és az arm-ok X-ben és Y-ben centrálva a motor
      // tengelyére, mert a builder origó a bbox közepén van, és a 47.14 furat-
      // pattern is a centrumhoz képest szimmetrikus).
      //
      // KÖZPONTI Ø40 ÁTMENŐ FURAT a base wall-on: a motor pilot boss (Ø38.1)
      // belefekszik (axiálisan a motor-Z +61..+62.6 közé esik, a bracket base
      // wall +61..+71 régiójában — közös tengellyel), és a `bevel-gear-driver-1`
      // hub (Ø24 OD, motor-Z +68.24..+78.24) is szabadon átfér rajta. Így a
      // bracket úgy fekszik fel a motor flange front face-ére, hogy a boss + hub
      // a Ø40 furatban van, nem akadnak össze a base wall anyagával.
      position: [
        0,
        0,
        NEMA23_MOTOR_DIMENSIONS.bodyLength / 2 + GEAR_BRACKET_DIMENSIONS.totalLengthZ / 2,
      ],
      rotation: [0, 0, 0],
    },
    bbox: {
      // Builder-lokális bbox: szélesség (X) × outer magasság (Y) × teljes Z.
      size: [
        GEAR_BRACKET_DIMENSIONS.widthX,
        GEAR_BRACKET_DIMENSIONS.outerHeightY,
        GEAR_BRACKET_DIMENSIONS.totalLengthZ,
      ],
    },
    builders: {
      schematic: GearBracketSchematic,
      medium: GearBracketMedium,
      realistic: GearBracketRealistic,
    },
    descriptionEn:
      'Aluminium U-frame gear bracket in front of the X motor holding pinion and driven gears.',
    descriptionHu:
      'Alumínium U-tartó (gear konzol) a NEMA 23 X-motor flange előlapjához ' +
      'KÖZVETLENÜL felfekve, a 4 db M5 menetes száron felfűzve. Befoglaló méret: ' +
      '56.4 (X) × 76.4 (Y) × 90 (Z, a base wall 10 mm + 80 mm arm). 3 szakasz: ' +
      '(1) base wall 56.4×76.4×10 mm: 4 db Ø5.1 furat a NEMA 23 47.14 mm ' +
      'pattern-en (a motor flange furataival egyező pozícióban) + 1 db Ø40 ' +
      'KÖZPONTI átmenő furat a hub + boss clearance-hez; (2+3) felső és alsó ' +
      'arm = 56.4×10×80 mm, a base wall tetején/alján +Z (motor shaft) irányba ' +
      'kinyúlva. A 2 arm közötti BELSŐ gap = 56.4 mm. Az U szárai a motor ' +
      'tengelyirányába (world +X) nyúlnak, befogadva a `bevel-gear-driver-1` ' +
      'hajtó kúpfogaskereket és a leendő követő (driven) fogaskereket.',
  },
  {
    id: 'shaft-support-1',
    num: 17,
    nameHu: 'tengelytámasz SHF20 (Ø20 tengely, álló blokk M5 szorítóval)',
    nameEn: 'shaft support SHF20 (Ø20 shaft, upright block with M5 clamp)',
    color: generatePartColor(16),
    parentId: 'base',
    assemblyId: 'frame',
    transform: {
      // Az alaplemez ('base') GYERMEKE. A base lokális koordinátarendszerében
      // a base teteje Y = +BASE_HEIGHT/2 = +4. A támasz alja erre fekszik fel,
      // a builder origó (Y = 0) a támasz GEOMETRIAI KÖZEPE → builder Y eltolás
      // = +BASE_HEIGHT/2 + H/2 = +4 + 25 = +29.
      //
      // X-pozíció: ideiglenesen az alap KÖZEPÉRE helyezve (X = 0); a végleges
      // pozíció a csőelőtoló / csőtengely-vezető mentén kerül megadásra,
      // miután a tengely végpontját ismerjük. Z = 0 a base közepén.
      position: [
        0,
        BASE_DIMENSIONS.height / 2 + SHAFT_SUPPORT_SHF20_DIMENSIONS.totalHeight / 2,
        0,
      ],
      rotation: [0, 0, 0],
    },
    bbox: {
      // Builder-lokális bbox: A (X) × H (Y) × B (Z).
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
      'Shaft support block Ø20 (SHF20-style) upright with M5 clamp.',
    descriptionHu:
      'Tengelytámasz blokk Ø20 mm-es fix tengelyhez (SHF20 / SK20 stílus). ' +
      'Méretek: A=60 (X) × H=50 (Y) × B=30 (Z) mm, tengely-magasság h=30, ' +
      'furattáv A1=42, 2 db Ø8.6 átmenő rögzítő furat (M8 clearance) + ' +
      '2 db M10×25 menetes furat alulról. A bore tetején függőleges szorító-rés, ' +
      'felül M5 (DIN 912) szorítócsavar X-irányban átmenve a réseken. ' +
      'Anyaga: alumínium. A bore tengelye +Z irányba mutat (a csőtengely-vezető ' +
      'tengelyt párhuzamosan tartja a base hosszanti irányával).',
  },
  {
    id: 'shaft-pinion-bevel-1',
    num: 18,
    nameHu: 'tengely Ø8 (pinion ↔ bevel közös)',
    nameEn: 'shaft Ø8 (pinion ↔ bevel common)',
    color: generatePartColor(17),
    parentId: 'gear-bracket-1',
    assemblyId: 'x-axis-drive',
    transform: {
      // A tengely a gear-bracket-1 LOKÁLIS frame-jében áll függőlegesen (+Y).
      // A bracket Y-tartománya (szimmetrikus): -OUTER_HEIGHT_Y/2 .. +OUTER_HEIGHT_Y/2
      // = -38.2 .. +38.2; az ARM_Y_OFFSET = -10 miatt az arm-ok jelenlegi Y-jai:
      // felső arm: +23.2 .. +33.2, alsó arm: -43.2 .. -33.2.
      //
      // Eredeti követelmény: tengely ALJA = bracket alja (Y = -38.2), TETEJE =
      // bracket teteje + 20 mm (Y = +58.2). Hossz = 96.4 mm, közép = +10.0.
      //
      // MÓDOSÍTÁSOK:
      //   1) +10 mm felfelé (a #6 fogaskerékkel együtt): közép +10.0 → +20.0.
      //   2) -10 mm lefelé (a #6 fogaskerékkel és a leeresztett arm-okkal együtt):
      //      közép +20.0 → +10.0. Most az alja -38.2, a teteje +58.2 (visszatért
      //      az eredeti pozícióhoz). Az alsó arm furata (Y = -43.2..-33.2) körül
      //      a tengely átmegy; a felső arm furatán (Y = +23.2..+33.2) is.
      //
      // X-Z pozíció: a `bevel-gear-driven-1` (#8) függőleges axisa, ami egybeesik
      // a `pinion-gear-1` (#6) bore-jával. Lásd a #8 MESHING SZÁMÍTÁSA blokkot:
      //   - X (bracket) = 0
      //   - Z (bracket) = -12.76
      //
      // A `cylinderGeometry` default tengelye +Y, ezért rotation = identity.
      // A `gear-bracket-1` Realistic LOD-ja Ø8 átmenő furatot ad MINDKÉT arm-ra
      // (X=0, Z=-12.76) — lásd `GearBracket.tsx` `buildArmGeometry`-jét.
      // X = +40 (átszervezve a #6 fogaskerékkel együtt a 16. elem MÁSIK
      // oldalán található Ø8 furathoz). Az eredeti X=0 a #8 driven bevel
      // axisán volt, de a felhasználói kérésre most +40-rel +X-be került.
      position: [+40, +10.0, -12.76],
      rotation: [0, 0, 0],
    },
    bbox: {
      size: [
        SHAFT_8MM_DIMENSIONS.diameter,
        SHAFT_8MM_DIMENSIONS.length,
        SHAFT_8MM_DIMENSIONS.diameter,
      ],
    },
    builders: {
      schematic: Shaft8mmSchematic,
      medium: Shaft8mmMedium,
      realistic: Shaft8mmRealistic,
    },
    descriptionEn:
      'Hardened Ø8 × 96.4 mm steel shaft joining pinion and bevel gears.',
    descriptionHu:
      'Edzett szénacél tengely Ø8 × 96.4 mm — a `pinion-gear-1` (#6) és a ' +
      '`bevel-gear-driven-1` (#8) közös függőleges forgástengelye. A ' +
      '`gear-bracket-1` (#16) MINDKÉT (leeresztett) szárán átmegy a Ø8 furatokon: ' +
      'felső arm (Y = +23.2..+33.2) és alsó arm (Y = -43.2..-33.2). Tengely Y ' +
      'tartománya: -38.2..+58.2 (közép = +10.0, hossz 96.4 mm). A két fogaskerék ' +
      'agglyukát ezen a közös tengelyen forog egyszerre, így a #6 → #8 erőátvitel ' +
      'a tengely körül történik (vagy fix tengely + csapágyazott fogaskerekek, ' +
      'vagy fix fogaskerekek + forgó tengely — ez a regiszter szempontjából ' +
      'irreleváns).',
  },
  {
    id: 'pinion-gear-2',
    num: 19,
    nameHu: 'fogaskerék 1.5M 17T (másolat, +40 mm world-X-ben)',
    nameEn: 'pinion gear 1.5M 17T (copy, +40 mm world-X)',
    color: generatePartColor(18),
    parentId: 'gear-bracket-1',
    assemblyId: 'x-axis-drive',
    transform: {
      // A #6 (`pinion-gear-1`) MÁSOLATA, ugyanazon a bracket-en (#16), de a 2.
      // Ø8 furatra illesztve: bracket-lokális Z = SHAFT_HOLE_Z_2 = +27.24
      // (= az 1. furattol +40 mm-rel +Z bracket-lokálisban = +40 mm world-X-ben).
      // A többi paraméter (X = 0, Y = +18.2, rotation [π/2, 0, 0]) változatlan
      // a #6-hoz képest. Ez a másolt példány a 2. furatra szerelt fix fogaskerék —
      // a #8 driven bevel (Z=-12.76) NEM kapcsolódik vele, ez egy önálló pinion
      // a 2. tengelyen.
      position: [
        0,
        GEAR_BRACKET_DIMENSIONS.outerHeightY / 2 -
          PINION_GEAR_15M_17T_DIMENSIONS.gearFaceWidth +
          GEAR_BRACKET_DIMENSIONS.armYOffset,
        GEAR_BRACKET_DIMENSIONS.shaftHoleZ2,
      ],
      rotation: [Math.PI / 2, 0, 0],
    },
    bbox: {
      size: [
        PINION_GEAR_15M_17T_DIMENSIONS.tipDiam,
        PINION_GEAR_15M_17T_DIMENSIONS.tipDiam,
        PINION_GEAR_15M_17T_DIMENSIONS.totalHeight,
      ],
    },
    builders: {
      schematic: PinionGear15M17TSchematic,
      medium: PinionGear15M17TMedium,
      realistic: PinionGear15M17TRealistic,
    },
    descriptionEn:
      'Duplicate pinion gear — same geometry shifted +40 mm along world-X.',
    descriptionHu:
      'A `pinion-gear-1` (#6) MÁSOLATA — azonos geometriával, ugyanazon a ' +
      '`gear-bracket-1`-en (#16), de a bracket arm-jain lévő 2. Ø8 furatra ' +
      'illesztve (+40 mm world-X-ben az eredetihez képest). A másolt #20 ' +
      'tengelyen forog. Az eredetit (#6) NEM mozgattuk — ez egy KÜLÖN példány ' +
      'a bracket másik furat-pozícióján. A #8 driven bevel-lel NEM mesh-el (mert ' +
      'a #8 a Z=-12.76 furaton van, ez pedig a Z=+27.24-en).',
  },
  {
    id: 'shaft-pinion-bevel-2',
    num: 20,
    nameHu: 'tengely Ø8 (másolat, +40 mm world-X-ben)',
    nameEn: 'shaft Ø8 (copy, +40 mm world-X)',
    color: generatePartColor(19),
    parentId: 'gear-bracket-1',
    assemblyId: 'x-axis-drive',
    transform: {
      // A #18 (`shaft-pinion-bevel-1`) MÁSOLATA, ugyanazon bracket-en, de a 2.
      // Ø8 furatra illesztve: bracket-lokális Z = SHAFT_HOLE_Z_2 = +27.24.
      // X, Y, rotation (identity) változatlan a #18-hoz képest. Hossza 96.4 mm
      // marad, így alja Y = -38.2, teteje Y = +58.2 — a leeresztett arm-ok
      // mindkét furatán átmegy.
      position: [0, +10.0, GEAR_BRACKET_DIMENSIONS.shaftHoleZ2],
      rotation: [0, 0, 0],
    },
    bbox: {
      size: [
        SHAFT_8MM_DIMENSIONS.diameter,
        SHAFT_8MM_DIMENSIONS.length,
        SHAFT_8MM_DIMENSIONS.diameter,
      ],
    },
    builders: {
      schematic: Shaft8mmSchematic,
      medium: Shaft8mmMedium,
      realistic: Shaft8mmRealistic,
    },
    descriptionEn:
      'Duplicate Ø8 shaft — copy of shaft #18 at +40 mm world-X.',
    descriptionHu:
      'A `shaft-pinion-bevel-1` (#18) MÁSOLATA — azonos Ø8 × 96.4 mm acéltengely, ' +
      'ugyanazon a `gear-bracket-1`-en (#16), de a bracket arm-jain lévő 2. Ø8 ' +
      'furatra illesztve (+40 mm world-X-ben az eredetihez képest, vagyis ' +
      'bracket-lokálisan Z = +27.24). A `pinion-gear-2` (#19) másolt fogaskereket ' +
      'tartja. Az eredetit (#18) NEM mozgattuk — ez egy KÜLÖN példány a 2. ' +
      'furat-pozíción.',
  },
]

/** Lekérdezi az alkatrészt id alapján. */
export function getComponent(id: string): ComponentDef | undefined {
  return TUBE_BENDER_REGISTRY.find((c) => c.id === id)
}

/** Visszaadja egy adott szülő közvetlen gyermekeit. null = gyökér-szintűek. */
export function getChildren(parentId: string | null): ComponentDef[] {
  return TUBE_BENDER_REGISTRY.filter((c) => c.parentId === parentId)
}

/** Az összes elérhető szerelvény-id (pl. 'frame', 'z-motor-assembly'). */
export function getAssemblyIds(): string[] {
  const ids = new Set<string>()
  for (const c of TUBE_BENDER_REGISTRY) if (c.assemblyId) ids.add(c.assemblyId)
  return [...ids]
}

/**
 * A regiszter sorrendben rendezett verziója — a táblázat ezt jeleníti meg
 * (sorszám szerint).
 */
export function getOrderedComponents(): ComponentDef[] {
  return [...TUBE_BENDER_REGISTRY].sort((a, b) => a.num - b.num)
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
