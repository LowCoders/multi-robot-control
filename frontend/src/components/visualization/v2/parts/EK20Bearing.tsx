/**
 * EK20-C5 — golyósorsó támasztó csapágytartó (FIXED side, Y-tengely).
 *
 * HIWIN **EK20-C5** (cikkszám: 18-000432) — golyósorsó FIXED (rögzített) oldali
 * tartóblokk Ø20 mm tengelyhez, szögbeállású csapágy-pár (7204B P0) belül.
 * Locknut típus: RN20, M4 hozzáférési csavarral.
 *
 * MÉRETEK (a HIWIN EK20-C5 hivatalos datasheet szerint, mind mm-ben):
 *   - d  = 20    — orsó / belső furat átmérő (Ø20 G6)
 *   - L  = 42    — blokk axiális hossz (Z)
 *   - L1 = 10    — assembly variant A
 *   - L2 = 50    — assembly variant B
 *   - L3 = 10
 *   - B  = 95    — teljes szélesség (X)
 *   - H  = 58    — teljes magasság (Y)
 *   - b  = 47.5  — KÖZPONTI rögzítő furatok közötti X-távolság (counterbore from top)
 *   - B1 = 56    — pedestal szélessége (X)
 *   - H1 = 25    — bore-tengely magassága az alaplemez aljától (mounting surface)
 *   - P  = 75    — WING rögzítő furatok közötti X-távolság (plain through, alaplemez fülein)
 *   - M  = M4    — locknut hozzáférési csavar
 *   - X  = 11, T = 30 — egyéb belső dimenziók (M-csavar pozíció / mélység,
 *                       jelenleg NEM modellezve)
 *
 * ÉSSZERŰ BECSÜLT méretek (a hivatalos táblázatban nincsenek explicit megadva):
 *   - d1 ≈ 6.6 — átmenő furat (M6 clearance, a wing-csavarokhoz)
 *
 * Az "alap" (foot, B = 95 wide szakasz) magassága a HIWIN datasheet szerint
 * H_FOOT = H1 = 25 mm — a bore tengelye pontosan a foot teteje magasságában van.
 *
 * FELÉPÍTÉS — 4 db ExtrudeGeometry úgy szervezve, hogy mind a wing-furatok (Y-axis,
 * a foot-on átmenő), mind a Ø20 bore (Z-axis, a pedestal-on átmenő) természetesen
 * megrajzolhatók legyenek CSG nélkül:
 *
 *   1. **Lower Foot** (B × H_LOWER_FOOT × L = 95 × 15 × 42), X-Z profil Y mentén
 *      extrudálva. Y range: -29 .. -14 (a bore aljánál végződik, ezzel teret hagyva
 *      a pedestal X-Y profiljának a bore-hoz).
 *      **2 db Ø6.6 átmenő furat** a wing-csavarokhoz (X = ±P/2 = ±37.5, Z = 0).
 *
 *   2. **Upper Foot LEFT** (a foot bal oldalsó "füle" a pedestal mellett):
 *      X = -B/2 .. -B1/2 = -47.5 .. -28 (= 19.5 mm széles), Y range: -15 .. -4
 *      (= 11 mm magas, 1 mm overlap a Lower Foot-tal a tangencia elkerülésére),
 *      Z = -L/2 .. +L/2. X-Z profil Y mentén extrudálva.
 *      **1 db Ø6.6 átmenő furat** a bal wing-csavarhoz (X = -P/2 = -37.5, Z = 0).
 *      A felső Y határ (Y = -4) megegyezik a pedestal aljával (folytonos sziluett).
 *
 *   3. **Upper Foot RIGHT** — az Upper Foot LEFT tükörképe (X = +28 .. +47.5),
 *      a jobb wing-csavarhoz tartozó **1 db Ø6.6 átmenő furattal**.
 *
 *   4. **Pedestal** (X = -B1/2 .. +B1/2 = -28 .. +28, Y = -15 .. +29 = 44 mm magas),
 *      X-Y profil Z = L = 42 mm-en extrudálva. **1 db Ø20 bore** a (X=0, Y=-4)
 *      ponton — Y range -14 .. +6, mind a kontúrjon belül.
 *      A pedestal alja (Y = -15) 1 mm overlap-pal érintkezik az Upper Foot strip-ek
 *      tetejével és a Lower Foot tetejével (Y = -14), kettős biztonságot adva a
 *      tangencia mentes triangulációhoz.
 *
 * A 4 darab együttes globális sziluettje (front view):
 *   - Y = -29 .. -4: B = 95 mm széles (Lower Foot + 2 Upper Foot strip + pedestal alja)
 *   - Y = -4  .. +29: B1 = 56 mm széles (csak pedestal)
 *   — vagyis ugyanaz a "fordított T" sziluett, mint amit a HIWIN datasheet rajza ad.
 *
 * **NINCS** cosmetic counterbore-recesz a pedestal tetején. A 2 KÖZPONTI mounting
 * hole-t (X = ±23.75) sem modellezzük (cikkjelölés szempontból egyszerűsítés).
 *
 * NEM modellezett részletek (későbbi iterációkra):
 *   - Központi M4 locknut hozzáférési furat a pedestal tetején (T = 30 mm mély)
 *   - A belső csapágypár (2 db 7204B P0 angular contact, RN20 locknut, távtartó)
 *   - Élek lekerekítése / chamferek
 *
 * Builder lokális orientáció:
 *   - +Z = orsó-tengely (a bore Z mentén megy át)
 *   - +Y = függőlegesen felfelé (pedestal up, alaplemez lent)
 *   - Origó: a blokk GEOMETRIAI KÖZÉPPONTJA (X=0, Y=0, Z=0):
 *       Y kiterjedés: -H/2 .. +H/2 = -29 .. +29
 *       Bore tengelye: Y = H1 - H/2 = -4 (a foot teteje szintjén)
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Anchor, PartBuilderProps } from '../types'

// ---- Méretek a HIWIN EK20-C5 hivatalos táblázatból ----
const D_BORE = 20
const L = 42
const L1 = 10
const L2 = 50
const L3 = 10
const B = 95
const H = 58
const B_CENTER_PATTERN = 47.5 // b — KÖZPONTI rögzítő furatok X-távolsága (counterbored)
const B1 = 56 // pedestal szélesség
const H1 = 25 // bore-tengely magassága az alaplemez aljától
const P_WING_PATTERN = 75 // P — WING rögzítő furatok X-távolsága (plain through)
const M_OFFSET_X = 11 // X — locknut hozzáférési furat offset (NEM modellezett)
const M_DEPTH_T = 30 // T — locknut hozzáférési furat mélység (NEM modellezett)
// M = M4 — locknut hozzáférési csavar mérete (NEM modellezett)

// ---- Becsült méretek (a hivatalos táblázatban nem szerepelnek) ----
/** Az "alap" (foot) fizikai magassága = H1 (a bore-tengely magassága) = 25 mm. */
const H_FOOT = H1 // = 25
const D_THRU = 6.6 // d1 — átmenő furat (M6 clearance, a wing-csavarokhoz)

