/**
 * Gear konzol — U-alakú alumínium tartó a NEMA 23 (X-tengely) motor flange előlapja
 * előtt rögzítve, hogy a motor tengelyén ülő pinion fogaskerék (és majd a hozzá
 * kapcsolódó követő fogaskerék) számára merev befogadó-keretet adjon.
 *
 * GEOMETRIA (felhasználó-specifikált méretek):
 *   - Anyag: alumínium, 10 mm vastagság (mind a base wall, mind a 2 arm vastagsága)
 *   - Szélesség (X): a NEMA 23 motor body szélességével azonos = 56.4 mm
 *   - Belső gap a 2 arm KÖZÖTT (Y): a motor magasságával azonos = 56.4 mm
 *     (vagyis a motor pont elférne a U belsejében, ha középre helyeznénk)
 *   - Külső magasság (Y): motor magasság + 2 × anyagvastagság = 56.4 + 20 = 76.4 mm
 *     (két oldalt 10-10 mm-rel "növelve" a motor magasságához képest)
 *   - U szárak hossza (Z): 80 mm — a base wall-tól előrefelé (+Z) nyúlnak ki
 *   - Base wall vastagság (Z): 10 mm — a U "alja", ami a motorhoz csatlakozik
 *   - Teljes Z kiterjedés (base + arm): 10 + 80 = 90 mm
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
 *   - Origó: a bounding box GEOMETRIAI KÖZÉPPONTJA (X=Y=Z=0).
 *     - X range: -W/2 .. +W/2          = -28.2 .. +28.2
 *     - Y range: -OUTER_H/2 .. +OUTER_H/2 = -38.2 .. +38.2
 *     - Z range: -TOTAL_L/2 .. +TOTAL_L/2 = -45 .. +45
 *     - Base wall Z range: -45 .. -35   (a U "alja", -Z oldalon)
 *     - Felső arm: Y = +28.2 .. +38.2,  Z = -35 .. +45 (80 mm hosszú)
 *     - Alsó arm:  Y = -38.2 .. -28.2,  Z = -35 .. +45
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
import type { PartBuilderProps } from '../types'
import { NEMA23_BODY_SIZE, NEMA23_BOLT_PATTERN } from './_motorSilhouette'

// ---- Méretek ----
const MATERIAL_T = 10
const WIDTH_X = NEMA23_BODY_SIZE // = 56.4 — bracket szélessége = motor body szélessége
const INNER_HEIGHT_Y = NEMA23_BODY_SIZE // = 56.4 — belső gap a 2 arm között = motor magassága
const OUTER_HEIGHT_Y = INNER_HEIGHT_Y + 2 * MATERIAL_T // = 76.4
const ARM_LENGTH = 80
const TOTAL_Z = MATERIAL_T + ARM_LENGTH // = 90

// ---- Furat-pattern (a motor flange-szel egyező 47.14 négyzet) ----
const BOLT_HOLE_DIAM = 5.1
const HALF_BP = NEMA23_BOLT_PATTERN / 2 // = 23.57

/** KÖZPONTI clearance furat a base wall-on a `bevel-gear-driver-1` (és a régi
 *  `pinion-gear-1`) hub-jának ÁTMENETÉHEZ. Ø40 (r=20) — a motor pilot boss
 *  (Ø38.1) körül elférne, a bevel hub Ø24 OD pedig nagy radiális clearance-szel
 *  átfér. A furat középpontja a base wall (és a motor) tengelyén van. */
const CENTER_HOLE_DIAM = 40

/** Ø8 átmenő furat-pár MINDKÉT arm-on (felső + alsó):
 *  - 1. furat (Z = SHAFT_HOLE_Z = -12.76): a `pinion-gear-1` (#6) ↔
 *    `bevel-gear-driven-1` (#8) közös függőleges acéltengelye (#18) halad át.
 *  - 2. furat (X = SHAFT_HOLE_X_2 = -6, Z = SHAFT_HOLE_Z_2 = +27.24): az 1.-től
 *    +40 mm bracket-lokális +Z-ben (world +X), és -6 mm bracket-lokális -X-ben;
 *    a `pinion-gear-2` (#19) és `shaft-pinion-bevel-2` (#20) itt illeszkedik. */
