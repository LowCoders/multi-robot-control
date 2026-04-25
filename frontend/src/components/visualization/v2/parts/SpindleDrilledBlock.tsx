/**
 * Spindle drilled block — téglatest több Ø8 átmenő furattal.
 *
 * Builder lokális méretek:
 *   - X: szélesség 42 mm
 *   - Y: hossz 20 mm
 *   - Z: magasság 15 mm
 *
 * Furatozás:
 *   - Ø8 függőleges átmenő furat a top-view középpontban (Z irányban)
 *   - 2 db Ø8 függőleges átmenő furat a hosszabb X oldal két széle felé,
 *     a furat széle 4 mm-re a hasáb szélétől
 *   - Ø8 hosszanti átmenő furat a hosszabb oldalon (X irányban)
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import type { PartBuilderProps } from '../types'

const WIDTH_X = 42
const LENGTH_Y = 20
const HEIGHT_Z = 15
const HOLE_DIAM = 8
const EDGE_HOLE_EDGE_OFFSET = 4
const EDGE_HOLE_CENTER_X = WIDTH_X / 2 - EDGE_HOLE_EDGE_OFFSET - HOLE_DIAM / 2

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

function subtractCutter(
  base: Brush,
  cutterGeometry: THREE.BufferGeometry,
  position: [number, number, number],
  evaluator: Evaluator,
): Brush {
  const cutter = new Brush(cutterGeometry)
  cutter.position.set(...position)
  cutter.updateMatrixWorld()
  return evaluator.evaluate(base, cutter, SUBTRACTION)
}

function buildDrilledBlockGeometry(): THREE.BufferGeometry {
  const evaluator = new Evaluator()
  let result = new Brush(new THREE.BoxGeometry(WIDTH_X, LENGTH_Y, HEIGHT_Z))
  result.updateMatrixWorld()

  const verticalHole = new THREE.CylinderGeometry(HOLE_DIAM / 2, HOLE_DIAM / 2, HEIGHT_Z + 0.4, 32)
  verticalHole.rotateX(Math.PI / 2)
  result = subtractCutter(result, verticalHole, [0, 0, 0], evaluator)
  result.updateMatrixWorld()
  for (const x of [-EDGE_HOLE_CENTER_X, EDGE_HOLE_CENTER_X]) {
    result = subtractCutter(result, verticalHole, [x, 0, 0], evaluator)
    result.updateMatrixWorld()
  }
  verticalHole.dispose()

  const lengthwiseHole = new THREE.CylinderGeometry(HOLE_DIAM / 2, HOLE_DIAM / 2, WIDTH_X + 0.4, 32)
  lengthwiseHole.rotateZ(Math.PI / 2)
  result = subtractCutter(result, lengthwiseHole, [0, 0, 0], evaluator)
  lengthwiseHole.dispose()

  const geom = result.geometry
  geom.computeVertexNormals()
  return geom
}

export const SPINDLE_DRILLED_BLOCK_DIMENSIONS = {
  widthX: WIDTH_X,
  lengthY: LENGTH_Y,
  heightZ: HEIGHT_Z,
  holeDiam: HOLE_DIAM,
  edgeHoleCenterX: EDGE_HOLE_CENTER_X,
  edgeHoleEdgeOffset: EDGE_HOLE_EDGE_OFFSET,
}

export function SpindleDrilledBlockRealistic({ componentId }: PartBuilderProps) {
  const mat = useAluminumMaterial()
  const geom = useMemo(() => buildDrilledBlockGeometry(), [])
  useEffect(() => () => geom.dispose(), [geom])
  return <mesh material={mat} geometry={geom} userData={{ componentId }} />
}

export function SpindleDrilledBlockMedium(props: PartBuilderProps) {
  return <SpindleDrilledBlockRealistic {...props} />
}

export function SpindleDrilledBlockSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[WIDTH_X, LENGTH_Y, HEIGHT_Z]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
