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
 * Az "alap" (foot, B=95 wide szakasz) magassága a felhasználó kérésére
 * H_FOOT = H1 = 25 mm — a bore tengelye pontosan a foot teteje magasságában van.
 *
 * FELÉPÍTÉS — 2 db ExtrudeGeometry, eltérő irányú extrudálással:
 *
 *   1. **Lower Foot** (B × H_LOWER_FOOT × L = 95 × 15 × 42), X-Z profil Y mentén
 *      extrudálva. Y range: −29..−14 (a bore aljánál = H1 − H/2 − D/2 végződik).
 *      **2 db REAL Ø6.6 átmenő furat** (a 2 WING furat, a felhasználó kérésére
 *      megtartva): X = ±P/2 = ±37.5, Z = 0. Alulról láthatóak.
 *
 *   2. **Upper Body** (Lower Foot felett, az alap felső 10 mm-e + a teljes
 *      pedestal). X-Y T-shape profil Z mentén L = 42 mm-en extrudálva.
 *      Y range: −15..+29 (1 mm overlap a Lower Foot tetejével a tangencia
 *      elkerülésére). A T-shape:
 *        - alsó "Upper Foot" szakasz: B × ~11 = 95 × 11 (Y = −15..−4)
 *        - felső "Pedestal" szakasz:   B1 × (H/2 − Y_PED_BOT) = 56 × 33 (Y = −4..+29)
 *      **1 db REAL Ø20 bore** (teljes kör, NEM fél-kör) a (0, −4) ponton —
 *      Y range: −14..+6, mind a felső, mind az alsó fele a T-shape kontúrjon
 *      belül. Z oldalról nézve a bore egy teljes Ø20 körlapként látszik, ami
 *      áthalad a pedestalon és a foot felső 10 mm-én is.
 *
 * **NINCS** cosmetic counterbore-recesz a pedestal tetején (a felhasználó kérésére
 * eltávolítva). A 2 KÖZPONTI mounting hole-t (X=±23.75) sem modellezzük.
 *
 * NEM modellezett részletek (későbbi iterációkra):
 *   - Központi M4 locknut hozzáférési furat a pedestal tetején (T = 30 mm mély)
 *   - A belső csapágypár (2 db 7204B P0 angular contact, RN20 locknut, távtartó)
 *   - Élek lekerekítése / chamferek
 *   - A 2 wing-furat csak a Lower Foot 15 mm-én megy át (alulról látszik); az
 *     Upper Body lefedi felülről (vizualizációs egyszerűsítés, mivel a Z-extrudált
 *     X-Y profilba Y-irányú lyukak nem illeszthetők CSG nélkül)
 *
 * Builder lokális orientáció:
 *   - +Z = orsó-tengely (a bore Z mentén megy át)
 *   - +Y = függőlegesen felfelé (pedestal up, alaplemez lent)
 *   - Origó: a blokk GEOMETRIAI KÖZÉPPONTJA (X=0, Y=0, Z=0):
 *       Y kiterjedés: −H/2..+H/2 = −29..+29
 *       Bore tengelye: Y = H1 − H/2 = −4 (a foot teteje szintjén)
 *       Lower Foot Y range: −29..−14 (15 mm fizikai magas)
 *       Upper Body Y range: −15..+29 (1 mm overlap a Lower Foot-tal)
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

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

// ---- Felhasználó-specifikált / becsült méretek (a hivatalos táblázatban nem szerepelnek) ----
/**
 * Az "alap" (foot, B=95 wide szakasz) fizikai magassága. A felhasználó kérésére
 * H_FOOT = H1 = 25, vagyis a foot teteje pontosan a bore-tengely magasságában van.
 */
const H_FOOT = H1 // = 25
const D_THRU = 6.6 // d1 — átmenő furat (M6 clearance, a wing-csavarokhoz)

