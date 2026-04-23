/**
 * HTD 5M szinkron (timing) bordásszíj — két HTD pulley-t összekötő, zárt hurok.
 *
 * CIKK: "HTD5M Timing Belt 600-5M Width 15  HTD 5M Synchronous Belt CNC/3D Parts"
 *   - Pitch: 5 mm  (HTD 5M szabvány)
 *   - Hossz (centerline / pitch line): 600 mm (120 fog × 5 mm)
 *   - Szélesség: 15 mm  (a 70T/15T pulley body-szélességéhez igazítva)
 *   - Vastagság (tooth-tip-től body-back-ig): ≈ 3.8 mm  (HTD 5M szabvány)
 *
 * GEOMETRIA STRATÉGIA:
 *   A belt-et a 600 mm pitch-line hossz vezérli: a két pulley pitch-radius-a
 *   (R₁=70T, R₂=15T) és a `BELT_LENGTH_NOMINAL` ismeretében kiszámítjuk a
 *   szükséges PULLEY centerek közötti távolságot (C) az open-belt képletből:
 *
 *       L = 2·C + π·(R₁ + R₂) + (R₁ − R₂)² / C
 *
 *   C-re átrendezve quadratikus egyenlet:
 *       2·C² − (L − π·(R₁+R₂)) · C + (R₁−R₂)² = 0
 *       C = [ k + √(k² − 8·(R₁−R₂)²) ] / 4    ahol  k = L − π·(R₁+R₂)
 *
 *   A nagyobb gyök a fizikailag releváns megoldás (a kisebb gyök degeneráltan
 *   kicsi center-distance-et ad). A 70T pulley a builder-lokál origójában van,
 *   a 15T pulley X = C-nél; a belt loop ezt a két kört érintő open-belt
 *   konfigurációban hurkolja körül.
 *
 *   A 2D Shape (X-Y síkban):
 *     - Outer kontúr (CW): felső tangens egyenes + nagy pulley körüli ív (a
 *       "back side"-on, azaz a kis pulleytól TÁVOLABBI 232°-os ív) + alsó
 *       tangens egyenes + kis pulley körüli ív (a kis pulley back side-on,
 *       128°-os ív).
 *     - Hole (CCW, fordított path): ugyanaz a kontúr, de inner sugarakkal
 *       (centerline − BELT_THICKNESS/2). A két kontúr közötti "szalag" a belt
 *       fizikai falvastagsága.
 *   Az így kapott Shape-et `ExtrudeGeometry`-vel BELT_WIDTH (15 mm) mélységig
 *   extrudáljuk a builder +Z mentén → a registry rotation [π/2, 0, 0] ezt
 *   világ −Y irányba mappolja, ami párhuzamos a két pulley shaft-jával.
 *
 * MATEMATIKA (open belt, R_small < R_large):
 *   - axis = (large.center − small.center) / d            (egységvektor)
 *   - perp = +90° CCW rotation of axis
 *   - n_top = ((R_small − R_large) / d) · axis + sqrt(1 − ((R_s−R_l)/d)²) · perp
 *     (a felső tangens érintési pontok közös normálja, mindkét pulley center-jétől
 *      ugyanazon vektor mentén)
 *   - Tangens érintési pontok: T_p_top = p.center + p.r · n_top   (mindkét p-re)
 *   - Wrap szögek: large pulley = π + 2·asin((R_l−R_s)/d), small = π − 2·asin(…)
 *
 * BUILDER LOKÁLIS ORIENTÁCIÓ:
 *   - +X = a két pulley center-jét összekötő egyenes iránya (parent-frame +X).
 *   - +Y = a parent-frame +Z (világ +Z, felfelé) — a tangens egyenesek erre a
 *     síkra párhuzamosak.
 *   - +Z = belt szélességi irány (a registry rotation után ez a pulley shaft
 *     iránya, azaz világ −Y).
 *   - Origó: a parent-frame origója (= a 70T pulley center).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'
import { HTD_PULLEY_70T_25B_DIMENSIONS } from './HtdPulley70T_25b'
import { HTD_PULLEY_15T_8B_DIMENSIONS } from './HtdPulley15T_8b'

// ---- Belt méretek ----
const BELT_WIDTH = 15
const BELT_THICKNESS = 3.8
const BELT_THICKNESS_HALF = BELT_THICKNESS / 2
const BELT_LENGTH_NOMINAL = 600
const BELT_PITCH = 5
const BELT_TOOTH_COUNT = BELT_LENGTH_NOMINAL / BELT_PITCH

// ---- Pulley referenciák ----
// A 70T pulley center a builder-lokál origóban (X=0), a 15T pulley center X-koordinátáját
// a `BELT_LENGTH_NOMINAL` és a két pulley pitch-radius-a alapján számítjuk: a belt-loop
// nyitott szíj konfigurációban hurkolja körül a két pulleyt, és a centerline-hossza
// pontosan a `BELT_LENGTH_NOMINAL` lesz (open-belt képlet, lásd file-header).
const PULLEY_70T_PITCH_R = HTD_PULLEY_70T_25B_DIMENSIONS.pitchDiam / 2
const PULLEY_15T_PITCH_R = HTD_PULLEY_15T_8B_DIMENSIONS.pitchDiam / 2

function solvePulleyCenterDistance(beltLength: number, r1: number, r2: number): number {
  const sumR = r1 + r2
  const diffSq = (r1 - r2) ** 2
  const k = beltLength - Math.PI * sumR
  const disc = k * k - 8 * diffSq
  if (disc < 0) {
    throw new Error(
      `HtdBelt600_5M_W15: belt too short (L=${beltLength}, π·(R₁+R₂)=${Math.PI * sumR})`,
    )
  }
  return (k + Math.sqrt(disc)) / 4
}

const PULLEY_70T_X = 0
const PULLEY_15T_X = solvePulleyCenterDistance(
  BELT_LENGTH_NOMINAL,
  PULLEY_70T_PITCH_R,
  PULLEY_15T_PITCH_R,
)
const PULLEY_Y = 0

const ARC_SEGMENTS_REALISTIC = 96
const ARC_SEGMENTS_MEDIUM = 48
const ARC_SEGMENTS_SCHEMATIC = 24

// ---- Material ----

function useBeltMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1c1c1f',
        metalness: 0.05,
        roughness: 0.85,
        side: THREE.DoubleSide,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

// ---- 2D Shape builder ----

interface PulleyRef {
  x: number
  y: number
  r: number
}

function buildBeltShape(pulleyA: PulleyRef, pulleyB: PulleyRef): THREE.Shape {
  // small / large besorolás: open belt formula R_small < R_large mellett
  // egyértelmű; a nagy pulley wrap-je hosszabb (back side 232°-os ív), a
  // kis pulleyé rövidebb (128°-os ív).
  const small = pulleyA.r < pulleyB.r ? pulleyA : pulleyB
  const large = pulleyA.r < pulleyB.r ? pulleyB : pulleyA

  const dx = large.x - small.x
  const dy = large.y - small.y
  const d = Math.hypot(dx, dy)
  if (d <= small.r + large.r) {
    throw new Error(
      `HtdBelt600_5M_W15: pulley centers too close (d=${d}, R_sum=${small.r + large.r})`,
    )
  }

  const axisX = dx / d
  const axisY = dy / d
  const perpX = -axisY
  const perpY = axisX

  // Tangens normál komponensek (open belt):
  //   n_top = nAxis · axis + nPerp · perp
  //   nAxis = (R_small − R_large) / d   (mindig negatív)
  //   nPerp = sqrt(1 − nAxis²)
  const nAxis = (small.r - large.r) / d
  const nPerp = Math.sqrt(1 - nAxis * nAxis)

  const nTopX = nAxis * axisX + nPerp * perpX
  const nTopY = nAxis * axisY + nPerp * perpY
  const nBotX = nAxis * axisX - nPerp * perpX
  const nBotY = nAxis * axisY - nPerp * perpY

  // Outer / inner radius mindkét pulleynál.
  const sOR = small.r + BELT_THICKNESS_HALF
  const lOR = large.r + BELT_THICKNESS_HALF
  const sIR = small.r - BELT_THICKNESS_HALF
  const lIR = large.r - BELT_THICKNESS_HALF

  // Tangens érintési pontok. Csak azokat számoljuk ki, amelyeket explicit moveTo
  // vagy lineTo igényel — a többi érintési pontra a path-pointer az absarc
  // végén automatikusan ráül (start/end pontok a megadott szögeken).
  //   - sTopO: outer kontúr moveTo (start)
  //   - lTopO: outer felső tangens lineTo (vég)
  //   - sBotO: outer alsó tangens lineTo (vég)
  //   - sTopI: hole moveTo (start)
  //   - lBotI: hole alsó tangens (fordítva) lineTo (vég)
  const sTopO: [number, number] = [small.x + sOR * nTopX, small.y + sOR * nTopY]
  const lTopO: [number, number] = [large.x + lOR * nTopX, large.y + lOR * nTopY]
  const sBotO: [number, number] = [small.x + sOR * nBotX, small.y + sOR * nBotY]
  const sTopI: [number, number] = [small.x + sIR * nTopX, small.y + sIR * nTopY]
  const lBotI: [number, number] = [large.x + lIR * nBotX, large.y + lIR * nBotY]

  // Az érintési pont szöge a saját pulley center-jéhez viszonyítva. Mivel mindkét
  // pulleynál ugyanaz az n_top vektor (csak a sugár szorzó különbözik), a két
  // érintési pont szöge IS megegyezik (a saját körén).
  const angTop = Math.atan2(nTopY, nTopX)
  const angBot = Math.atan2(nBotY, nBotX)

  // ===========================================================================
  // OUTER kontúr (CW path traversal) — a belt halad iránya:
  //   small_top → large_top  (felső tangens egyenes)
  //   large_top → large_bot  (CW arc a +axis felé, 232°-os "back side" ív)
  //   large_bot → small_bot  (alsó tangens egyenes)
  //   small_bot → small_top  (CW arc a −axis felé, 128°-os "back side" ív)
  // ===========================================================================
  const shape = new THREE.Shape()
  shape.moveTo(sTopO[0], sTopO[1])
  shape.lineTo(lTopO[0], lTopO[1])
  shape.absarc(large.x, large.y, lOR, angTop, angBot, true)
  shape.lineTo(sBotO[0], sBotO[1])
  shape.absarc(small.x, small.y, sOR, angBot, angTop, true)
  shape.closePath()

  // ===========================================================================
  // HOLE (CCW path, fordított útvonalon) — kivágja a belt INNER kerületét:
  //   small_top_inner → small_bot_inner  (CCW arc a −axis felé, 128° wrap)
  //   small_bot_inner → large_bot_inner  (alsó tangens, fordítva)
  //   large_bot_inner → large_top_inner  (CCW arc a +axis felé, 232° wrap)
  //   large_top_inner → small_top_inner  (felső tangens, fordítva)
  // ===========================================================================
  const hole = new THREE.Path()
  hole.moveTo(sTopI[0], sTopI[1])
  hole.absarc(small.x, small.y, sIR, angTop, angBot, false)
  hole.lineTo(lBotI[0], lBotI[1])
  hole.absarc(large.x, large.y, lIR, angBot, angTop, false)
  hole.lineTo(sTopI[0], sTopI[1])
  shape.holes.push(hole)

  return shape
}

// ---- ExtrudeGeometry builder ----

function buildBeltGeometry(arcSegments: number): THREE.ExtrudeGeometry {
  const shape = buildBeltShape(
    { x: PULLEY_70T_X, y: PULLEY_Y, r: PULLEY_70T_PITCH_R },
    { x: PULLEY_15T_X, y: PULLEY_Y, r: PULLEY_15T_PITCH_R },
  )
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: BELT_WIDTH,
    bevelEnabled: false,
    curveSegments: arcSegments,
  })
  // Z mentén centráljuk: az extrúzió default Z = 0..+BELT_WIDTH, mi -BELT_WIDTH/2..+BELT_WIDTH/2-t akarunk.
  geom.translate(0, 0, -BELT_WIDTH / 2)
  return geom
}

// ---- Re-exportált méretek ----

export const HTD_BELT_600_5M_W15_DIMENSIONS = {
  pitch: BELT_PITCH,
  toothCount: BELT_TOOTH_COUNT,
  beltLengthNominal: BELT_LENGTH_NOMINAL,
  beltWidth: BELT_WIDTH,
  beltThickness: BELT_THICKNESS,
  // A két pulley center közötti távolság, az open-belt képletből számolva
  // (a registry bbox és a 15T pulley pozíció igazítható ebből).
  pulleyCenterDistance: PULLEY_15T_X,
}

// ---- LOD belépési pontok ----

/**
 * Realisztikus: nagy felbontású ExtrudeGeometry (96 ív-szegmens).
 */