const SHAFT_HOLE_DIAM = 8
/** Az 1. tengely-furat Z-pozíciója bracket-lokálisan = a #8 (driven bevel) axisa
 *  = pitch cone apex Z. Lásd a `bevel-gear-driven-1` MESHING SZÁMÍTÁSA blokkot
 *  a componentRegistry-ben. */
const SHAFT_HOLE_Z = -12.76
/** A 2. tengely-furat Z-pozíciója bracket-lokálisan = SHAFT_HOLE_Z + 40
 *  (a felhasználó által megadott +40 mm world-X = +40 mm bracket-lokális +Z).
 *  A `pinion-gear-2` (#19) és `shaft-pinion-bevel-2` (#20) másolt elemek
 *  ezen a furaton illeszkednek. */
const SHAFT_HOLE_Z_2 = SHAFT_HOLE_Z + 40 // = +27.24
/** A 2. tengely-furat bracket-lokális X-pozíciója (#19 / #20 finomhangolás). */
const SHAFT_HOLE_X_2 = -6

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

/**
 * Arm 2D shape (X-Z síkban, "felülnézet"): WIDTH × ARM_LENGTH téglalap egyetlen
 * Ø8 átmenő furattal a (0, SHAFT_HOLE_Z) pontban. A profil az Y irányba lesz
 * extrudálva, így a furat Y mentén megy át — pontosan a függőleges közös
 * tengelyen, amelyen a `pinion-gear-1` ↔ `bevel-gear-driven-1` acéltengelye
 * halad át.
 *
 * Profil X-Z koordinátái:
 *   X: -WIDTH/2 .. +WIDTH/2 (= -28.2 .. +28.2)
 *   Z: a felső/alsó arm Z-középponthoz képest -ARM_LENGTH/2 .. +ARM_LENGTH/2
 *      (= -40 .. +40), de az arm world-Z közepe = +5, így a furat Z-koordinátája
 *      a profilban: SHAFT_HOLE_Z - armCenterZ = -12.76 - 5 = -17.76.
 */
function buildArmShape(armCenterZ: number): THREE.Shape {
  const halfW = WIDTH_X / 2
  const halfL = ARM_LENGTH / 2
  const r = SHAFT_HOLE_DIAM / 2

  const shape = new THREE.Shape()
  shape.moveTo(-halfW, -halfL)
  shape.lineTo(+halfW, -halfL)
  shape.lineTo(+halfW, +halfL)
  shape.lineTo(-halfW, +halfL)
  shape.closePath()

  // 1. Ø8 átmenő furat a tengelyen: bracket-lokális Z = SHAFT_HOLE_Z, az arm-profil
  // saját Z-tengelye az armCenterZ-hez van eltolva.
  const hole1 = new THREE.Path()
  hole1.absellipse(0, SHAFT_HOLE_Z - armCenterZ, r, r, 0, 2 * Math.PI, false)
  shape.holes.push(hole1)

  // 2. Ø8 átmenő furat: bracket-lokális Z = SHAFT_HOLE_Z_2, vagyis +40 mm
  // world-X irányban az 1. furatto1l. A másolt #19 (pinion) és #20 (tengely)
  // ezen illeszkedik.
  const hole2 = new THREE.Path()
  hole2.absellipse(0, SHAFT_HOLE_Z_2 - armCenterZ, r, r, 0, 2 * Math.PI, false)
  shape.holes.push(hole2)

  return shape
}

/**
 * Arm ExtrudeGeometry: a XZ profilt MATERIAL_T mélyen Y mentén extrudálja.
 * Az ExtrudeGeometry default extrudálási iránya +Z, ezért rotateX(-π/2)-vel
 * forgatjuk: a profil X-Y_shape síkból X-Z síkba, az extrude irány +Z → +Y.
 * Ezután Y mentén centráljuk az armCenterY-hoz a hívó.
 */