// ---- Levezetett Y koordináták (centrált koord-rendszer, Y_world = 0 a blokk geometriai közepe) ----
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
 * Az Upper Body 1 mm-rel a Lower Foot teteje ALATT kezdődik, hogy a bore alsó pontja
 * (Y=-14) ne legyen érintőleges az Upper Body kontúrjának alsó éléhez (különben az
 * ExtrudeGeometry triangulációja a tangencia ponton hibás lehet).
 */
const SAFETY_OVERLAP = 1
const Y_UPPER_BODY_BOT = Y_LOWER_FOOT_TOP - SAFETY_OVERLAP // = -15
/** Pedestal alja (= foot teteje, a "T-shape" váll-szintje). */
const Y_PED_BOT = -H / 2 + H_FOOT // = -4

/**
 * Re-exportált méretek a komponens regiszter és a layout-számítások számára.
 * NÉV-konvenció: a hivatalos HIWIN datasheet-ből származó értékek `tableD/tableL/...`,
 * a becsült értékek `estimatedH1Foot/...`. Így a felhasználó későbbi iterációknál
 * egyértelműen látja, melyik az a méret, amit a datasheet szerint pontosan tudunk.
 */
export const EK20_BEARING_DIMENSIONS = {
  // a HIWIN EK20-C5 hivatalos datasheet-ből:
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
  // a foot fizikai vastagsága — a felhasználó kérésére = H1 = 25 mm
  // (a bore tengelye a foot teteje szintjén van):
  footThickness: H_FOOT,
  // A Lower Foot tényleges fizikai Y-extrude magassága (a bore aljáig megy fel).
  // A foot felső 10 mm-e (Y=-14..-4) az Upper Body T-shape részeként van modellezve.
  lowerFootPhysicalThickness: H_LOWER_FOOT,
  // Becsült (HIWIN EK20-C5 hivatalos rajzban explicit nincs megadva):
  estimatedThroughHoleDiam: D_THRU,
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

  // 2 wing through-hole (X = ±P/2, Z = 0 — a középvonalon)
  for (const px of [-halfBP, +halfBP]) {
    const hole = new THREE.Path()
    hole.absellipse(px, 0, r, r, 0, 2 * Math.PI, false)
    shape.holes.push(hole)
  }
  return shape
}

/**
 * Lower Foot ExtrudeGeometry: a 2D X-Z profilt H_LOWER_FOOT = 15 mm-en Y irányba
 * extrudálja, és pozicionálja Y = Y_BLOCK_BOT .. Y_LOWER_FOOT_TOP = -29 .. -14 közé.
 */
function buildLowerFootGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildLowerFootShape(), {
    depth: H_LOWER_FOOT,
    bevelEnabled: false,
    curveSegments: 24,
  })
  // rotateX(+π/2): a shape (X-Y_shape) síkból az extrude depth +Z irányból átkerül
  // world -Y irányba (a Lower Foot vastagsága Y mentén).
  geom.rotateX(Math.PI / 2)
  // Az átfordítás után a Lower Foot Y range: [-H_LOWER_FOOT, 0] = [-15, 0].
  // Eltoljuk a blokk aljához:
  geom.translate(0, Y_BLOCK_BOT + H_LOWER_FOOT, 0)
  // Új Y range: [Y_BLOCK_BOT, Y_BLOCK_BOT + H_LOWER_FOOT] = [-29, -14] ✓
  return geom
}

/**
 * Upper Body 2D shape: X-Y síkban (front nézet), T-shape kontúr az Upper Foot
 * (alul B = 95 wide, ~11 mm magas) és a Pedestal (felül B1 = 56 wide, 33 mm magas)
 * összevont profilja. Egyetlen lyuk: a TELJES Ø20 bore kör a (0, Y_BORE_CENTER)
 * = (0, -4) ponton — Y range -14..+6 a kontúron belül (Y_UPPER_BODY_BOT = -15
 * miatt 1 mm tartalék az alsó éltől).
 *
 * A T-shape kontúr CCW haladva: bal-alsó → alulról jobbra → fel az Upper Foot
 * jobb tetejéig → balra a pedestal jobb sarka felé (T-váll) → fel a pedestal
 * teteje → balra → le a pedestal bal sarka felé (T-váll) → balra az Upper Foot
 * bal tetejéig → bezár.
 */
