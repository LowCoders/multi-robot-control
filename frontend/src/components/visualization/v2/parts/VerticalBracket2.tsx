/**
 * Függőleges konzol 2 — alumínium hátsó tartólemez a NEMA 23 motor hátlapjához.
 *
 * Geometria (mm):
 *   - Lemez: szélesség 80 (X), magasság 200 (Y), vastagság 10 (Z) — builder lokális koords.
 *     (Ugyanaz a befoglaló méret, mint a `függőleges konzol 1`.)
 *   - Anyag: alumínium (PBR look, világos ezüst-szürke).
 *   - A lemez +Z oldalán (szembe a motorral, +X world irányba a regiszter rotációja után)
 *     **4 mm mélységű ZSEB** (pocket / area-clean toolpath) van marva a NEMA 23 motor body
 *     SAROK-INDENT + FILLET silhouette-jével (R=4 indent + R=2 fillet + 1 mm outward
 *     offset, ugyanaz a profil mint a motor iron body main / cover szakaszán).
 *     A zseb a motor hátlapjának befogadására szolgál: a motor back face a zseb fenekére
 *     fekszik fel.
 *   - A 4 db Ø5.1 mm-es ÁTMENŐ furat a 47.14 mm pattern szerint elhelyezve, a `menetes-
 *     szar-szerelveny-1` 4 db M5 menetes szárai részére. A furatok a teljes 10 mm
 *     vastagságon átmennek, de FIZIKAILAG csak a hátsó 6 mm-es tömör szakaszon van
 *     anyag — a zseb területén (front 4 mm) a furatpozíciók az indent-void területén
 *     belül vannak (a 47.14 csavar-pattern + 1 mm outward-offset miatt), így ott
 *     anyag nélkül "magától" áthaladnak a szárak.
 *
 * Implementáció: két különálló ExtrudeGeometry, mert a keresztmetszet a vastagság
 * mentén változik:
 *   1. **Hátsó szakasz** (depth = 6 mm, builder Z = -5 .. +1):
 *      teljes 80×200 téglalap + 4 db Ø5.1 furat (47.14 pattern, középpont (0, +50)).
 *   2. **Elülső szakasz / pereme** (depth = 4 mm, builder Z = +1 .. +5):
 *      teljes 80×200 téglalap MÍNUSZ a motor body sarok-indent silhouette = a zseb
 *      körüli "rim" anyag. Bolt-furatok ide nem kellenek (a 4 furatpozíció a zseb
 *      voidjában esik).
 *
 * Forgatás: a regiszterben transform.rotation = [0, +π/2, 0] forgatja úgy, hogy a
 * lemez zsebes oldala (+Z builder) a világ +X irányba nézzen — vagyis a motor felé.
 *
 * Pozicionálás: a regiszterben olyan world X-en van, hogy a zseb feneke pontosan a
 * motor hátlapjához érjen. Lásd a `componentRegistry.ts`-ben a számítást.
 *
 * Megjegyzés a kábelbevezetőről: a motor tetején, a hátlaptól induló (32 mm hosszú,
 * 13 mm magas) cable-exit unit a zseb +X-irányú nyitott peremén kívül helyezkedik el
 * (mert a zseb mélysége csak 4 mm, a kábelbevezető pedig 32 mm hosszan a motor body
 * tetején fekszik a +X irányba). Az első ~4 mm-en azonban átfedés lehet a bracket-2
 * elülső peremével a body-tetőn — ez egy ismert geometriai konfliktus, melyet a
 * jövőben vagy a kábelbevezető áthelyezésével, vagy a zseb top-edge kiterjesztésével
 * lehet kezelni.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'
import {
  addNema23BoltHoles,
  buildNema23IndentedHolePath,
} from './_motorSilhouette'

const PLATE_W = 80
const PLATE_H = 200
const PLATE_T = 10

/** A zseb középpontja a lemez lokális koordinátáiban (50 mm-rel a tetejétől lefelé,
 *  ugyanaz mint a `függőleges konzol 1` cutout-jánál). */
const POCKET_CY = 50

/** Zseb mélysége (area clean toolpath, mm). */
const POCKET_DEPTH = 4

/** Hátsó tömör szakasz vastagsága (mm). */
const BACK_THICKNESS = PLATE_T - POCKET_DEPTH // = 6

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

/** Hátsó (tömör) szakasz Shape-je: teljes téglalap + 4 db Ø5.1 átmenő furat. */
function buildBackShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-PLATE_W / 2, -PLATE_H / 2)
  shape.lineTo(+PLATE_W / 2, -PLATE_H / 2)
  shape.lineTo(+PLATE_W / 2, +PLATE_H / 2)
  shape.lineTo(-PLATE_W / 2, +PLATE_H / 2)
  shape.closePath()
  addNema23BoltHoles(shape, 0, POCKET_CY)
  return shape
}

/** Elülső (perem) szakasz Shape-je: teljes téglalap MÍNUSZ motor body silhouette. */
function buildFrontShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-PLATE_W / 2, -PLATE_H / 2)
  shape.lineTo(+PLATE_W / 2, -PLATE_H / 2)
  shape.lineTo(+PLATE_W / 2, +PLATE_H / 2)
  shape.lineTo(-PLATE_W / 2, +PLATE_H / 2)
  shape.closePath()
  shape.holes.push(buildNema23IndentedHolePath(0, POCKET_CY))
  return shape
}

/** Hátsó szakasz extrúziós geometriája: depth=6, builder Z = -5 .. +1. */
function buildBackGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildBackShape(), {
    depth: BACK_THICKNESS,
    bevelEnabled: false,
    curveSegments: 48,
  })
  // ExtrudeGeometry alapból Z=0..+depth között tol — toljuk a Z = -PLATE_T/2 .. -PLATE_T/2+depth tartományba.
  geom.translate(0, 0, -PLATE_T / 2)
  return geom
}

/** Elülső (perem) szakasz extrúziós geometriája: depth=4, builder Z = +1 .. +5. */
function buildFrontGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildFrontShape(), {
    depth: POCKET_DEPTH,
    bevelEnabled: false,
    curveSegments: 48,
  })
  // Z = (back-of-plate + back-thickness) .. (back-of-plate + plate-thickness) = -5+6 .. -5+10 = +1 .. +5.
  geom.translate(0, 0, -PLATE_T / 2 + BACK_THICKNESS)
  return geom
}

/** Realisztikus: 2-mesh implementáció (hátsó tömör + elülső perem), zsebbel és
 *  4 db Ø5.1 átmenő furattal. */
export function VerticalBracket2Realistic({ componentId }: PartBuilderProps) {
  const mat = useAluminumMaterial()
  const backGeom = useMemo(() => buildBackGeometry(), [])
  const frontGeom = useMemo(() => buildFrontGeometry(), [])
  useEffect(() => () => backGeom.dispose(), [backGeom])
  useEffect(() => () => frontGeom.dispose(), [frontGeom])
  return (
    <group userData={{ componentId }}>
      <mesh material={mat} geometry={backGeom} userData={{ componentId }} />
      <mesh material={mat} geometry={frontGeom} userData={{ componentId }} />
    </group>
  )
}

/** Medium: ugyanaz mint realistic (a zseb és a furatok a meghatározó vizuális elemek). */
export function VerticalBracket2Medium({ componentId }: PartBuilderProps) {
  return <VerticalBracket2Realistic componentId={componentId} />
}

/** Sematikus: tömör lemez (zseb és furatok nélkül); a renderer override-olja a
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
  pocketCenterY: POCKET_CY,
  pocketDepth: POCKET_DEPTH,
  backThickness: BACK_THICKNESS,
}