export function HtdBelt600_5M_W15Realistic({ componentId }: PartBuilderProps) {
  const mat = useBeltMaterial()
  const geom = useMemo(() => buildBeltGeometry(ARC_SEGMENTS_REALISTIC), [])
  useEffect(() => () => geom.dispose(), [geom])
  return <mesh geometry={geom} material={mat} userData={{ componentId }} />
}

/**
 * Medium: közepes felbontás (48 ív-szegmens).
 */
export function HtdBelt600_5M_W15Medium({ componentId }: PartBuilderProps) {
  const mat = useBeltMaterial()
  const geom = useMemo(() => buildBeltGeometry(ARC_SEGMENTS_MEDIUM), [])
  useEffect(() => () => geom.dispose(), [geom])
  return <mesh geometry={geom} material={mat} userData={{ componentId }} />
}

/**
 * Sematikus: alacsony felbontás (24 ív-szegmens), a renderer felülírja a színt.
 */
export function HtdBelt600_5M_W15Schematic({ componentId }: PartBuilderProps) {
  const geom = useMemo(() => buildBeltGeometry(ARC_SEGMENTS_SCHEMATIC), [])
  useEffect(() => () => geom.dispose(), [geom])
  return (
    <mesh geometry={geom} userData={{ componentId }}>
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
