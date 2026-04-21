/**
 * Acéltengely (Ø8 mm) — a `pinion-gear-1` (#6) ↔ `bevel-gear-driven-1` (#8)
 * közös függőleges tengelye, amely a `gear-bracket-1` (#16) MINDKÉT arm-ján
 * (felső + alsó) átmegy a Ø8 átmenő furatokon.
 *
 * GEOMETRIA:
 *   - Átmérő: Ø8 mm (a pinion bore és a driven bevel bore névleges átmérője)
 *   - Hossz: a hívó adja meg a regiszterben (`bbox.size[1]`-en keresztül),
 *     mert a tengely a bracket-lokális Y mentén áll, és a hossz a bracket
 *     felső szárának tetején +20 mm-rel kinyúlva, az alsó szár aljánál
 *     végződve = OUTER_HEIGHT_Y + 20 = 76.4 + 20 = 96.4 mm.
 *
 * Builder lokális orientáció:
 *   - +Y = a tengely TENGELYE (függőlegesen). A `cylinderGeometry` default
 *     iránya is +Y, így forgatás NEM kell.
 *   - Origó: a tengely GEOMETRIAI KÖZEPE.
 *
 * A tengely-hossz a `SHAFT_8MM_DIMENSIONS.length`-ben van re-exportálva, és
 * a regiszterben a position.Y-t úgy számoljuk, hogy az alja egybeessen a
 * `gear-bracket-1` aljával (bracket-lokális Y = -OUTER_HEIGHT_Y/2 = -38.2),
 * a teteje pedig 20 mm-rel a bracket teteje felett (+OUTER_HEIGHT_Y/2 + 20 = +58.2).
 *
 * Anyaga: edzett szénacél (sötétebb szürke, magas metalness, alacsony roughness).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

// ---- Méretek ----
const DIAM = 8
const RADIUS = DIAM / 2
/** A tengely teljes hossza (Y mentén). A registry pontos hosszt is megadhat
 *  a `bbox.size[1]`-en keresztül, de a builder ezt használja default-ként. */
const LENGTH = 96.4

/** Chamfer (sarok-letörés) a tengely végein — esztétikai részlet a Realistic
 *  LOD-ban. A chamfer ~0.5 mm magas és Ø7 (Ø8 → Ø7) kúpos szakasz. */
const CHAMFER_HEIGHT = 0.5
const CHAMFER_TOP_R = RADIUS - 0.5

// ---- Material hookok ----

function useSteelMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#cfd2d5',
        metalness: 0.95,
        roughness: 0.18,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

// ---- Re-exportált méretek ----
export const SHAFT_8MM_DIMENSIONS = {
  diameter: DIAM,
  length: LENGTH,
}

// ---- LOD belépési pontok ----

/**
 * Realisztikus: fő henger + 2 chamfer-kúp a végeken (cosmetic).
 */
export function Shaft8mmRealistic({ componentId }: PartBuilderProps) {
  const steelMat = useSteelMaterial()
  const mainBodyHeight = LENGTH - 2 * CHAMFER_HEIGHT

  return (
    <group userData={{ componentId }}>
      {/* Fő szakasz */}
      <mesh material={steelMat} userData={{ componentId }}>
        <cylinderGeometry args={[RADIUS, RADIUS, mainBodyHeight, 24]} />
      </mesh>
      {/* Felső chamfer kúp */}
      <mesh
        position={[0, mainBodyHeight / 2 + CHAMFER_HEIGHT / 2, 0]}
        material={steelMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[CHAMFER_TOP_R, RADIUS, CHAMFER_HEIGHT, 24]} />
      </mesh>
      {/* Alsó chamfer kúp */}
      <mesh
        position={[0, -mainBodyHeight / 2 - CHAMFER_HEIGHT / 2, 0]}
        material={steelMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[RADIUS, CHAMFER_TOP_R, CHAMFER_HEIGHT, 24]} />
      </mesh>
    </group>
  )
}

/**
 * Medium: egyszerű henger chamfer nélkül.
 */
export function Shaft8mmMedium({ componentId }: PartBuilderProps) {
  const steelMat = useSteelMaterial()
  return (
    <mesh material={steelMat} userData={{ componentId }}>
      <cylinderGeometry args={[RADIUS, RADIUS, LENGTH, 16]} />
    </mesh>
  )
}

/**
 * Sematikus: alacsony szegmens-számú henger (renderer override-olja a színt).
 */
export function Shaft8mmSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <cylinderGeometry args={[RADIUS, RADIUS, LENGTH, 12]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
