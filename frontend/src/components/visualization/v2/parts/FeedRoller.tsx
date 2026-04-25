/**
 * Üreges henger / távtartó — Ø16 külső, Ø8 belső, 11 mm magas.
 *
 * Builder lokális orientáció:
 *   - +Y = henger tengelye
 *   - Origó = geometriai középpont
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

const OUTER_DIAM = 16
const INNER_DIAM = 8
const HEIGHT = 11

function useSteelMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#b8bcc0',
        metalness: 0.85,
        roughness: 0.28,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function buildHollowCylinderGeometry(): THREE.LatheGeometry {
  const outerR = OUTER_DIAM / 2
  const innerR = INNER_DIAM / 2
  const halfH = HEIGHT / 2
  const profile = [
    new THREE.Vector2(innerR, -halfH),
    new THREE.Vector2(outerR, -halfH),
    new THREE.Vector2(outerR, +halfH),
    new THREE.Vector2(innerR, +halfH),
  ]
  return new THREE.LatheGeometry(profile, 48)
}

export const FEED_ROLLER_DIMENSIONS = {
  outerDiameter: OUTER_DIAM,
  innerDiameter: INNER_DIAM,
  height: HEIGHT,
}

export function FeedRollerRealistic({ componentId }: PartBuilderProps) {
  const mat = useSteelMaterial()
  const geom = useMemo(() => buildHollowCylinderGeometry(), [])
  useEffect(() => () => geom.dispose(), [geom])
  return <mesh material={mat} geometry={geom} userData={{ componentId }} />
}

export function FeedRollerMedium(props: PartBuilderProps) {
  return <FeedRollerRealistic {...props} />
}

export function FeedRollerSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <cylinderGeometry args={[OUTER_DIAM / 2, OUTER_DIAM / 2, HEIGHT, 16]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
