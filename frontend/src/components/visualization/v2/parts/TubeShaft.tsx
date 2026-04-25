/**
 * Csőtengely (üreges acéltengely) — a Spindle (`spindle-assembly`) belső
 * csöve, amely a hajlító forgótengelyhez tartozik.
 *
 * GEOMETRIA:
 *   - Külső átmérő: Ø20 mm
 *   - Furat (bore) átmérő: Ø14 mm  (falvastagság 3 mm)
 *   - Hossz: 180 mm
 *
 * A felhasználói kérés szerint a csőtengely **világ +X irányba áll**. A builder
 * (a `Shaft8mm` konvencióját követve) belsőleg +Y mentén áll (a Three.js
 * `cylinderGeometry` / `latheGeometry` default tengelye is +Y), és a regiszter
 * `transform.rotation = [0, 0, -π/2]` forgatja a builder +Y-t a világ +X-re.
 *
 * RENDERELÉS:
 *   - Realistic / Medium: `LatheGeometry`-vel egy üreges hengert rajzolunk
 *     egyetlen, watertight surface-ből (külső plást + két véglap (annulus) +
 *     belső bore plást). A `LatheGeometry` egy 2D profil-poligont rotál a +Y
 *     tengely körül; az alábbi 5 pontos profil pontosan a csőfal körüli
 *     téglalap, és a kezdő/végpont egybeesése zárt felületet ad.
 *   - Schematic: tömör (nem üreges) hengerre fallback-elünk — alacsony
 *     LOD-on a bore amúgy sem látszana, viszont a `cylinderGeometry`
 *     gyorsabb és nem igényel két oldalas (DoubleSide) anyagot.
 *
 * ANYAG: edzett szénacél (sötétebb, mint a Shaft8mm — a csőtengely tipikusan
 * felülettkezelt / fekete-oxidált a hosszanti kopásállósághoz).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

// ---- Méretek ----
const OUTER_DIAM = 20
const INNER_DIAM = 14
const OUTER_R = OUTER_DIAM / 2
const INNER_R = INNER_DIAM / 2
const LENGTH = 180

// Kerületi felbontás (radial segments). Realistic szinten egy ~Ø20 mm-es csövön
// 32 szegmens már sima kerületet ad; medium-on kevesebb is elég.
const RADIAL_SEGMENTS_REALISTIC = 32
const RADIAL_SEGMENTS_MEDIUM = 20
const RADIAL_SEGMENTS_SCHEMATIC = 12

// Chamfer (sarok-letörés) a tengely külső peremén — esztétikai részlet a
// realistic LOD-on. A `LatheGeometry` profilja egy plusz pontot kap a két
// véglap mentén, így a külső átmérő finoman lekerekedik az élen.
const CHAMFER = 0.5

// ---- Material ----

/**
 * Edzett szénacél anyag. `DoubleSide`-on rendereljük, mert a `LatheGeometry`
 * profilja a téglalap körül forog → a belső bore felület normálja a tengely
 * felé néz, ami a default front-side renderben a kameráról nézve "üres"
 * lenne, ha a kamera a bore-on belülre kerülne. A DoubleSide robusztusabb,
 * a perf-veszteség elhanyagolható (egy alkatrész).
 */
function useTubeShaftMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#9ea3a8',
        metalness: 0.9,
        roughness: 0.28,
        side: THREE.DoubleSide,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

// ---- Lathe profil ----

/**
 * Profil-pontok (2D, X = sugár, Y = hossz mentén). Sorrend KW (kívülről nézve
 * az óramutató irányába), a pontokat a `LatheGeometry` +Y körül rotálja.
 *
 *   p1 (innerR, -L/2)  →  p2 (outerR, -L/2)   alsó véglap (annulus)
 *   p2                 →  p3 (outerR, +L/2)   külső plást
 *   p3                 →  p4 (innerR, +L/2)   felső véglap (annulus)
 *   p4                 →  p1                  belső bore plást
 *
 * Ha `withChamfer = true`, a két felső sarokra (külső él) egy plusz pontot
 * teszünk be (45°-os letörés CHAMFER mm hosszan / mélyen).
 */
function makeLatheProfile(withChamfer: boolean): THREE.Vector2[] {
  const half = LENGTH / 2
  if (!withChamfer) {
    return [
      new THREE.Vector2(INNER_R, -half),
      new THREE.Vector2(OUTER_R, -half),
      new THREE.Vector2(OUTER_R, +half),
      new THREE.Vector2(INNER_R, +half),
      new THREE.Vector2(INNER_R, -half), // close
    ]
  }
  // Chamferes verzió — a külső élek 45°-ban letörve.
  return [
    new THREE.Vector2(INNER_R, -half),
    new THREE.Vector2(OUTER_R - CHAMFER, -half),
    new THREE.Vector2(OUTER_R, -half + CHAMFER),
    new THREE.Vector2(OUTER_R, +half - CHAMFER),
    new THREE.Vector2(OUTER_R - CHAMFER, +half),
    new THREE.Vector2(INNER_R, +half),
    new THREE.Vector2(INNER_R, -half), // close
  ]
}

// ---- Re-exportált méretek (registry / mérnöki használathoz) ----
export const TUBE_SHAFT_DIMENSIONS = {
  outerDiameter: OUTER_DIAM,
  innerDiameter: INNER_DIAM,
  length: LENGTH,
}

// ---- LOD belépési pontok ----

/**
 * Realisztikus: chamferes profilú lathe — finom külső él-letöréssel.
 */
export function TubeShaftRealistic({ componentId }: PartBuilderProps) {
  const mat = useTubeShaftMaterial()
  const geom = useMemo(
    () => new THREE.LatheGeometry(makeLatheProfile(true), RADIAL_SEGMENTS_REALISTIC),
    [],
  )
  useEffect(() => () => geom.dispose(), [geom])
  return (
    <mesh geometry={geom} material={mat} userData={{ componentId }} />
  )
}

/**
 * Medium: chamfer nélküli lathe — egyszerűbb profil, kevesebb szegmens.
 */
export function TubeShaftMedium({ componentId }: PartBuilderProps) {
  const mat = useTubeShaftMaterial()
  const geom = useMemo(
    () => new THREE.LatheGeometry(makeLatheProfile(false), RADIAL_SEGMENTS_MEDIUM),
    [],
  )
  useEffect(() => () => geom.dispose(), [geom])
  return (
    <mesh geometry={geom} material={mat} userData={{ componentId }} />
  )
}

/**
 * Sematikus: TÖMÖR (nem üreges) henger — a bore alacsony LOD-on amúgy sem
 * látszana, viszont a `cylinderGeometry` gyorsabb és a renderer a színt
 * felülírja a regiszterre.
 */
export function TubeShaftSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <cylinderGeometry args={[OUTER_R, OUTER_R, LENGTH, RADIAL_SEGMENTS_SCHEMATIC]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
