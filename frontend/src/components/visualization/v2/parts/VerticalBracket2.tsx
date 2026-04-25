/**
 * Függőleges konzol 2 — alumínium hátsó tartólemez átmenő NEMA 23 kivágással.
 *
 * Geometria (mm):
 *   - Lemez: szélesség 80 (X), magasság 200 (Y), vastagság 10 (Z) — builder lokális koords.
 *     (Ugyanaz a befoglaló méret, mint a `függőleges konzol 1`.)
 *   - Anyag: alumínium (PBR look, világos ezüst-szürke).
 *   - A korábbi 4 mm-es zseb megszűnt: helyette a NEMA 23 motor body
 *     sarok-indent + fillet kontúrja ÁTMENŐ kivágásként megy át a teljes 10 mm-es
 *     lemezvastagságon.
 *   - A motor jelenlegi 270°-os X tengely körüli fordítása miatt a kábelbevezető
 *     box a lemez síkjában a motor kontúrja alá kerül, ezért a motor-kivágáshoz
 *     kapcsolódó, lecsapott élű kábelbox-clearance is át van vágva a lemezen.
 *
 * Forgatás: a regiszterben transform.rotation = [π/2, +π/2, 0] forgatja úgy, hogy a
 * lemez síkja függőleges legyen, vastagsági normálja pedig a világ +X irányba nézzen.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Anchor, PartBuilderProps } from '../types'
import {
  NEMA23_BODY_SIZE,
  NEMA23_BOLT_PATTERN,
  NEMA23_INDENT_FILLET_R,
  NEMA23_INDENT_OUTWARD_OFFSET,
  NEMA23_INDENT_R,
} from './_motorSilhouette'

const PLATE_W = 100
/**
 * Lemez magassága.
 *
 * Felhasználói kérésekre a tetejéből összesen 24 mm le lett vágva
 * (200 → 188.2 → 183.2 → 176):
 *   1. lépés: 200 → 188.2 — a teteje a #24 fedőlap (`x-drive-top-plate`)
 *      override szerinti ALJÁHOZ (world Z = 188.2) illeszkedett.
 *   2. lépés: 188.2 → 183.2 — további 5 mm-es lehúzás.
 *   3. lépés: 183.2 → 176 — végleges magasság a felhasználó által megadva.
 * Az alja továbbra is Z = 0 (a base-tetőn áll); a builder shape Y-centerelt,
 * így az új builder Y range = -88 .. +88. Ugyanaz mint a
 * `függőleges konzol 1`.
 */
const PLATE_H = 200
const PLATE_T = 10

/**
 * A motor-kivágás középpontja a lemez lokális koordinátáiban (ugyanaz mint a
 * `függőleges konzol 1` cutout-jánál).
 *
 * A motor (#8) az X tengely körül 270°-kal megfordítva ÉS lejjebb tolva
 * (felhasználói módosítás). Az új ABSZOLÚT kivágás/flange pozíció a base-tetőtől
 * mérve world Z ≈ 150. A centered builder Y origója a lemez magasság-felezőjénél
 * (world Z = 100) van, a kivágás builder-Y eltolása ≈ 50.
 */
const CUTOUT_CX = -20
const CUTOUT_CY = 50.4

/** Kábelbevezető befoglaló mérete a motoron (mm). */
const CABLE_BOX_W = 37
const CABLE_BOX_H = 13
const CABLE_BOX_BASE_H = 7
const CABLE_BOX_CHAMFER_H = CABLE_BOX_H - CABLE_BOX_BASE_H
const CABLE_BOX_TOP_W = CABLE_BOX_W - 2 * CABLE_BOX_CHAMFER_H // 25 mm, 45°-os lecsapás


/** Alumínium PBR anyag — világos ezüst-szürke (ugyanaz, mint bracket-1). */
function useAluminumMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#c8cad0',
        metalness: 0.65,
        roughness: 0.35,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

