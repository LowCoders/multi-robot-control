/**
 * Motor mounting rods — 4 db sima M5 henger a NEMA 23 47.14 mm-es furatkiosztásán.
 *
 * Builder lokális orientáció:
 *   - X/Y: a 4 rögzítőfurat négyzetmintája
 *   - Z: a motor tengelyiránya, a szárak hossza
 *   - origó: a motor középpontja
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Anchor, PartBuilderProps } from '../types'
import { NEMA23_BOLT_PATTERN } from './_motorSilhouette'

const ROD_DIAM = 5
const ROD_LENGTH = 120
const Y_MOTOR_ROD_LENGTH = ROD_LENGTH - 30
const ROD_SEGMENTS = 8
const HALF_BP = NEMA23_BOLT_PATTERN / 2
const ROD_OFFSETS: Array<[number, number]> = [
  [-HALF_BP, -HALF_BP],
  [+HALF_BP, -HALF_BP],
  [+HALF_BP, +HALF_BP],
  [-HALF_BP, +HALF_BP],
]

function useRodMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#9a9ca0',
        metalness: 0.85,
        roughness: 0.42,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function RodSet({
  componentId,
  length,
  schematic = false,
}: PartBuilderProps & {
  length: number
  schematic?: boolean
}) {
  const rodMat = useRodMaterial()
  return (
    <group userData={{ componentId }}>
      {ROD_OFFSETS.map(([dx, dy], i) => (
        schematic ? (
          <mesh
            key={i}
            position={[dx, dy, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            userData={{ componentId }}
          >
            <cylinderGeometry args={[ROD_DIAM / 2, ROD_DIAM / 2, length, ROD_SEGMENTS]} />
            <meshStandardMaterial color="#888" />
          </mesh>
        ) : (
          <mesh
            key={i}
            position={[dx, dy, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            material={rodMat}
            userData={{ componentId }}
          >
            <cylinderGeometry args={[ROD_DIAM / 2, ROD_DIAM / 2, length, ROD_SEGMENTS]} />
          </mesh>
        )
      ))}
    </group>
  )
}

export function MountingRodsRealistic({ componentId }: PartBuilderProps) {
  return <RodSet componentId={componentId} length={ROD_LENGTH} />
}

export function MountingRodsMedium({ componentId }: PartBuilderProps) {
  return <RodSet componentId={componentId} length={ROD_LENGTH} />
}

export function MountingRodsSchematic({ componentId }: PartBuilderProps) {
  return <RodSet componentId={componentId} length={ROD_LENGTH} schematic />
}

export function YMotorMountingRodsRealistic({ componentId }: PartBuilderProps) {
  return <RodSet componentId={componentId} length={Y_MOTOR_ROD_LENGTH} />
}

export function YMotorMountingRodsMedium({ componentId }: PartBuilderProps) {
  return <RodSet componentId={componentId} length={Y_MOTOR_ROD_LENGTH} />
}

export function YMotorMountingRodsSchematic({ componentId }: PartBuilderProps) {
  return <RodSet componentId={componentId} length={Y_MOTOR_ROD_LENGTH} schematic />
}

export const MOUNTING_RODS_DIMENSIONS = {
  rodDiam: ROD_DIAM,
  rodLength: ROD_LENGTH,
  numRods: ROD_OFFSETS.length,
}

export const Y_MOTOR_MOUNTING_RODS_DIMENSIONS = {
  rodDiam: ROD_DIAM,
  rodLength: Y_MOTOR_ROD_LENGTH,
  numRods: ROD_OFFSETS.length,
}

function buildMountingRodAnchors(length: number): Record<string, Anchor> {
  return {
    origin: {
      position: [0, 0, 0],
      axis: [0, 0, 1],
      description:
        'A 4 szár közös X-Y középpontja, Z = motor közép. +Z = a motor tengelyiránya.',
    },
    'motor-center': {
      position: [0, 0, 0],
      axis: [0, 0, 1],
      description: 'A motor body középpontja (a 4 szár épp a motor 4 csavar-furatában).',
    },
    'rod-end-back': {
      position: [0, 0, -length / 2],
      axis: [0, 0, -1],
      description: 'A 4 szár közös hátsó vége.',
    },
    'rod-end-front': {
      position: [0, 0, length / 2],
      axis: [0, 0, 1],
      description: 'A 4 szár közös elülső vége.',
    },
  }
}

export const MOUNTING_RODS_ANCHORS: Record<string, Anchor> = buildMountingRodAnchors(ROD_LENGTH)
export const Y_MOTOR_MOUNTING_RODS_ANCHORS: Record<string, Anchor> =
  buildMountingRodAnchors(Y_MOTOR_ROD_LENGTH)