// ---- Levezetett Y koordináták (centrált koord-rendszer, Y=0 a blokk geometriai közepe) ----
/** A teljes blokk Y-tartománya: Y_BLOCK_BOT..Y_BLOCK_TOP = -29..+29. */
const Y_BLOCK_BOT = -H / 2 // = -29
const Y_BLOCK_TOP = +H / 2 // = +29
/** A bore tengelye (X=0, Y=Y_BORE_CENTER). Egybeesik a foot teteje szintjével. */
const Y_BORE_CENTER = H1 - H / 2 // = -4
/** A bore alsó pontja (Y_BORE_CENTER - D/2). A Lower Foot teteje pontosan ide ér. */
const Y_BORE_BOT = Y_BORE_CENTER - D_BORE / 2 // = -14
/** Lower Foot teteje (= bore alja). Fizikai magassága Y_LOWER_FOOT_TOP - Y_BLOCK_BOT = 15 mm. */
const Y_LOWER_FOOT_TOP = Y_BORE_BOT // = -14
const H_LOWER_FOOT = Y_LOWER_FOOT_TOP - Y_BLOCK_BOT // = 15

/**
 * 1 mm overlap a Lower Foot teteje és a felette álló elemek (Upper Foot strip-ek
 * + Pedestal) alja között — a tangencia mentes triangulációhoz.
 */
