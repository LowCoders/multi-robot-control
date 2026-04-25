/**
 * Z-drive connector plate — 10 mm aluminium adapter between EK20 (#6)
 * and Z gearbox (#20) mounting patterns.
 *
 * Builder lokális orientáció:
 *   - X/Y: lemez síkja, a #6 EK20 alaptól +X irányban a #20 gearbox flange felé
 *   - Z: 10 mm vastagság
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

const THICKNESS_Z = 10

const EK20_WIDTH_X = 95
const EK20_DEPTH_Y = 95
const EK20_HOLE_PATTERN_Y = 75
const EK20_HOLE_DIAM = 6.6
const EK20_NEG_X_TRIM = 55

const GEARBOX_WIDTH = 60
const GEARBOX_HOLE_PATTERN = 47.14
const GEARBOX_HOLE_DIAM = 5.5

// Coordinates are relative to the connector plate origin. The registry places
// that origin in z-drive-assembly space so these pads line up with #6 and #20.
const EK20_CENTER_X = -33.217
const EK20_CENTER_Y = 0.674
const GEARBOX_CENTER_X = 50.718
const GEARBOX_CENTER_Y = 0

const EK20_X_MIN = EK20_CENTER_X - EK20_WIDTH_X / 2 + EK20_NEG_X_TRIM
const EK20_Y_MIN = EK20_CENTER_Y - EK20_DEPTH_Y / 2
const EK20_Y_MAX = EK20_CENTER_Y + EK20_DEPTH_Y / 2
const GEAR_X_MIN = GEARBOX_CENTER_X - GEARBOX_WIDTH / 2
const GEAR_X_MAX = GEARBOX_CENTER_X + GEARBOX_WIDTH / 2
const GEAR_Y_MIN = GEARBOX_CENTER_Y - GEARBOX_WIDTH / 2
const GEAR_Y_MAX = GEARBOX_CENTER_Y + GEARBOX_WIDTH / 2
const EK20_HOLE_CENTER_X = (EK20_X_MIN + GEAR_X_MIN) / 2
const PLATE_Y_MIN = Math.min(EK20_Y_MIN, GEAR_Y_MIN)
const PLATE_Y_MAX = Math.max(EK20_Y_MAX, GEAR_Y_MAX)
const PLATE_X_CENTER = (EK20_X_MIN + GEAR_X_MAX) / 2
const PLATE_Y_CENTER = (PLATE_Y_MIN + PLATE_Y_MAX) / 2

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

function addRoundHole(shape: THREE.Shape, x: number, y: number, diam: number) {
  const hole = new THREE.Path()
  hole.absellipse(x, y, diam / 2, diam / 2, 0, Math.PI * 2, false)
  shape.holes.push(hole)
}

function buildConnectorGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(EK20_X_MIN, EK20_Y_MIN)
  shape.lineTo(GEAR_X_MIN, EK20_Y_MIN)
  shape.lineTo(GEAR_X_MIN, GEAR_Y_MIN)
  shape.lineTo(GEAR_X_MAX, GEAR_Y_MIN)
  shape.lineTo(GEAR_X_MAX, GEAR_Y_MAX)
  shape.lineTo(GEAR_X_MIN, GEAR_Y_MAX)
  shape.lineTo(GEAR_X_MIN, EK20_Y_MAX)
  shape.lineTo(EK20_X_MIN, EK20_Y_MAX)
  shape.closePath()

  for (const y of [
    EK20_CENTER_Y - EK20_HOLE_PATTERN_Y / 2,
    EK20_CENTER_Y + EK20_HOLE_PATTERN_Y / 2,
  ]) {
    addRoundHole(shape, EK20_HOLE_CENTER_X, y, EK20_HOLE_DIAM)
  }

  const halfGearPattern = GEARBOX_HOLE_PATTERN / 2
  for (const x of [GEARBOX_CENTER_X - halfGearPattern, GEARBOX_CENTER_X + halfGearPattern]) {
    for (const y of [GEARBOX_CENTER_Y - halfGearPattern, GEARBOX_CENTER_Y + halfGearPattern]) {
      addRoundHole(shape, x, y, GEARBOX_HOLE_DIAM)
    }
  }

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: THICKNESS_Z,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geom.translate(0, 0, -THICKNESS_Z / 2)
  geom.computeVertexNormals()
  return geom
}

export const Z_DRIVE_CONNECTOR_PLATE_DIMENSIONS = {
  widthX: GEAR_X_MAX - EK20_X_MIN,
  depthY: PLATE_Y_MAX - PLATE_Y_MIN,
  thicknessZ: THICKNESS_Z,
  trimmedFromNegX: EK20_NEG_X_TRIM,
  ek20HoleDiam: EK20_HOLE_DIAM,
  gearboxHoleDiam: GEARBOX_HOLE_DIAM,
}

export function ZDriveConnectorPlateRealistic({ componentId }: PartBuilderProps) {
  const mat = useAluminumMaterial()
  const geom = useMemo(() => buildConnectorGeometry(), [])
  useEffect(() => () => geom.dispose(), [geom])
  return <mesh geometry={geom} material={mat} userData={{ componentId }} />
}

export function ZDriveConnectorPlateMedium({ componentId }: PartBuilderProps) {
  return <ZDriveConnectorPlateRealistic componentId={componentId} />
}

export function ZDriveConnectorPlateSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh position={[PLATE_X_CENTER, PLATE_Y_CENTER, 0]} userData={{ componentId }}>
      <boxGeometry
        args={[
          Z_DRIVE_CONNECTOR_PLATE_DIMENSIONS.widthX,
          Z_DRIVE_CONNECTOR_PLATE_DIMENSIONS.depthY,
          THICKNESS_Z,
        ]}
      />
      <meshStandardMaterial color="#9aa1aa" />
    </mesh>
  )
}
