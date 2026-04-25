/**
 * M8 rod — Ø8 mm vertical steel rod rendered as a plain cylinder.
 *
 * Builder lokális orientáció:
 *   - Z: a menetes szár hossztengelye
 *   - X/Y: Ø8 mm átmérő
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

const DIAM = 8
const RADIUS = DIAM / 2
const LENGTH = 190
const RADIAL_SEGMENTS = 12

function useSteelMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#b8bcc2',
        metalness: 0.9,
        roughness: 0.22,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

export const THREADED_ROD_8X120_DIMENSIONS = {
  diameter: DIAM,
  length: LENGTH,
}

function SmoothRod({ componentId }: PartBuilderProps) {
  const mat = useSteelMaterial()
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} material={mat} userData={{ componentId }}>
      <cylinderGeometry args={[RADIUS, RADIUS, LENGTH, RADIAL_SEGMENTS]} />
    </mesh>
  )
}

export function ThreadedRod8x120Realistic({ componentId }: PartBuilderProps) {
  return <SmoothRod componentId={componentId} />
}

export function ThreadedRod8x120Medium({ componentId }: PartBuilderProps) {
  return <SmoothRod componentId={componentId} />
}

export function ThreadedRod8x120Schematic({ componentId }: PartBuilderProps) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} userData={{ componentId }}>
      <cylinderGeometry args={[RADIUS, RADIUS, LENGTH, RADIAL_SEGMENTS]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