const SAFETY_OVERLAP = 1
const Y_UPPER_FOOT_BOT = Y_LOWER_FOOT_TOP - SAFETY_OVERLAP // = -15
const Y_UPPER_FOOT_TOP = Y_BORE_CENTER // = -4 (= a foot teteje, a pedestal-váll)
const H_UPPER_FOOT = Y_UPPER_FOOT_TOP - Y_UPPER_FOOT_BOT // = 11

/** A pedestal Y-tartománya: a Lower Foot tetejével 1 mm-es overlap-pal kezdődik. */
const Y_PEDESTAL_BOT = Y_UPPER_FOOT_BOT // = -15

/** Pedestal és Upper Foot strip-ek X-határai. */
const X_PEDESTAL_HALF = B1 / 2 // = 28 → pedestal X range -28..+28
const X_FOOT_HALF = B / 2 // = 47.5 → teljes foot X range -47.5..+47.5

/**
 * Re-exportált méretek a komponens regiszter és a layout-számítások számára.
 * NÉV-konvenció: a hivatalos HIWIN datasheet-ből származó értékek `tableD/tableL/...`,
 * a becsült értékek `estimatedH1Foot/...`. Így a felhasználó későbbi iterációknál
 * egyértelműen látja, melyik az a méret, amit a datasheet szerint pontosan tudunk.
 */
export const EK20_BEARING_DIMENSIONS = {
  shaftDiameter: D_BORE,
  blockLengthAxial: L,
  innerL1: L1,
  innerL2: L2,
  innerL3: L3,
  blockWidth: B,
  blockHeight: H,
  centerBoltPatternX: B_CENTER_PATTERN,
  pedestalWidth: B1,
  boreCenterHeight: H1,
  wingBoltPatternX: P_WING_PATTERN,
  locknutAccessOffsetX: M_OFFSET_X,
  locknutAccessDepthT: M_DEPTH_T,
  footThickness: H_FOOT,
  lowerFootPhysicalThickness: H_LOWER_FOOT,
  estimatedThroughHoleDiam: D_THRU,
}

