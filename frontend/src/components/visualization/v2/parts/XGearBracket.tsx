/**
 * Gear konzol — a NEMA 23 (X-tengely) motor flange előlapján rögzített **U alap**
 * (base wall). A két korábbi alumínium szár-lap **el lett távolítva** — csak a
 * base wall (motor flange-csatlakozó alap) marad meg geometriailag.
 *
 * GEOMETRIA:
 *   - **Base wall**: alumínium 10 mm (Z), szélesség (X) = NEMA 23 body = 56.4 mm,
 *     magasság (Y) = külső U-magasság = 76.4 mm — ez az egyetlen vizuálisan
 *     megrajzolt rész. Furatok: 4 db Ø5.1 mm (M5 menetes szárakhoz, 47.14 mm
 *     négyzet pattern) + 1 db központi Ø40 mm (hub clearance).
 *   - **Szár-lapok**: már NEM rajzolódnak ki. A korábbi `ARM_*` / `PLATE_*`
 *     konstansok (`armYOffset`, `armPlateWidthX`, `armAxialLength`, `shaftHoleZ`,
 *     `shaftHoleZ2`, `totalLengthZ`) referenciaként megmaradnak a
 *     `X_GEAR_BRACKET_DIMENSIONS`-ban, mert a fogaskerekek (#6, #11, #14) és a
 *     Ø8 tengelyek (#19, #20) a registry-ben ezekre az értékekre hivatkoznak,
 *     hogy a régi (a U-belsejéhez igazított) pozíciójukon maradjanak.
 *
 * ROGZÍTŐ FURATOK (a base wall-on):
 *   4 db Ø5.1 mm átmenő furat a NEMA 23 47.14 mm pattern szerint (a motor flange
 *   Ø5.1 furataival fedésben). A `menetes-szar-szerelveny-1` 4 db M5 menetes
 *   szára ezeken halad át, így a bracket a motor flange-ére van összeszorítva.
 *   A bracket NEM önálló mechanikailag — a motor flange jelenti a befogást.
 *
 * KÖZPONTI FURAT (a base wall-on):
 *   1 db Ø40 mm átmenő clearance furat a motor tengelyén, hogy a `bevel-gear-
 *   driver-1` hub-ja (Ø24 OD) szabadon átférjen rajta a motor felé tartva.
 *   A motor pilot boss (Ø38.1) is elférne benne, így a bracket akár a motor
 *   flange front face-ére is felfekhet a boss-szal együtt a furatban.
 *
 * Builder lokális orientáció:
 *   - +X = bracket szélesség iránya (= motor body X = world -Z a motor parent
 *     bracket-1 [0, π/2, 0] forgatása után)
 *   - +Y = függőlegesen felfelé (= world +Y)
 *   - +Z = az U szárai EBBE az irányba nyúlnak (= motor shaft iránya, ami a
 *     bracket-1 forgatása után = world +X) — vagyis az U a csőelőtolás irányába
 *     nyitva áll, és az motor pinion fogaskerék a U BELSEJÉBE kerül.
 *   - Origó: a builder-lokális frame közepe a régi U bbox közepe maradt
 *     (`TOTAL_Z = 90`). A megrajzolt base wall Z range: -45 .. -35 (a régi U
 *     "alja", -Z oldalon). A `+Z` oldal mostantól ÜRES (csak referencia-
 *     koordináták a fogaskerekek pozícionálásához).
 *
 * SZERELVÉNY (a regiszterben):
 *   A bracket parentje a `nema23-motor-1` (motor #3). A motor builder lokális
 *   +Z = motor shaft iránya, így a bracket builder identity rotációval helyesen
 *   tájolódik (az U szárai a motor tengely-irányába mennek, ami bracket-1
 *   forgatása után world +X). A motor flange front face motor-lokálisban
 *   Z = +BODY_LENGTH/2 = +61. A bracket base wall back face-ét a flange előtt
 *   pozicionáljuk, a meglévő motor flange előlapi anya (Z ≈ +61.4..+65.4) UTÁN
 *   kis clearance-szel — vagyis a bracket center Z motor-lokálisban ≈ +111
 *   (base wall back face Z = +66).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Anchor, PartBuilderProps } from '../types'
import { NEMA23_BODY_SIZE, NEMA23_BOLT_PATTERN } from './_motorSilhouette'
import { VERTICAL_BRACKET_1_DIMENSIONS } from './VerticalBracket1'

// ---- Méretek ----
const MATERIAL_T = 10
const WIDTH_X = NEMA23_BODY_SIZE // = 56.4 — base wall szélessége = motor body szélessége
const INNER_HEIGHT_Y = NEMA23_BODY_SIZE // = 56.4 — belső gap a 2 szár között = motor magassága
const OUTER_HEIGHT_Y = INNER_HEIGHT_Y + 2 * MATERIAL_T // = 76.4
/** Szár-lap szélessége (X) = `vertical-bracket-1` (#2 elem) lemez szélessége. */
const PLATE_ARM_WIDTH_X = VERTICAL_BRACKET_1_DIMENSIONS.width // = 80
/** Eredeti U axiális „nyúlvány” a bbox-hoz (base 10 + 80); a szár-lap kitölti ezt a 80 mm-t. */
const LEGACY_U_ARM_SPAN = 80
const TOTAL_Z = MATERIAL_T + LEGACY_U_ARM_SPAN // = 90

