/**
 * Alap (váz-talp) — a csőhajlító keretének alaplemeze.
 *
 * Méretek (mm):
 *   hossz X = 600, szélesség Z = 200, magasság Y = 8 (vékony alaplemez).
 *
 * A komponens lokális koordinátái: [0,0,0] az alap KÖZÉPPONTJA.
 * A regiszterben a transform.position adja meg a globális helyet.
 */
import type { PartBuilderProps } from '../types'

const LENGTH = 600
const HEIGHT = 8
const WIDTH = 200

/** Realisztikus: alaplemez + perem-élek + 4 láb. */
export function BaseRealistic({ componentId }: PartBuilderProps) {
  const footR = 12
  const footH = 18
  const offX = LENGTH / 2 - 30
  const offZ = WIDTH / 2 - 30
  const yFoot = -HEIGHT / 2 - footH / 2

  return (
    <group userData={{ componentId }}>
      <mesh userData={{ componentId }}>
        <boxGeometry args={[LENGTH, HEIGHT, WIDTH]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.9} roughness={0.35} />
      </mesh>
      {[
        [+offX, +offZ],
        [+offX, -offZ],
        [-offX, +offZ],
        [-offX, -offZ],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, yFoot, z]} userData={{ componentId }}>
          <cylinderGeometry args={[footR, footR * 1.2, footH, 16]} />
          <meshStandardMaterial color="#1f1f1f" metalness={0.8} roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

/** Medium: alaplemez + 4 egyszerű láb (henger). */
export function BaseMedium({ componentId }: PartBuilderProps) {
  const footR = 10
  const footH = 14
  const offX = LENGTH / 2 - 30
  const offZ = WIDTH / 2 - 30
  const yFoot = -HEIGHT / 2 - footH / 2
  return (
    <group userData={{ componentId }}>
      <mesh userData={{ componentId }}>
        <boxGeometry args={[LENGTH, HEIGHT, WIDTH]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.85} roughness={0.4} />
      </mesh>
      {[
        [+offX, +offZ],
        [+offX, -offZ],
        [-offX, +offZ],
        [-offX, -offZ],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, yFoot, z]} userData={{ componentId }}>
          <cylinderGeometry args={[footR, footR, footH, 12]} />
          <meshStandardMaterial color="#222" metalness={0.7} roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

/** Sematikus: csak egy színes doboz (a renderer override-olja a regiszter színére). */
export function BaseSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[LENGTH, HEIGHT, WIDTH]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}

export const BASE_DIMENSIONS = { length: LENGTH, height: HEIGHT, width: WIDTH }