/** Közös átmenő kivágás: NEMA 23 sarok-indent kontúr + alul kapcsolódó kábelbox. */
function buildMotorWithCableHolePath(): THREE.Path {
  const path = new THREE.Path()
  const cx = CUTOUT_CX
  const cy = CUTOUT_CY
  const half = NEMA23_BODY_SIZE / 2
  const halfBolt = NEMA23_BOLT_PATTERN / 2
  const offsetAxis = NEMA23_INDENT_OUTWARD_OFFSET / Math.SQRT2
  const dx = half - halfBolt - offsetAxis
  const filletR = NEMA23_INDENT_FILLET_R
  const indentR = NEMA23_INDENT_R
  const innerSq = (indentR + filletR) * (indentR + filletR) - (dx - filletR) * (dx - filletR)
  const L = Math.sqrt(innerSq)
  const ratio = filletR / (indentR + filletR)
  const yB = cy - half
  const notchBaseHalfW = CABLE_BOX_W / 2
  const notchTopHalfW = CABLE_BOX_TOP_W / 2
  const notchChamferStartY = yB - CABLE_BOX_BASE_H
  const notchBottomY = yB - CABLE_BOX_H
  const leftBottomTangentX = cx - halfBolt - offsetAxis + L
  const rightBottomTangentX = cx + halfBolt + offsetAxis - L

  path.moveTo(cx - notchTopHalfW, notchBottomY)
  path.lineTo(cx + notchTopHalfW, notchBottomY)
  path.lineTo(cx + notchBaseHalfW, notchChamferStartY)
  path.lineTo(cx + notchBaseHalfW, yB)
  path.lineTo(rightBottomTangentX, yB)

  const traceCorner = (sx: 1 | -1, sy: 1 | -1) => {
    const isHEntry = sx * sy === -1
    const boltX = cx + sx * halfBolt
    const boltY = cy + sy * halfBolt
    const indCx = boltX + sx * offsetAxis
    const indCy = boltY + sy * offsetAxis

    const hCx = indCx - sx * L
    const hCy = indCy + sy * (dx - filletR)
    const vCx = indCx + sx * (dx - filletR)
    const vCy = indCy - sy * L

    const hEdgeX = hCx
    const hEdgeY = indCy + sy * dx
    const vEdgeX = indCx + sx * dx
    const vEdgeY = vCy

    const hIndentX = hCx + ratio * (indCx - hCx)
    const hIndentY = hCy + ratio * (indCy - hCy)
    const vIndentX = vCx + ratio * (indCx - vCx)
    const vIndentY = vCy + ratio * (indCy - vCy)

    const hEdgeAngle = Math.atan2(hEdgeY - hCy, hEdgeX - hCx)
    const hIndentAngle = Math.atan2(hIndentY - hCy, hIndentX - hCx)
    const vEdgeAngle = Math.atan2(vEdgeY - vCy, vEdgeX - vCx)
    const vIndentAngle = Math.atan2(vIndentY - vCy, vIndentX - vCx)
    const indentHAngle = Math.atan2(hIndentY - indCy, hIndentX - indCx)
    const indentVAngle = Math.atan2(vIndentY - indCy, vIndentX - indCx)

    if (isHEntry) {
      path.lineTo(hEdgeX, hEdgeY)
      path.absarc(hCx, hCy, filletR, hEdgeAngle, hIndentAngle, false)
      path.absarc(indCx, indCy, indentR, indentHAngle, indentVAngle, true)
      path.absarc(vCx, vCy, filletR, vIndentAngle, vEdgeAngle, false)
    } else {
      path.lineTo(vEdgeX, vEdgeY)
      path.absarc(vCx, vCy, filletR, vEdgeAngle, vIndentAngle, false)
      path.absarc(indCx, indCy, indentR, indentVAngle, indentHAngle, true)
      path.absarc(hCx, hCy, filletR, hIndentAngle, hEdgeAngle, false)
    }
  }

  traceCorner(+1, -1)
  traceCorner(+1, +1)
  traceCorner(-1, +1)
  traceCorner(-1, -1)

  path.lineTo(leftBottomTangentX, yB)
  path.lineTo(cx - notchBaseHalfW, yB)
  path.lineTo(cx - notchBaseHalfW, notchChamferStartY)
  path.lineTo(cx - notchTopHalfW, notchBottomY)
  path.closePath()
  return path
}

/** Teljes lemez Shape-je: átmenő motor-kontúr + átmenő kábelbox kivágás. */
function buildPlateShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-PLATE_W / 2, -PLATE_H / 2)
  shape.lineTo(+PLATE_W / 2, -PLATE_H / 2)
  shape.lineTo(+PLATE_W / 2, +PLATE_H / 2)
  shape.lineTo(-PLATE_W / 2, +PLATE_H / 2)
  shape.closePath()
  shape.holes.push(buildMotorWithCableHolePath())
  return shape
}

/** Teljes vastagságú lemez átmenő kivágásokkal. */
function buildPlateGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildPlateShape(), {
    depth: PLATE_T,
    bevelEnabled: false,
    curveSegments: 48,
  })
  geom.translate(0, 0, -PLATE_T / 2)
  return geom
}