function buildArmGeometry(armCenterZ: number): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildArmShape(armCenterZ), {
    depth: MATERIAL_T,
    bevelEnabled: false,
    curveSegments: 24,
  })
  // A shape eredetileg X-Y_shape síkban van, +Z-be extrudálva. rotateX(-π/2):
  // Y_shape → -Z (a téglalap "hossza" Z mentén), extrude +Z → +Y. Most a profil
  // X-Z síkban van, vastagsága Y mentén MATERIAL_T magas.
  geom.rotateX(-Math.PI / 2)
  // Az átfordítás után az Y range: -MATERIAL_T..0. Eltoljuk -MATERIAL_T/2-re,
  // hogy az arm Y közepe = 0 legyen (a hívó az armCenterY-ra translálja).
  geom.translate(0, MATERIAL_T / 2, 0)
  // Z eltolás 0 marad — a hívó a position-ben adja meg az armCenterZ-t (+5).
  // Mivel a furat a profil Z = SHAFT_HOLE_Z - armCenterZ pontján van, a végső
  // bracket-lokális furat-Z = position.z + (SHAFT_HOLE_Z - armCenterZ)
  //                        = armCenterZ + (SHAFT_HOLE_Z - armCenterZ)
  //                        = SHAFT_HOLE_Z ✓
  return geom
}

// ---- LOD belépési pontok ----

/**
 * Realisztikus: base wall (4 furat) + 2 arm (felső + alsó). Mindhárom alkatrész
 * 10 mm vastag alumínium, ugyanazzal a material-lal. A 3 mesh együtt formálja a U-t.
 */
export function GearBracketRealistic({ componentId }: PartBuilderProps) {
  const aluMat = useAluminumMaterial()
  const baseWallGeom = useMemo(() => buildBaseWallGeometry(), [])

  // Az arm Z-középpont a base wall front face-éhez (Z = -TOTAL_Z/2 + MATERIAL_T = -35)
  // és a teljes U Z-vége (+TOTAL_Z/2 = +45) között van: center = (-35 + 45)/2 = +5.
  const armCenterZ = (-TOTAL_Z / 2 + MATERIAL_T + TOTAL_Z / 2) / 2 // = +5
  // Felső arm Y-közép: outer Y/2 - T/2 + ARM_Y_OFFSET; alsó arm: -(outer Y/2 - T/2) + ARM_Y_OFFSET.
  // Az ARM_Y_OFFSET aszimmetrikusan tolja le mindkét arm-ot ugyanannyival (=-10),
  // így a 2 arm közti gap változatlan marad, csak az egész "U-zsák" lejjebb kerül.
  const armCenterY = OUTER_HEIGHT_Y / 2 - MATERIAL_T / 2 // = +33.2 (szimmetrikus referencia)
  const upperArmY = +armCenterY + ARM_Y_OFFSET // = +23.2
  const lowerArmY = -armCenterY + ARM_Y_OFFSET // = -43.2

  // Arm geometria furattal — mindkét arm-on 2 db Ø8: (0, SHAFT_HOLE_Z) és
  // (SHAFT_HOLE_X_2, SHAFT_HOLE_Z_2).
  const armGeom = useMemo(() => buildArmGeometry(armCenterZ), [armCenterZ])
  useEffect(() => {
    return () => {
      baseWallGeom.dispose()
      armGeom.dispose()
    }
  }, [baseWallGeom, armGeom])

  return (
    <group userData={{ componentId }}>
      {/* Base wall — 56.4 × 76.4 × 10 mm, 4 db Ø5.1 furattal a 47.14 pattern-en. */}
      <mesh
        material={aluMat}
        geometry={baseWallGeom}
        userData={{ componentId }}
      />

      {/* Felső arm — 56.4 (X) × 10 (Y) × 80 (Z) mm + Ø8 átmenő furat a tengelyen. */}
      <mesh
        position={[0, upperArmY, armCenterZ]}
        material={aluMat}
        geometry={armGeom}
        userData={{ componentId }}
      />

      {/* Alsó arm — szimmetrikus a felső-vel (Y → -Y), azonos furattal. */}
      <mesh
        position={[0, lowerArmY, armCenterZ]}
        material={aluMat}
        geometry={armGeom}
        userData={{ componentId }}
      />
    </group>
  )
}

