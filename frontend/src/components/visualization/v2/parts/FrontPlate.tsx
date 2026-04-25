/**
 * Konzol előlap — függőleges alumínium zárólemez a Bracket assembly-ben.
 *
 * Geometria (mm):
 *   - Szélesség: 100 (builder +X)
 *   - Magasság: 80 (builder +Z)
 *   - Vastagság: 10 (builder +Y)
 *   - Origó: geometriai középpont.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

const PLATE_WIDTH_X = 80
const PLATE_THICKNESS_Y = 10
const PLATE_HEIGHT_Z = 80

function useAluminumMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#aab0b6',
        metalness: 0.7,
        roughness: 0.4,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

export const FRONT_PLATE_DIMENSIONS = {
  widthX: PLATE_WIDTH_X,
  thicknessY: PLATE_THICKNESS_Y,
  heightZ: PLATE_HEIGHT_Z,
}

export function FrontPlateRealistic({ componentId }: PartBuilderProps) {
  const mat = useAluminumMaterial()
  return (
    <mesh material={mat} userData={{ componentId }}>
      <boxGeometry args={[PLATE_WIDTH_X, PLATE_THICKNESS_Y, PLATE_HEIGHT_Z]} />
    </mesh>
  )
}

export function FrontPlateMedium(props: PartBuilderProps) {
  return <FrontPlateRealistic {...props} />
}

export function FrontPlateSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[PLATE_WIDTH_X, PLATE_THICKNESS_Y, PLATE_HEIGHT_Z]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