function buildUpperBodyShape(): THREE.Shape {
  const halfB = B / 2 // 47.5 (Upper Foot szélesség)
  const halfB1 = B1 / 2 // 28 (Pedestal szélesség)
  const r = D_BORE / 2 // 10

  const shape = new THREE.Shape()
  shape.moveTo(-halfB, Y_UPPER_BODY_BOT) // (-47.5, -15)
  shape.lineTo(+halfB, Y_UPPER_BODY_BOT) // (+47.5, -15)
  shape.lineTo(+halfB, Y_PED_BOT) // (+47.5, -4)  Upper Foot jobb teteje
  shape.lineTo(+halfB1, Y_PED_BOT) // (+28, -4)    T-váll bal felé
  shape.lineTo(+halfB1, Y_BLOCK_TOP) // (+28, +29)  Pedestal jobb teteje
  shape.lineTo(-halfB1, Y_BLOCK_TOP) // (-28, +29)
  shape.lineTo(-halfB1, Y_PED_BOT) // (-28, -4)    T-váll bal felé
  shape.lineTo(-halfB, Y_PED_BOT) // (-47.5, -4)  Upper Foot bal teteje
  shape.closePath()

  // TELJES Ø20 bore — a (0, -4) ponton, Y range -14..+6, mind a kontúron belül.
  const bore = new THREE.Path()
  bore.absellipse(0, Y_BORE_CENTER, r, r, 0, 2 * Math.PI, false)
  shape.holes.push(bore)

  return shape
}

function buildUpperBodyGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildUpperBodyShape(), {
    depth: L,
    bevelEnabled: false,
    curveSegments: 36,
  })
  geom.translate(0, 0, -L / 2)
  return geom
}

// ---- LOD belépési pontok ----

/**
 * Realisztikus: Lower Foot (2 wing through-hole) + Upper Body T-shape (TELJES Ø20
 * bore-furat). NINCS cosmetic counterbore-recess (a felhasználó kérésére eltávolítva).
 */
export function EK20BearingRealistic({ componentId }: PartBuilderProps) {
  const aluMat = useAluminiumMaterial()
  const lowerFootGeom = useMemo(() => buildLowerFootGeometry(), [])
  const upperBodyGeom = useMemo(() => buildUpperBodyGeometry(), [])
  useEffect(() => {
    return () => {
      lowerFootGeom.dispose()
      upperBodyGeom.dispose()
    }
  }, [lowerFootGeom, upperBodyGeom])

  return (
    <group userData={{ componentId }}>
      {/* Lower Foot — 2 wing through-hole alulról láthatóak */}
      <mesh
        material={aluMat}
        geometry={lowerFootGeom}
        userData={{ componentId }}
      />
      {/* Upper Body T-shape — TELJES Ø20 bore Z mentén áthalad */}
      <mesh
        material={aluMat}
        geometry={upperBodyGeom}
        userData={{ componentId }}
      />
    </group>
  )
}

/**
 * Medium: ugyanaz mint Realistic — surface recess-ek nélkül, geometriai részletek
 * azonosak.
 */
export function EK20BearingMedium({ componentId }: PartBuilderProps) {
  const aluMat = useAluminiumMaterial()
  const lowerFootGeom = useMemo(() => buildLowerFootGeometry(), [])
  const upperBodyGeom = useMemo(() => buildUpperBodyGeometry(), [])
  useEffect(() => {
    return () => {
      lowerFootGeom.dispose()
      upperBodyGeom.dispose()
    }
  }, [lowerFootGeom, upperBodyGeom])
  return (
    <group userData={{ componentId }}>
      <mesh
        material={aluMat}
        geometry={lowerFootGeom}
        userData={{ componentId }}
      />
      <mesh
        material={aluMat}
        geometry={upperBodyGeom}
        userData={{ componentId }}
      />
    </group>
  )
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
