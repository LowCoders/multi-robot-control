/**
 * Spindle rod plate halves — 42 × 90 × 10 mm aluminium plate split lengthwise.
 *
 * Builder lokális orientáció:
 *   - X: 21 mm fél-szélesség
 *   - Y: 90 mm hossz
 *   - Z: 10 mm vastagság
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

const HALF_WIDTH_X = 15
const LENGTH_Y = 90
const THICKNESS_Z = 10
const HOLE_DIAM = 8
const HOLE_EDGE_OFFSET = 4
const TOTAL_HOLE_CENTER_X = HALF_WIDTH_X - HOLE_EDGE_OFFSET - HOLE_DIAM / 2
const HALF_OFFSET_X = HALF_WIDTH_X / 2
const HOLE_CENTER_Y = LENGTH_Y / 2 - HOLE_EDGE_OFFSET - HOLE_DIAM / 2

type PlateSide = 'left' | 'right'

function useAluminumMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#aab0b6',
        metalness: 0.65,
        roughness: 0.38,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function buildPlateGeometry(side: PlateSide): THREE.BufferGeometry {
  const sideSign = side === 'left' ? -1 : 1
  const localHoleX = sideSign * (TOTAL_HOLE_CENTER_X - HALF_OFFSET_X)
  const shape = new THREE.Shape()
  shape.moveTo(-HALF_WIDTH_X / 2, -LENGTH_Y / 2)
  shape.lineTo(HALF_WIDTH_X / 2, -LENGTH_Y / 2)
  shape.lineTo(HALF_WIDTH_X / 2, LENGTH_Y / 2)
  shape.lineTo(-HALF_WIDTH_X / 2, LENGTH_Y / 2)
  shape.lineTo(-HALF_WIDTH_X / 2, -LENGTH_Y / 2)

  for (const y of [-HOLE_CENTER_Y, HOLE_CENTER_Y]) {
    const hole = new THREE.Path()
    hole.absellipse(localHoleX, y, HOLE_DIAM / 2, HOLE_DIAM / 2, 0, Math.PI * 2, false)
    shape.holes.push(hole)
  }

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: THICKNESS_Z,
    bevelEnabled: false,
    curveSegments: 32,
  })
  geom.translate(0, 0, -THICKNESS_Z / 2)
  geom.computeVertexNormals()
  return geom
}

export const SPINDLE_ROD_PLATE_DIMENSIONS = {
  halfWidthX: HALF_WIDTH_X,
  lengthY: LENGTH_Y,
  thicknessZ: THICKNESS_Z,
  holeDiam: HOLE_DIAM,
  totalHoleCenterX: TOTAL_HOLE_CENTER_X,
  halfOffsetX: HALF_OFFSET_X,
  holeCenterY: HOLE_CENTER_Y,
}

function SpindleRodPlateHalf({ componentId, side }: PartBuilderProps & { side: PlateSide }) {
  const mat = useAluminumMaterial()
  const geom = useMemo(() => buildPlateGeometry(side), [side])
  useEffect(() => () => geom.dispose(), [geom])
  return <mesh geometry={geom} material={mat} userData={{ componentId }} />
}

export function SpindleRodPlateLeftRealistic({ componentId }: PartBuilderProps) {
  return <SpindleRodPlateHalf componentId={componentId} side="left" />
}

export function SpindleRodPlateLeftMedium({ componentId }: PartBuilderProps) {
  return <SpindleRodPlateLeftRealistic componentId={componentId} />
}

export function SpindleRodPlateRightRealistic({ componentId }: PartBuilderProps) {
  return <SpindleRodPlateHalf componentId={componentId} side="right" />
}

export function SpindleRodPlateRightMedium({ componentId }: PartBuilderProps) {
  return <SpindleRodPlateRightRealistic componentId={componentId} />
}

function SpindleRodPlateSchematicHalf({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[HALF_WIDTH_X, LENGTH_Y, THICKNESS_Z]} />
      <meshStandardMaterial color="#9aa1aa" />
    </mesh>
  )
}

export function SpindleRodPlateLeftSchematic({ componentId }: PartBuilderProps) {
  return <SpindleRodPlateSchematicHalf componentId={componentId} />
}

export function SpindleRodPlateRightSchematic({ componentId }: PartBuilderProps) {
  return <SpindleRodPlateSchematicHalf componentId={componentId} />
}
