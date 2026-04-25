/**
 * X-hajtás alsó fedőlap — vízszintes alumínium lap a `x-gear-bracket` (#12)
 * ALATT, a felső fedőlap (#24) tükörképe.
 *
 * Külön builder a `XDriveTopPlate`-től, mert a tervezett későbbi
 * átalakítások (pl. furatminta a base lemez M5 csavarjaihoz, kivágás a
 * mounting-rods számára, anyagvastagság-finomhangolás) függetlenek
 * lesznek a felső lap geometriájától.
 *
 * GEOMETRIA:
 *   - Hossz (parent +X mentén): 60 mm
 *   - Mélység (parent +Y mentén): 60 mm
 *   - Vastagság (parent +Z mentén): 10 mm
 *
 * BUILDER LOKÁLIS ORIENTÁCIÓ:
 *   - +X = a lap hossza
 *   - +Y = a lap mélysége
 *   - +Z = a lap vastagsága (felfelé az alsó síktól)
 *   - Origó: a lap GEOMETRIAI KÖZÉPPONTJA. A bbox így natívan szimmetrikus.
 *
 * ANYAG: alumínium (a felső lapéval megegyező matt/anodizált tónus, hogy a
 * két lap vizuálisan a gear-bracket-tel sandwich-szerkezetet alkosson).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

const PLATE_LENGTH_X = 60
const PLATE_DEPTH_Y = 60
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

export const X_DRIVE_BOTTOM_PLATE_DIMENSIONS = {
  lengthX: PLATE_LENGTH_X,
  depthY: PLATE_DEPTH_Y,
  thickness: PLATE_THICKNESS,
}

export function XDriveBottomPlateRealistic({ componentId }: PartBuilderProps) {
  const mat = useAluminumMaterial()
  return (
    <mesh material={mat} userData={{ componentId }}>
      <boxGeometry args={[PLATE_LENGTH_X, PLATE_DEPTH_Y, PLATE_THICKNESS]} />
    </mesh>
  )
}

export function XDriveBottomPlateMedium(props: PartBuilderProps) {
  return <XDriveBottomPlateRealistic {...props} />
}

export function XDriveBottomPlateSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[PLATE_LENGTH_X, PLATE_DEPTH_Y, PLATE_THICKNESS]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
