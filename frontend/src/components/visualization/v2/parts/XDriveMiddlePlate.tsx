/**
 * X-hajtás középső fedőlap — az `x-drive-bottom-plate` másolata,
 * attól 30 mm-rel feljebb elhelyezve a bracket assembly-ben.
 *
 * GEOMETRIA:
 *   - Hossz (parent +X mentén): 70 mm
 *   - Mélység (parent +Y mentén): 80 mm
 *   - Vastagság (parent +Z mentén): 10 mm
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

const PLATE_LENGTH_X = 70
const PLATE_DEPTH_Y = 80
const PLATE_THICKNESS = 10

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

export const X_DRIVE_MIDDLE_PLATE_DIMENSIONS = {
  lengthX: PLATE_LENGTH_X,
  depthY: PLATE_DEPTH_Y,
  thickness: PLATE_THICKNESS,
}

export function XDriveMiddlePlateRealistic({ componentId }: PartBuilderProps) {
  const mat = useAluminumMaterial()
  return (
    <mesh material={mat} userData={{ componentId }}>
      <boxGeometry args={[PLATE_LENGTH_X, PLATE_DEPTH_Y, PLATE_THICKNESS]} />
    </mesh>
  )
}

export function XDriveMiddlePlateMedium(props: PartBuilderProps) {
  return <XDriveMiddlePlateRealistic {...props} />
}

export function XDriveMiddlePlateSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[PLATE_LENGTH_X, PLATE_DEPTH_Y, PLATE_THICKNESS]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
