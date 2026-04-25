/**
 * SHF20 / SK20 — tengelytámasz blokk (shaft support, álló típus).
 *
 * Általános rögzített tengelyhez (lineáris vezető tengely vagy fix orsó-vég)
 * használt alumínium támaszblokk, függőleges szorító-réssel és felső M5
 * szorítócsavarral. A felhasználó által megadott méretek alapján:
 *
 * MÉRETEK (mm):
 *   - d  = 20    — tengely átmérő (Ø20)
 *   - h  = 30    — tengely-tengely magassága az alap aljától mérve
 *   - A  = 60    — teljes szélesség (X)
 *   - H  = 50    — teljes magasság (Y)
 *   - B  = 30    — teljes vastagság (Z, axiális)
 *   - A1 = 42    — átmenő rögzítő furatok X-távolsága az alapban
 *   - d1 = 8.6   — átmenő rögzítő furat (Ø8.6, M8 clearance)
 *   - M1 = M10×25 — alsó menetes furatok (Ø10 névleges, 25 mm mély);
 *                   a két M10 furat ugyanazon X = ±A1/2 X-pozíción van
 *                   mint a d1 átmenő furatok, és Z = ±10 mm-re a Z-középvonaltól
 *   - SW = M5    — felső szorítócsavar (M5 DIN 912, X-tengely mentén)
 *
 * SZÁRMAZTATOTT GEOMETRIA (a hivatalos rajzon nem szerepel, ésszerű becslés):
 *   - A felső rész trapézoid formájú: az aljánál A=60 wide, a tetején keskenyebb
 *     (A_TOP = A1 - 6 = 36 mm, így a furatok körüli felület megmarad).
 *   - A Ø20 bore függőleges középvonala X=0, magassága Y = h - H/2 = +5
 *     (a blokk geometriai közepétől mérve).
 *   - A tetején függőleges szorító-rés (CLAMP_SLOT_W = 2 mm) a Ø20 bore
 *     tetejétől a blokk tetejéig megy fel, biztosítva a szorítóhatást
 *     az M5 csavar meghúzásakor.
 *   - A felső M5 szorítócsavar X-tengely mentén halad át, Y = bore_top + 4 mm
 *     magasságon, és átszeli a szorító-rést.
 *
 * Builder lokális orientáció:
 *   - +Z = tengely-irány (a Ø20 bore Z mentén megy át)
 *   - +Y = függőleges felfelé
 *   - Origó: a blokk GEOMETRIAI KÖZÉPPONTJA (X=Y=Z=0)
 *       Y kiterjedés: -H/2..+H/2 = -25..+25
 *       Bore tengelye: Y = h - H/2 = +5
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import type { PartBuilderProps } from '../types'

// ---- Felhasználó által megadott méretek ----
const D_BORE = 20
const H_SHAFT = 30 // h — bore-tengely magassága az alap aljától
const A = 60 // teljes szélesség (X)
const H = 50 // teljes magasság (Y)
const B = 30 // teljes vastagság (Z, axiális)
const A1 = 42 // átmenő rögzítő furatok X-távolsága
const D_THRU = 8.6 // d1 — átmenő furat
const D_M10 = 10 // M1 névleges — Ø10
const M10_DEPTH = 25 // M1 — menet mélység
const D_SW = 5 // SW — felső szorítócsavar M5

// ---- Származtatott méretek ----
/** A felső trapéz tetejének szélessége (X). A1 furattáv + 2×3 mm él-margó. */
const A_TOP = A1 - 6 // = 36
/** A blokk Y-középvonalához viszonyított bore-középvonal (Y). */
const Y_BORE_CENTER = H_SHAFT - H / 2 // = +5
/** Bore tetejének Y-koordinátája. */
const Y_BORE_TOP = Y_BORE_CENTER + D_BORE / 2 // = +15
/** A "lábrész" (alsó téglalap, nem trapéz) magassága. A bore alja itt van. */
const Y_BLOCK_BOT = -H / 2 // = -25
const Y_BLOCK_TOP = +H / 2 // = +25
/** A trapéz alja Y-ban: a bore-középvonal alá ~5 mm-rel — itt kezdődik az
 *  összeszűkülés. A bore alsó pontja (Y = -5) a téglalapos alapszakaszban van. */
const Y_BASE_TOP = Y_BORE_CENTER - 5 // = 0
/** Szorító-rés szélessége (X mentén). */
const CLAMP_SLOT_W = 2
/** A felső M5 szorítócsavar furat Y-magassága. */
const Y_SW_HOLE = Y_BORE_TOP + 4 // = +19

// ---- Re-exportált méretek a regiszter számára ----
export const SHAFT_SUPPORT_DIMENSIONS = {
  shaftDiameter: D_BORE,
  shaftHeight: H_SHAFT,
  totalWidth: A,
  totalHeight: H,
  totalThickness: B,
  mountingHolePatternX: A1,
  mountingThroughHoleDiam: D_THRU,
  mountingThreadDiam: D_M10,
  mountingThreadDepth: M10_DEPTH,
  clampScrewDiam: D_SW,
}

// ---- Material hookok ----

function useAluminiumMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#9aa0a6',
        metalness: 0.6,
        roughness: 0.45,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

// ---- Geometria builder-ek ----