// ---- Furat-pattern (a motor flange-szel egyező 47.14 négyzet) ----
const BOLT_HOLE_DIAM = 5.1
const HALF_BP = NEMA23_BOLT_PATTERN / 2 // = 23.57

/** KÖZPONTI clearance furat a base wall-on a `bevel-gear-driver-1` (és a régi
 *  `pinion-gear-1`) hub-jának ÁTMENETÉHEZ. Ø40 (r=20) — a motor pilot boss
 *  (Ø38.1) körül elférne, a bevel hub Ø24 OD pedig nagy radiális clearance-szel
 *  átfér. A furat középpontja a base wall (és a motor) tengelyén van. */
const CENTER_HOLE_DIAM = 40

/** Regiszter / fogaskerék-pozícióhoz: tengely tengelyvonal Z-jei (a szár-lapokon
 *  NINCS furat — csak referenciaértékek a `X_GEAR_BRACKET_DIMENSIONS`-ban exportálva). */
const SHAFT_HOLE_DIAM = 8
const SHAFT_HOLE_Z = -12.76
const SHAFT_HOLE_Z_2 = SHAFT_HOLE_Z + 40 // = +27.24

/** Base wall elülső síkja bracket-lokális Z-ben (innen indulnak a szár-lapok +Z felé). */
const ARM_Z_START = -TOTAL_Z / 2 + MATERIAL_T // = -35
/** Szár-lap axiális hossz: base wall elejétől a befoglaló +Z végéig (teljes U-nyúlvány). */
const ARM_AXIAL_LENGTH = TOTAL_Z / 2 - ARM_Z_START // = 45 - (-35) = 80
/** Szár-lap Z-középpontja. */
const ARM_CENTER_Z = ARM_Z_START + ARM_AXIAL_LENGTH / 2 // = 5

/**
 * A 2 arm (felső + alsó) Y-irányú LEFELÉ tolása a bracket szimmetrikus
 * pozícióhoz képest. Felhasználói kérésre (-10 mm), hogy a #6 fogaskerék és a
 * #18 tengely is lejjebb kerüljön a bracket szárai között. A base wall (motor
 * flange-csatlakozás) hely\u00e9n marad, ÉS a base wall szélein kicsit kilóg a
 * profil felül (mert az outer height +38.2 helyett +28.2-ig megy az arm). */
const ARM_Y_OFFSET = -10

// ---- Material hookok ----

/** Alumínium PBR — világos szürke, kissé sötétebb mint a függőleges konzolok,
 *  hogy vizuálisan elkülönüljön (anodizált / felületkezelt benyomás). */
function useAluminumMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#aab0b6',
        metalness: 0.7,
        roughness: 0.4,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

// ---- Geometria buildek ----

/**
 * Base wall 2D shape: téglalap WIDTH × OUTER_HEIGHT (X × Y), 4 db Ø5.1 furattal
 * a 47.14 mm négyzet-pattern szerint. A 4 furat a base wall KÖZÉPVONALÁBAN van
 * (a Y középpont = 0, mert a base wall a teljes outer height-ot fedi le).
 *
 * A motor flange furat-pattern centruma a motor tengelyén van — a base wall
 * X és Y középpontja = 0, ami megegyezik a motor tengelyével (mert a bracket
 * X-ben centrált a motor flange-re, Y-ben pedig a középponttal egybeesik a
 * motor flange centroidja).
 */
function buildBaseWallShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-WIDTH_X / 2, -OUTER_HEIGHT_Y / 2)
  shape.lineTo(+WIDTH_X / 2, -OUTER_HEIGHT_Y / 2)
  shape.lineTo(+WIDTH_X / 2, +OUTER_HEIGHT_Y / 2)
  shape.lineTo(-WIDTH_X / 2, +OUTER_HEIGHT_Y / 2)
  shape.closePath()

  // 4 db Ø5.1 furat a 47.14 négyzet sarkain, X-Y síkban.
  const r = BOLT_HOLE_DIAM / 2
  const positions: Array<[number, number]> = [
    [-HALF_BP, -HALF_BP],
    [+HALF_BP, -HALF_BP],
    [+HALF_BP, +HALF_BP],
    [-HALF_BP, +HALF_BP],
  ]
  for (const [px, py] of positions) {
    const hole = new THREE.Path()
    hole.absellipse(px, py, r, r, 0, 2 * Math.PI, false)
    shape.holes.push(hole)
  }

  // Központi Ø40 átmenő furat a hub clearance-éhez (motor tengelyén).
  const centerHole = new THREE.Path()
  centerHole.absellipse(0, 0, CENTER_HOLE_DIAM / 2, CENTER_HOLE_DIAM / 2, 0, 2 * Math.PI, false)
  shape.holes.push(centerHole)

  return shape
}

/** Base wall ExtrudeGeometry: a XY profilt MATERIAL_T mélyen Z mentén extrudálja.
 *  A base wall back face = builder Z = -TOTAL_Z/2 = -45.
 *  A base wall front face = builder Z = -TOTAL_Z/2 + MATERIAL_T = -35. */
function buildBaseWallGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildBaseWallShape(), {
    depth: MATERIAL_T,
    bevelEnabled: false,
    curveSegments: 12,
  })
  // ExtrudeGeometry default: Z = 0..+MATERIAL_T. Eltoljuk Z = -TOTAL_Z/2 .. -TOTAL_Z/2 + MATERIAL_T közé.
  geom.translate(0, 0, -TOTAL_Z / 2)
  return geom
}

// ---- LOD belépési pontok ----

/**
 * Realisztikus: CSAK a base wall (motor flange-csatlakozó alap). A két szár-lap
 * (felső + alsó) eltávolítva a felhasználói kérésre.
 */
export function XGearBracketRealistic({ componentId }: PartBuilderProps) {
  const aluMat = useAluminumMaterial()
  const baseWallGeom = useMemo(() => buildBaseWallGeometry(), [])
  useEffect(() => () => baseWallGeom.dispose(), [baseWallGeom])

  return (
    <group userData={{ componentId }}>
      {/* Base wall: 56.4 × 76.4 × 10 mm, 4 db Ø5.1 + központi Ø40 furat. */}
      <mesh
        material={aluMat}
        geometry={baseWallGeom}
        userData={{ componentId }}
      />
    </group>
  )
}

/** Medium: ugyanaz, mint a realistic — egyetlen base wall mesh. */
export function XGearBracketMedium(props: PartBuilderProps) {
  return <XGearBracketRealistic {...props} />
}

/** Sematikus: egyetlen box (base wall) furat nélkül. A renderer felülírja a színt. */
export function XGearBracketSchematic({ componentId }: PartBuilderProps) {
  return (
    <group userData={{ componentId }}>
      <mesh position={[0, 0, -TOTAL_Z / 2 + MATERIAL_T / 2]} userData={{ componentId }}>
        <boxGeometry args={[WIDTH_X, OUTER_HEIGHT_Y, MATERIAL_T]} />
        <meshStandardMaterial color="#888" />
      </mesh>
    </group>
  )
}