/** Realisztikus: teljes vastagságú lemez átmenő motor- és kábelbox-kivágással. */
export function VerticalBracket2Realistic({ componentId }: PartBuilderProps) {
  const mat = useAluminumMaterial()
  const geom = useMemo(() => buildPlateGeometry(), [])
  useEffect(() => () => geom.dispose(), [geom])
  return <mesh material={mat} geometry={geom} userData={{ componentId }} />
}

/** Medium: ugyanaz mint realistic (a kivágások a meghatározó vizuális elemek). */
export function VerticalBracket2Medium({ componentId }: PartBuilderProps) {
  return <VerticalBracket2Realistic componentId={componentId} />
}

/** Sematikus: tömör lemez (kivágások nélkül); a renderer override-olja a
 *  regiszter színére. */
export function VerticalBracket2Schematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[PLATE_W, PLATE_H, PLATE_T]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}

export const VERTICAL_BRACKET_2_DIMENSIONS = {
  width: PLATE_W,
  height: PLATE_H,
  thickness: PLATE_T,
  cutoutCenterX: CUTOUT_CX,
  cutoutCenterY: CUTOUT_CY,
  cableBoxWidth: CABLE_BOX_W,
  cableBoxHeight: CABLE_BOX_H,
}

// ---------------------------------------------------------------------------
// Anchor-export — builder-lokális frame-ben.
// A lemez X-Y síkban, +Z mentén PLATE_T vastagon. A "front" oldal (+Z) a motor
// felé néz. A motor- és kábelbox-kontúr átmenő kivágásként megy át rajta.
// ---------------------------------------------------------------------------
const NEMA23_BOLT_PATTERN_HALF_2 = 47.14 / 2

export const VERTICAL_BRACKET_2_ANCHORS: Record<string, Anchor> = {
  origin: {
    position: [0, 0, 0],
    axis: [0, 0, 1],
    description: 'A lemez geometriai középpontja',
  },
  'cutout-center': {
    position: [CUTOUT_CX, CUTOUT_CY, 0],
    axis: [0, 0, 1],
    description:
      'Az átmenő NEMA 23 motor-kivágás középpontja. A kábelbox-kivágás ehhez képest -Y irányban kapcsolódik.',
  },
  'front-face-center': {
    position: [CUTOUT_CX, CUTOUT_CY, +PLATE_T / 2],
    axis: [0, 0, 1],
    description:
      'A lemez ELSŐ oldalának közepe a motor-kivágás középvonalán. A motor ' +
      'felöli oldal.',
  },
  'back-face-center': {
    position: [CUTOUT_CX, CUTOUT_CY, -PLATE_T / 2],
    axis: [0, 0, -1],
    description: 'A lemez HÁTSÓ oldala (a motorral ellenkező oldal).',
  },
  'bolt-1': {
    position: [
      CUTOUT_CX - NEMA23_BOLT_PATTERN_HALF_2,
      CUTOUT_CY - NEMA23_BOLT_PATTERN_HALF_2,
      +PLATE_T / 2,
    ],
    axis: [0, 0, 1],
    description: 'Ø5.1 átmenő furat: bal-alsó (-X, -Y a kivágás-középhez képest)',
  },
  'bolt-2': {
    position: [
      CUTOUT_CX + NEMA23_BOLT_PATTERN_HALF_2,
      CUTOUT_CY - NEMA23_BOLT_PATTERN_HALF_2,
      +PLATE_T / 2,
    ],
    axis: [0, 0, 1],
    description: 'jobb-alsó (+X, -Y)',
  },
  'bolt-3': {
    position: [
      CUTOUT_CX + NEMA23_BOLT_PATTERN_HALF_2,
      CUTOUT_CY + NEMA23_BOLT_PATTERN_HALF_2,
      +PLATE_T / 2,
    ],
    axis: [0, 0, 1],
    description: 'jobb-felső (+X, +Y)',
  },
  'bolt-4': {
    position: [
      CUTOUT_CX - NEMA23_BOLT_PATTERN_HALF_2,
      CUTOUT_CY + NEMA23_BOLT_PATTERN_HALF_2,
      +PLATE_T / 2,
    ],
    axis: [0, 0, 1],
    description: 'bal-felső (-X, +Y)',
  },
  'bottom-edge-center': {
    position: [0, -PLATE_H / 2, 0],
    axis: [0, -1, 0],
    description:
      'A lemez ALSÓ élének közepe — itt fekszik az alaplemezre (base). Axis = -Y.',
  },
}
