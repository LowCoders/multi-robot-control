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
const SW_THREAD_DEPTH = 12 // M5 menet mélység az egyik oldalon (becslés)

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
export const SHAFT_SUPPORT_SHF20_DIMENSIONS = {
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

function useDarkSteelMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1f1f22',
        metalness: 0.7,
        roughness: 0.55,
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

/**
 * A 2 db Ø8.6 átmenő furat geometriája (cosmetic — csak vizuálisan jelzi
 * alulról nézve a furatot). A furatok Y mentén mennek át, X = ±A1/2,
 * Z = 0 a blokk Z-középvonalán.
 *
 * NOTE: Mivel a fő profilt X-Y síkban extrudáltuk Z mentén, az Y-irányú
 * furatokat CSG-vel tudnánk csak a fő geometriából kivenni — egyszerűbb és
 * OLCSÓBB egy kis sötét hengert tenni a furat helyére, ami "lyuknak látszik"
 * alulról nézve. A Realistic LOD-ban használjuk csak.
 */
function buildMountingHoleMarker(diam: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(diam / 2, diam / 2, H + 0.2, 16)
}

/**
 * A felső M5 szorítócsavar furat marker (X mentén megy át, a blokk teljes
 * X-szélességén — a slot mindkét oldalán). Realistic LOD only.
 */
function buildClampScrewMarker(): THREE.CylinderGeometry {
  // X-tengely mentén áll → Y-tengely irányú alapcylinderből rotateZ(±π/2).
  const geom = new THREE.CylinderGeometry(D_SW / 2, D_SW / 2, A + 0.2, 12)
  geom.rotateZ(Math.PI / 2)
  return geom
}

// ---- LOD belépési pontok ----

/**
 * Realisztikus: trapéz blokk Ø20 bore-ral, függőleges szorító-réssel, 2 db
 * átmenő furat-marker (Ø8.6 alulról), és a felső M5 szorítócsavar furat-marker.
 */
export function ShaftSupportSHF20Realistic({ componentId }: PartBuilderProps) {
  const aluMat = useAluminiumMaterial()
  const darkMat = useDarkSteelMaterial()
  const mainGeom = useMemo(() => buildMainGeometry(), [])
  const thruHoleGeom = useMemo(() => buildMountingHoleMarker(D_THRU), [])
  const m10HoleGeom = useMemo(() => buildMountingHoleMarker(D_M10), [])
  const swHoleGeom = useMemo(() => buildClampScrewMarker(), [])
  useEffect(() => {
    return () => {
      mainGeom.dispose()
      thruHoleGeom.dispose()
      m10HoleGeom.dispose()
      swHoleGeom.dispose()
    }
  }, [mainGeom, thruHoleGeom, m10HoleGeom, swHoleGeom])

  const halfA1 = A1 / 2
  // Az M10 menetes furatok ugyanazon X-en, de Z = +10 (a Z-középvonaltól
  // hátra, ahol a kép szerint a "Rögzítés menettel" jelzés mutat).
  const Z_M10 = 10

  return (
    <group userData={{ componentId }}>
      {/* Fő blokk + bore + slot */}
      <mesh material={aluMat} geometry={mainGeom} userData={{ componentId }} />

      {/* 2 db Ø8.6 átmenő furat (Y irányú marker) — átszelik a blokkot */}
      {[-halfA1, +halfA1].map((x) => (
        <mesh
          key={`thru-${x}`}
          position={[x, 0, 0]}
          geometry={thruHoleGeom}
          material={darkMat}
          userData={{ componentId }}
        />
      ))}

      {/* 2 db M10 menetes furat-marker (cosmetic — alulról "lyuknak látszik") */}
      {[-halfA1, +halfA1].map((x) => (
        <mesh
          key={`m10-${x}`}
          position={[x, Y_BLOCK_BOT + M10_DEPTH / 2, Z_M10]}
          userData={{ componentId }}
        >
          <cylinderGeometry args={[D_M10 / 2, D_M10 / 2, M10_DEPTH, 16]} />
          <meshStandardMaterial color="#1f1f22" metalness={0.7} roughness={0.55} />
        </mesh>
      ))}

      {/* Felső M5 szorítócsavar — X mentén átmenő furat-marker */}
      <mesh
        position={[0, Y_SW_HOLE, 0]}
        geometry={swHoleGeom}
        material={darkMat}
        userData={{ componentId }}
      />

      {/* Az M5 csavar feje (egyszerűsített, a +X oldalon) */}
      <mesh
        position={[A / 2 - 0.5, Y_SW_HOLE, 0]}
        rotation={[0, 0, Math.PI / 2]}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[D_SW * 0.85, D_SW * 0.85, 3, 12]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.85} roughness={0.4} />
      </mesh>

      {/* Suppress unused-var warning a SW_THREAD_DEPTH-re — a Realistic-ban
          nem modellezzük külön a menet mélységét, de exportálva tartjuk a
          jövőbeli iterációkhoz. */}
      <mesh visible={false} userData={{ componentId, swThreadDepth: SW_THREAD_DEPTH }} />
    </group>
  )
}

/**
 * Medium: trapéz blokk Ø20 bore-ral és szorító-réssel — furat-marker-ek nélkül.
 */
export function ShaftSupportSHF20Medium({ componentId }: PartBuilderProps) {
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
export function ShaftSupportSHF20Schematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[A, H, B]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
