/**
 * Függőleges konzol 1 — alumínium tartólemez egy NEMA 23 szervo motor felfogásához.
 *
 * Geometria (mm):
 *   - Lemez: szélesség 80 (X), magasság 200 (Y), vastagság 10 (Z) — builder lokális koords.
 *   - Anyag: alumínium (PBR look, világos ezüst-szürke).
 *   - Felső részen (a builder lokális Y = +50 körül) a NEMA 23 motor body
 *     **sarok-indent** silhouette-je van kivágva (R=7 ívek befelé hajlanak a 4
 *     csavar-pozíció köré, ugyanaz a profil mint a motor iron body main szakaszán).
 *     A bracket anyaga a 4 sarok-indent voidban BENT marad — így a cutout-nyílásból
 *     **4 db befelé álló "fül" alakul ki a 4 csavar-pozíció köré**.
 *   - Ezen a 4 fülen 1-1 db Ø5.1 átmenő furat van fúrva a 47.14 mm pattern szerint,
 *     a `menetes-szar-szerelveny-1` 4 db M5 menetes szára számára. A szárak ezeken
 *     a füleken keresztül kötik a motort a konzolhoz, mindkét oldalt anyával.
 *
 * Forgatás: a regiszterben transform.rotation = [0, +π/2, 0] forgatja úgy, hogy a
 * lemez szembenéző oldala (a cutout) a világ +X irányba nézzen.
 *
 * Motor: STEPPERONLINE 23HS40-5004D-E1K-1M5 (closed-loop NEMA 23, 3.0 Nm, body 57×57×122 mm).
 *   Datasheet: public/components/tube-bender/vertical-bracket-1/refs/motor-datasheet.pdf
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Anchor, PartBuilderProps } from '../types'
import {
  addNema23BoltHoles,
  buildNema23IndentedHolePath,
} from './_motorSilhouette'

const PLATE_W = 80
/**
 * Lemez magassága.
 *
 * Felhasználói kérésekre a tetejéből összesen 24 mm le lett vágva
 * (200 → 188.2 → 183.2 → 176):
 *   1. lépés: 200 → 188.2 — a teteje a #24 fedőlap (`x-drive-top-plate`)
 *      override szerinti ALJÁHOZ (world Z = 188.2) illeszkedett.
 *   2. lépés: 188.2 → 183.2 — további 5 mm-es lehúzás (5 mm hézag a #24 alja
 *      és a bracket teteje között).
 *   3. lépés: 183.2 → 176 — végleges magasság a felhasználó által megadva.
 * Az alja továbbra is Z = 0 (a base-tetőn áll); a builder shape Y-centerelt,
 * így az új builder Y range = -88 .. +88.
 */
const PLATE_H = 176
const PLATE_T = 10

/**
 * A motor-cutout középpontja a lemez lokális koordinátáiban.
 *
 * A motor (#8) az X tengely körül 180°-kal megfordítva ÉS lejjebb tolva
 * (felhasználói módosítás). Az új ABSZOLÚT cutout/flange pozíció a base-tetőtől
 * mérve world Z = 138.4. A centered builder Y origója a lemez magasság-felezőjénél
 * (world Z = 88) van, a cutout builder-Y eltolása = 138.4 - 88 = 50.4.
 * Korábban: PLATE_H = 200/188.2/183.2, CUTOUT_CY = 50/55.9/58.4 (motor Z = 150).
 */
const CUTOUT_CY = 50.4

/** Alumínium PBR anyag — világos ezüst-szürke. */
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

/**
 * 2D Shape generátor: téglalap-lemez, opcionális NEMA 23 motor-cutout-tal a felső
 * részén. A cutout a sarok-indent silhouette (R=7), így a 4 sarok-indent void
 * helyén a bracket anyagából "befelé álló fülek" maradnak. A 4 fülön 1-1 db Ø5.1
 * menetes-szár furat (47.14 pattern).
 * @param withCutout ha true, a NEMA 23 indented silhouette mint hole bekerül a
 *   Shape-be, és a 4 menetes-szár furat is hozzáadódik.
 */
function buildPlateShape(withCutout: boolean): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-PLATE_W / 2, -PLATE_H / 2)
  shape.lineTo(+PLATE_W / 2, -PLATE_H / 2)
  shape.lineTo(+PLATE_W / 2, +PLATE_H / 2)
  shape.lineTo(-PLATE_W / 2, +PLATE_H / 2)
  shape.closePath()

  if (withCutout) {
    shape.holes.push(buildNema23IndentedHolePath(0, CUTOUT_CY))
    addNema23BoltHoles(shape, 0, CUTOUT_CY)
  }

  return shape
}

/** ExtrudeGeometry a Shape-ből, középpont az origóban (Z is centered). */
function buildPlateGeometry(withCutout: boolean): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildPlateShape(withCutout), {
    depth: PLATE_T,
    bevelEnabled: false,
    curveSegments: 48,
  })
  geom.translate(0, 0, -PLATE_T / 2)
  return geom
}