/** Medium: ugyanaz, mint a realistic — a U már egyszerű box-ok együttese, így itt nincs lényeges különbség. */
export function GearBracketMedium(props: PartBuilderProps) {
  return <GearBracketRealistic {...props} />
}

/** Sematikus: 3 box (base + 2 arm) furat nélkül, hogy a befoglaló méretek
 *  jól látszódjanak. A renderer override-olja a regiszter színre. */
export function GearBracketSchematic({ componentId }: PartBuilderProps) {
  const armCenterZ = (-TOTAL_Z / 2 + MATERIAL_T + TOTAL_Z / 2) / 2
  const armCenterY = OUTER_HEIGHT_Y / 2 - MATERIAL_T / 2
  const upperArmY = +armCenterY + ARM_Y_OFFSET
  const lowerArmY = -armCenterY + ARM_Y_OFFSET

  return (
    <group userData={{ componentId }}>
      <mesh position={[0, 0, -TOTAL_Z / 2 + MATERIAL_T / 2]} userData={{ componentId }}>
        <boxGeometry args={[WIDTH_X, OUTER_HEIGHT_Y, MATERIAL_T]} />
        <meshStandardMaterial color="#888" />
      </mesh>
      <mesh position={[0, upperArmY, armCenterZ]} userData={{ componentId }}>
        <boxGeometry args={[WIDTH_X, MATERIAL_T, ARM_LENGTH]} />
        <meshStandardMaterial color="#888" />
      </mesh>
      <mesh position={[0, lowerArmY, armCenterZ]} userData={{ componentId }}>
        <boxGeometry args={[WIDTH_X, MATERIAL_T, ARM_LENGTH]} />
        <meshStandardMaterial color="#888" />
      </mesh>
    </group>
  )
}

export const GEAR_BRACKET_DIMENSIONS = {
  materialThickness: MATERIAL_T,
  widthX: WIDTH_X,
  innerHeightY: INNER_HEIGHT_Y,
  outerHeightY: OUTER_HEIGHT_Y,
  armLength: ARM_LENGTH,
  totalLengthZ: TOTAL_Z,
  boltPattern: NEMA23_BOLT_PATTERN,
  boltHoleDiam: BOLT_HOLE_DIAM,
  /** Központi (Ø40) átmenő furat a base wall-on a hub clearance-hez. */
  centerHoleDiam: CENTER_HOLE_DIAM,
  /** A base wall back face builder-lokális Z koordinátája. */
  baseWallBackZ: -TOTAL_Z / 2,
  /** A base wall front face builder-lokális Z koordinátája. */
  baseWallFrontZ: -TOTAL_Z / 2 + MATERIAL_T,
  /** Mindkét arm-on átmenő Ø8 furat a `pinion-gear-1` ↔ `bevel-gear-driven-1`
   *  közös acéltengelyéhez. */
  shaftHoleDiam: SHAFT_HOLE_DIAM,
  /** Az 1. tengely-furat bracket-lokális Z-pozíciója (#18 tengely). */
  shaftHoleZ: SHAFT_HOLE_Z,
  /** A 2. tengely-furat bracket-lokális Z-pozíciója (#20 másolt tengely),
   *  +40 mm world-X-ben az 1.-től. */
  shaftHoleZ2: SHAFT_HOLE_Z_2,
  /** A 2. tengely-furat bracket-lokális X-pozíciója (#19 / #20). */
  shaftHoleX2: SHAFT_HOLE_X_2,
  /** A 2 arm Y-irányú LEFELÉ tolása a szimmetrikus pozícióhoz képest (negatív
   *  szám = lefelé). A registry-ben a #6 fogaskerék és #18 tengely position.Y-t
   *  ugyanennyivel kell csúsztatni, hogy együtt mozogjanak az arm-okkal. */
  armYOffset: ARM_Y_OFFSET,
}