// ---------------------------------------------------------------------------
// Anchorok — a builder belső Y-up frame-ben (lásd a fájl tetején a JSDoc-ot)
// ---------------------------------------------------------------------------
//
// MEGJEGYZÉS: A builder JELENLEG még Y-up natív (+Y = függőleges, +Z = bore-axis).
// A Phase 8 keretében a builder kódot teljesen átírjuk Z-up natívra; addig a
// regiszterben a `transform.rotation`-vel forgatjuk a komponenst Z-up world-be.
// Az anchorok a builder belső frame-ben vannak megadva — a renderer az
// anchor-mate kiszámolásakor ezt a transform-rotation-vel együtt mappolja
// át a parent (és a world) frame-be.
export const EK20_BEARING_ANCHORS: Record<string, Anchor> = {
  origin: {
    position: [0, 0, 0],
    axis: [0, 1, 0],
    description: 'A blokk geometriai középpontja; builder +Y = függőleges',
  },
  'bore-axis-near': {
    position: [0, Y_BORE_CENTER, +L / 2],
    axis: [0, 0, 1],
    description: 'Bore tengely +Z vége (a builder Z-tengelye)',
  },
  'bore-axis-far': {
    position: [0, Y_BORE_CENTER, -L / 2],
    axis: [0, 0, -1],
    description: 'Bore tengely -Z vége',
  },
  'bore-center': {
    position: [0, Y_BORE_CENTER, 0],
    axis: [0, 0, 1],
    description: 'Bore axiális középpontja a blokk közepén',
  },
  'mount-bottom-center': {
    position: [0, Y_BLOCK_BOT, 0],
    axis: [0, -1, 0],
    description: 'A foot alja (mounting surface) középen',
  },
  'pedestal-top-center': {
    position: [0, Y_BLOCK_TOP, 0],
    axis: [0, 1, 0],
    description: 'A pedestal teteje középen (M4 locknut hozzáférés helye)',
  },
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

// ---- Geometria buildek ----

/**
 * Lower Foot 2D shape: X-Z síkban (felülnézet), B × L téglalap a 2 wing
 * through-hole-lal. Csak a Lower Foot Y-extrude-jához használt.
 */
function buildLowerFootShape(): THREE.Shape {
  const halfB = B / 2
  const halfL = L / 2
  const halfBP = P_WING_PATTERN / 2 // = 37.5
  const r = D_THRU / 2

  const shape = new THREE.Shape()
  shape.moveTo(-halfB, -halfL)
  shape.lineTo(+halfB, -halfL)
  shape.lineTo(+halfB, +halfL)
  shape.lineTo(-halfB, +halfL)
  shape.closePath()

  for (const px of [-halfBP, +halfBP]) {
    const hole = new THREE.Path()
    hole.absellipse(px, 0, r, r, 0, 2 * Math.PI, false)
    shape.holes.push(hole)
  }
  return shape
}

function buildLowerFootGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildLowerFootShape(), {
    depth: H_LOWER_FOOT,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geom.rotateX(Math.PI / 2)
  geom.translate(0, Y_BLOCK_BOT + H_LOWER_FOOT, 0)
  return geom
}

/**
 * Upper Foot strip 2D shape: X-Z síkban (felülnézet), egy oldal-csík a foot
 * füléből (a pedestal mellett), 1 wing through-hole-lal. A `side` paraméter
 * választja: 'left' = X = -B/2..-B1/2, 'right' = X = +B1/2..+B/2.
 *
 * A Y-extrude-utáni Y range: Y_UPPER_FOOT_BOT..Y_UPPER_FOOT_TOP = -15..-4
 * (= 11 mm magas, 1 mm overlap a Lower Foot-tal).
 *
 * A wing-furat (Ø D_THRU) így a Lower Foot 15 mm + Upper Foot strip 11 mm = 25 mm
 * teljes foot-magasságban átmenő — felülnézetből (Y irányból) is látható.
 */
function buildUpperFootStripShape(side: 'left' | 'right'): THREE.Shape {
  const halfL = L / 2
  const halfBP = P_WING_PATTERN / 2 // = 37.5
  const r = D_THRU / 2

  const xInner = side === 'left' ? -X_PEDESTAL_HALF : +X_PEDESTAL_HALF
  const xOuter = side === 'left' ? -X_FOOT_HALF : +X_FOOT_HALF
  const xLeft = Math.min(xInner, xOuter)
  const xRight = Math.max(xInner, xOuter)
  const xHole = side === 'left' ? -halfBP : +halfBP

  const shape = new THREE.Shape()
  shape.moveTo(xLeft, -halfL)
  shape.lineTo(xRight, -halfL)
  shape.lineTo(xRight, +halfL)
  shape.lineTo(xLeft, +halfL)
  shape.closePath()

  const hole = new THREE.Path()
  hole.absellipse(xHole, 0, r, r, 0, 2 * Math.PI, false)
  shape.holes.push(hole)
  return shape
}

function buildUpperFootStripGeometry(side: 'left' | 'right'): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildUpperFootStripShape(side), {
    depth: H_UPPER_FOOT,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geom.rotateX(Math.PI / 2)
  geom.translate(0, Y_UPPER_FOOT_BOT + H_UPPER_FOOT, 0)
  return geom
}

/**
 * Pedestal 2D shape: X-Y síkban (front nézet), B1 × pedestal_height téglalap
 * a TELJES Ø20 bore-furattal a (0, Y_BORE_CENTER) ponton.
 *
 * Y range: Y_PEDESTAL_BOT..Y_BLOCK_TOP = -15..+29 (44 mm magas; az alja 1 mm
 * overlap-pal érintkezik a Lower Foot tetejével és az Upper Foot strip-ek aljával).
 * A bore Y range -14..+6 → mind a kontúron belül van.
 */
function buildPedestalShape(): THREE.Shape {
  const halfB1 = X_PEDESTAL_HALF
  const r = D_BORE / 2

  const shape = new THREE.Shape()
  shape.moveTo(-halfB1, Y_PEDESTAL_BOT)
  shape.lineTo(+halfB1, Y_PEDESTAL_BOT)
  shape.lineTo(+halfB1, Y_BLOCK_TOP)
  shape.lineTo(-halfB1, Y_BLOCK_TOP)
  shape.closePath()

  const bore = new THREE.Path()
  bore.absellipse(0, Y_BORE_CENTER, r, r, 0, 2 * Math.PI, false)
  shape.holes.push(bore)

  return shape
}

function buildPedestalGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildPedestalShape(), {
    depth: L,
    bevelEnabled: false,
    curveSegments: 36,
  })
  geom.translate(0, 0, -L / 2)
  return geom
}