/** Realisztikus: alumínium lemez sarok-indent NEMA 23 cutout-tal és a 4 befelé
 *  álló fülön 1-1 Ø5.1 menetes-szár furattal.
 *
 * A motor rögzítése külön komponensként valósul meg (`menetes-szar-szerelveny-1`):
 * 4 db M5 menetes szár halad át a bracket füleinek Ø5.1 furatain ÉS a motor
 * mounting flange Ø5.1 furatain — mindkét oldalon anyával fixálva mind a motoron,
 * mind a lemezen.
 */
export function VerticalBracket1Realistic({ componentId }: PartBuilderProps) {
  const mat = useAluminumMaterial()
  const geom = useMemo(() => buildPlateGeometry(true), [])
  useEffect(() => () => geom.dispose(), [geom])
  return <mesh material={mat} geometry={geom} userData={{ componentId }} />
}

/** Medium: ugyanaz mint realistic — a cutout a meghatározó vizuális elem. */
export function VerticalBracket1Medium({ componentId }: PartBuilderProps) {
  const mat = useAluminumMaterial()
  const geom = useMemo(() => buildPlateGeometry(true), [])
  useEffect(() => () => geom.dispose(), [geom])
  return <mesh material={mat} geometry={geom} userData={{ componentId }} />
}

/** Sematikus: tömör lemez (cutout nélkül); a renderer override-olja a regiszter színére. */
export function VerticalBracket1Schematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[PLATE_W, PLATE_H, PLATE_T]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}

export const VERTICAL_BRACKET_1_DIMENSIONS = {
  width: PLATE_W,
  height: PLATE_H,
  thickness: PLATE_T,
  cutoutCenterY: CUTOUT_CY,
}

// ---------------------------------------------------------------------------
// Anchor-export — builder-lokális frame-ben.
// A lemez X-Y síkban van, +Z irányba extrudálva (lemez vastagsága Z mentén).
// A "front face" (cutout-felöli oldal) a builder lokális +Z, a "back face" -Z.
// A 4 fülön található Ø5.1 menetes-szár furat a 47.14 mm pattern szerint.
// ---------------------------------------------------------------------------
const NEMA23_BOLT_PATTERN_HALF = 47.14 / 2

export const VERTICAL_BRACKET_1_ANCHORS: Record<string, Anchor> = {
  origin: {
    position: [0, 0, 0],
    axis: [0, 0, 1],
    description: 'A lemez geometriai középpontja; +Z = "szembenéző" oldal (cutout felöl).',
  },
  'front-face-center': {
    position: [0, CUTOUT_CY, +PLATE_T / 2],
    axis: [0, 0, 1],
    description:
      'A motor cutout középpontja a lemez ELŐLAPJÁN (+Z oldal). A motor mounting flange ide ' +
      'illeszkedik (a flange front-face-e a bracket előlapjához).',
  },
  'back-face-center': {
    position: [0, CUTOUT_CY, -PLATE_T / 2],
    axis: [0, 0, -1],
    description:
      'A motor cutout középpontja a lemez HÁTLAPJÁN (-Z oldal). Innen indulnak a ' +
      'menetes szárak a motor felé.',
  },
  'bolt-1': {
    position: [-NEMA23_BOLT_PATTERN_HALF, CUTOUT_CY - NEMA23_BOLT_PATTERN_HALF, +PLATE_T / 2],
    axis: [0, 0, 1],
    description: '4 db M5 menetes szár furat: bal-alsó (-X, -Y a cutout center-hez képest)',
  },
  'bolt-2': {
    position: [+NEMA23_BOLT_PATTERN_HALF, CUTOUT_CY - NEMA23_BOLT_PATTERN_HALF, +PLATE_T / 2],
    axis: [0, 0, 1],
    description: 'jobb-alsó (+X, -Y)',
  },
  'bolt-3': {
    position: [+NEMA23_BOLT_PATTERN_HALF, CUTOUT_CY + NEMA23_BOLT_PATTERN_HALF, +PLATE_T / 2],
    axis: [0, 0, 1],
    description: 'jobb-felső (+X, +Y)',
  },
  'bolt-4': {
    position: [-NEMA23_BOLT_PATTERN_HALF, CUTOUT_CY + NEMA23_BOLT_PATTERN_HALF, +PLATE_T / 2],
    axis: [0, 0, 1],
    description: 'bal-felső (-X, +Y)',
  },
  'bottom-edge-center': {
    position: [0, -PLATE_H / 2, 0],
    axis: [0, -1, 0],
    description:
      'A lemez ALSÓ élének közepe — itt fekszik az alaplemezre (base). Axis = -Y (lefelé a builder lokálisban).',
  },
}