export const X_GEAR_BRACKET_DIMENSIONS = {
  materialThickness: MATERIAL_T,
  widthX: WIDTH_X,
  innerHeightY: INNER_HEIGHT_Y,
  outerHeightY: OUTER_HEIGHT_Y,
  /** Szár-lap szélessége (X) = `vertical-bracket-1` (#2) szélessége. */
  armPlateWidthX: PLATE_ARM_WIDTH_X,
  /** Szár-lap axiális hossza (Z): base wall elejétől a befoglaló +Z végéig (≈#2 irányában max. előnyúlás). */
  armAxialLength: ARM_AXIAL_LENGTH,
  /** Szár-lap Z-középpontja bracket-lokálisan. */
  armCenterZ: ARM_CENTER_Z,
  /** Base wall elülső sík Z-je (szár-lapok innen indulnak +Z felé). */
  armZStart: ARM_Z_START,
  totalLengthZ: TOTAL_Z,
  boltPattern: NEMA23_BOLT_PATTERN,
  boltHoleDiam: BOLT_HOLE_DIAM,
  /** Központi (Ø40) átmenő furat a base wall-on a hub clearance-hez. */
  centerHoleDiam: CENTER_HOLE_DIAM,
  /** A base wall back face builder-lokális Z koordinátája. */
  baseWallBackZ: -TOTAL_Z / 2,
  /** A base wall front face builder-lokális Z koordinátája. */
  baseWallFrontZ: -TOTAL_Z / 2 + MATERIAL_T,
  /** Ø8 tengely **referencia** Z (regiszter — a szár-lapokon nincs furat). */
  shaftHoleDiam: SHAFT_HOLE_DIAM,
  /** 1. tengely referencia Z (#6 / #8 / #18). */
  shaftHoleZ: SHAFT_HOLE_Z,
  /** 2. tengely referencia Z (#19 / #20), +40 mm az 1.-hez képest bracket-lokális +Z-ben. */
  shaftHoleZ2: SHAFT_HOLE_Z_2,
  /** A 2 arm Y-irányú LEFELÉ tolása a szimmetrikus pozícióhoz képest (negatív
   *  szám = lefelé). A registry-ben a #6 fogaskerék és #18 tengely position.Y-t
   *  ugyanennyivel kell csúsztatni, hogy együtt mozogjanak az arm-okkal. */
  armYOffset: ARM_Y_OFFSET,
}

// ---------------------------------------------------------------------------
// Anchor-export — builder-lokális frame: origó = bbox geometriai közép, +Z =
// motor shaft iránya (U szárai +Z felé nyúlnak).
// ---------------------------------------------------------------------------
const _ARM_CENTER_Y = OUTER_HEIGHT_Y / 2 - MATERIAL_T / 2

export const X_GEAR_BRACKET_ANCHORS: Record<string, Anchor> = {
  origin: {
    position: [0, 0, 0],
    axis: [0, 0, 1],
    description: 'A bbox geometriai közepe; +Z = motor shaft iránya',
  },
  'base-wall-back': {
    position: [0, 0, -TOTAL_Z / 2],
    axis: [0, 0, -1],
    description:
      'A base wall HÁTSÓ síkja (motor felöli oldal). Itt érintkezik a NEMA 23 motor flange front face-ével.',
  },
  'base-wall-front': {
    position: [0, 0, ARM_Z_START],
    axis: [0, 0, 1],
    description: 'A base wall ELÜLSŐ síkja (a U-cavity oldal).',
  },
  'upper-arm-inside': {
    position: [0, _ARM_CENTER_Y + ARM_Y_OFFSET - MATERIAL_T / 2, ARM_CENTER_Z],
    axis: [0, -1, 0],
    description: 'A felső szár-lap BELSŐ (U-cavity felöli) oldalának közepe',
  },
  'lower-arm-inside': {
    position: [0, -_ARM_CENTER_Y + ARM_Y_OFFSET + MATERIAL_T / 2, ARM_CENTER_Z],
    axis: [0, 1, 0],
    description: 'Az alsó szár-lap BELSŐ oldalának közepe',
  },
  'shaft-1-upper': {
    position: [0, _ARM_CENTER_Y + ARM_Y_OFFSET, -TOTAL_Z / 2 + MATERIAL_T + 0],
    axis: [0, 1, 0],
    description: '1. tengely-pozíció a felső arm-on (referencia)',
  },
  'shaft-1-lower': {
    position: [0, -_ARM_CENTER_Y + ARM_Y_OFFSET, -TOTAL_Z / 2 + MATERIAL_T + 0],
    axis: [0, -1, 0],
    description: '1. tengely-pozíció az alsó arm-on (referencia)',
  },
}