// ---- LOD belépési pontok ----

/**
 * Realisztikus: Lower Foot + 2 Upper Foot strip + Pedestal. A 2 wing-furat a foot
 * teljes 25 mm magasságán átmegy (felülnézetből és alulnézetből egyaránt látható),
 * a Ø20 bore a pedestal teljes 42 mm Z-mélységén áthalad.
 */
export function EK20BearingRealistic({ componentId }: PartBuilderProps) {
  const aluMat = useAluminiumMaterial()
  const lowerFootGeom = useMemo(() => buildLowerFootGeometry(), [])
  const upperFootLeftGeom = useMemo(() => buildUpperFootStripGeometry('left'), [])
  const upperFootRightGeom = useMemo(() => buildUpperFootStripGeometry('right'), [])
  const pedestalGeom = useMemo(() => buildPedestalGeometry(), [])
  useEffect(() => {
    return () => {
      lowerFootGeom.dispose()
      upperFootLeftGeom.dispose()
      upperFootRightGeom.dispose()
      pedestalGeom.dispose()
    }
  }, [lowerFootGeom, upperFootLeftGeom, upperFootRightGeom, pedestalGeom])

  return (
    <group userData={{ componentId }}>
      <mesh material={aluMat} geometry={lowerFootGeom} userData={{ componentId }} />
      <mesh material={aluMat} geometry={upperFootLeftGeom} userData={{ componentId }} />
      <mesh material={aluMat} geometry={upperFootRightGeom} userData={{ componentId }} />
      <mesh material={aluMat} geometry={pedestalGeom} userData={{ componentId }} />
    </group>
  )
}

/**
 * Medium: ugyanaz mint Realistic — surface recess-ek nélkül, geometriai részletek
 * azonosak.
 */
export function EK20BearingMedium(props: PartBuilderProps) {
  return <EK20BearingRealistic {...props} />
}

/**
 * Sematikus: tömör doboz a teljes B × H × L bbox-szal (a renderer override-olja
 * a színt a regiszter szerint). Furatok / pedestal-step nélkül.
 */
export function EK20BearingSchematic({ componentId }: PartBuilderProps) {
  return (
    <group userData={{ componentId }}>
      <mesh userData={{ componentId }}>
        <boxGeometry args={[B, H, L]} />
        <meshStandardMaterial color="#888" />
      </mesh>
    </group>
  )
}