/**
 * A blokk fő profilja az X-Y síkban (front-nézet), Z mentén B = 30 mm-re extrudálva.
 *
 * Kontúr (CCW):
 *   - alul A = 60 wide (Y = -H/2 .. Y_BASE_TOP = 0)
 *   - felette trapéz: A → A_TOP a tetejéig (Y = Y_BASE_TOP .. +H/2)
 *
 * Lyukak:
 *   - 1 db Ø20 bore a (0, Y_BORE_CENTER) ponton
 *   - 1 db függőleges CLAMP_SLOT_W széles rés a bore tetejétől (Y_BORE_TOP)
 *     a blokk tetejéig (Y_BLOCK_TOP) — a csavar szorítóhatásához
 */
function buildMainShape(): THREE.Shape {
  const halfA = A / 2
  const halfATop = A_TOP / 2
  const halfSlot = CLAMP_SLOT_W / 2
  const r = D_BORE / 2

  const shape = new THREE.Shape()
  shape.moveTo(-halfA, Y_BLOCK_BOT)
  shape.lineTo(+halfA, Y_BLOCK_BOT)
  shape.lineTo(+halfA, Y_BASE_TOP)
  shape.lineTo(+halfATop, Y_BLOCK_TOP)
  shape.lineTo(-halfATop, Y_BLOCK_TOP)
  shape.lineTo(-halfA, Y_BASE_TOP)
  shape.closePath()

  // Ø20 bore — TELJES kör, a kontúron belül
  const bore = new THREE.Path()
  bore.absellipse(0, Y_BORE_CENTER, r, r, 0, 2 * Math.PI, false)
  shape.holes.push(bore)

  // Függőleges szorító-rés — a bore tetejétől a blokk tetejéig
  const slot = new THREE.Path()
  slot.moveTo(-halfSlot, Y_BORE_TOP)
  slot.lineTo(+halfSlot, Y_BORE_TOP)
  slot.lineTo(+halfSlot, Y_BLOCK_TOP)
  slot.lineTo(-halfSlot, Y_BLOCK_TOP)
  slot.closePath()
  shape.holes.push(slot)

  return shape
}

function buildMainGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildMainShape(), {
    depth: B,
    bevelEnabled: false,
    curveSegments: 36,
  })
  // Centráljuk Z mentén: extrude alapból Z = 0..+B → Z = -B/2..+B/2.
  geom.translate(0, 0, -B / 2)
  return geom
}

/** Y irányú, függőleges furatkivágó henger. */
function buildVerticalHoleCutter(diam: number, length: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(diam / 2, diam / 2, length, 16)
}

/** X irányú furatkivágó henger a felső M5 szorítócsavarhoz. */
function buildClampScrewCutter(): THREE.CylinderGeometry {
  // X-tengely mentén áll → Y-tengely irányú alapcylinderből rotateZ(±π/2).
  const geom = new THREE.CylinderGeometry(D_SW / 2, D_SW / 2, A + 0.2, 12)
  geom.rotateZ(Math.PI / 2)
  return geom
}

function subtractCutter(
  base: Brush,
  cutterGeometry: THREE.BufferGeometry,
  position: [number, number, number],
  evaluator: Evaluator,
): Brush {
  const cutter = new Brush(cutterGeometry)
  cutter.position.set(...position)
  cutter.updateMatrixWorld()
  return evaluator.evaluate(base, cutter, SUBTRACTION)
}

/** Főtest ténylegesen kivágott, Y irányú rögzítőfuratokkal. */
function buildRealisticGeometry(): THREE.BufferGeometry {
  const evaluator = new Evaluator()
  const halfA1 = A1 / 2

  let result = new Brush(buildMainGeometry())
  result.updateMatrixWorld()

  const thruCutter = buildVerticalHoleCutter(D_THRU, H + 0.2)
  for (const x of [-halfA1, +halfA1]) {
    result = subtractCutter(result, thruCutter, [x, 0, 0], evaluator)
    result.updateMatrixWorld()
  }
  thruCutter.dispose()

  const swCutter = buildClampScrewCutter()
  result = subtractCutter(result, swCutter, [0, Y_SW_HOLE, 0], evaluator)
  swCutter.dispose()

  const geom = result.geometry
  geom.computeVertexNormals()
  return geom
}

// ---- LOD belépési pontok ----

/**
 * Realisztikus: trapéz blokk Ø20 bore-ral, függőleges szorító-réssel, ténylegesen
 * kivágott függőleges rögzítőfuratokkal és kivágott felső M5 szorítófurattal.
 */
export function ShaftSupportRealistic({ componentId }: PartBuilderProps) {
  const aluMat = useAluminiumMaterial()
  const mainGeom = useMemo(() => buildRealisticGeometry(), [])
  useEffect(() => () => mainGeom.dispose(), [mainGeom])

  return (
    <group userData={{ componentId }}>
      {/* Fő blokk + bore + slot + tényleges rögzítőfurat-kivágások */}
      <mesh material={aluMat} geometry={mainGeom} userData={{ componentId }} />
    </group>
  )
}

/**
 * Medium: trapéz blokk Ø20 bore-ral és szorító-réssel — furat-marker-ek nélkül.
 */
export function ShaftSupportMedium({ componentId }: PartBuilderProps) {
  const aluMat = useAluminiumMaterial()
  const mainGeom = useMemo(() => buildMainGeometry(), [])
  useEffect(() => () => mainGeom.dispose(), [mainGeom])

  return (
    <group userData={{ componentId }}>
      <mesh material={aluMat} geometry={mainGeom} userData={{ componentId }} />
    </group>
  )
}

/**
 * Sematikus: tömör doboz a teljes A × H × B bbox-szal (a renderer override-olja
 * a színt a regiszter szerint). Furatok / trapéz / slot nélkül.
 */
export function ShaftSupportSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[A, H, B]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
