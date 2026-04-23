/**
 * X-hajtás felső fedőlap — vízszintes alumínium lap a `x-gear-bracket` (#12)
 * felett, a függőleges konzol-bracket-2 (#3) jobb széléhez (max X) illesztve.
 *
 * GEOMETRIA:
 *   - Hossz (parent +X mentén): 236 mm
 *   - Mélység (parent +Y mentén): 80 mm
 *   - Vastagság (parent +Z mentén): 10 mm — a felhasználó által megadott érték.
 *
 * BUILDER LOKÁLIS ORIENTÁCIÓ:
 *   - +X = a lap hossza (az x-hajtás-assembly +X = world +X mentén, a motor
 *     shaft irányába).
 *   - +Y = a lap mélysége (az x-hajtás-assembly +Y = world +Y mentén, oldalra).
 *   - +Z = a lap vastagsága (az x-hajtás-assembly +Z = world +Z mentén, fel).
 *   - Origó: a lap GEOMETRIAI KÖZÉPPONTJA. A bbox így natívan szimmetrikus.
 *
 * ANYAG: alumínium (a `gear-bracket`-tel megegyező matt/anodizált finiselő tónus).
 *
 * Megjegyzés: a registry pozíciója a `BRACKET_2_DX` és `GEAR_BRACKET_DIMENSIONS`
 * konstansokra hivatkozva van számolva, hogy ha a 3-as vagy 12-es elem mérete
 * vagy elhelyezkedése változik, ez a lap automatikusan vele mozog (a min-X és
 * az alja továbbra is illeszkedjen).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

const PLATE_LENGTH_X = 236
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

export const X_DRIVE_TOP_PLATE_DIMENSIONS = {
  lengthX: PLATE_LENGTH_X,
  depthY: PLATE_DEPTH_Y,
  thickness: PLATE_THICKNESS,
}

export function XDriveTopPlateRealistic({ componentId }: PartBuilderProps) {
  const mat = useAluminumMaterial()
  return (
    <mesh material={mat} userData={{ componentId }}>
      <boxGeometry args={[PLATE_LENGTH_X, PLATE_DEPTH_Y, PLATE_THICKNESS]} />
    </mesh>
  )
}

export function XDriveTopPlateMedium(props: PartBuilderProps) {
  return <XDriveTopPlateRealistic {...props} />
}

export function XDriveTopPlateSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[PLATE_LENGTH_X, PLATE_DEPTH_Y, PLATE_THICKNESS]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
