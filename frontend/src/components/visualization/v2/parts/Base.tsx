/**
 * Alap (váz-talp) — a csőhajlító keretének alaplemeze. Z-up natív.
 *   - +X = csőelőtolás (HOSSZ 600 mm), +Y = operátor felé (MÉLY 200 mm), +Z = fel (VASTAG 8 mm)
 *   - Origó = lemez geometriai közepe; a lemez teteje a lokális Z = +H/2 síkon.
 *
 * Anchorok: `top-center`, `top-{front,back,left,right}-center` általános talp-pontokhoz
 * + 4 szerelvény-mount (`top-bracket-1`, `top-tengely-axis`, `top-tensioner`, `top-z-drive`),
 * amelyek a 7 top-level assembly-nek adnak datum-pontokat. A pozíciók a Base lokálisban
 * megadva → egy helyen hangolható az egész layout.
 */
import type { PartBuilderProps, Anchor } from '../types'

const LENGTH_X = 600
const DEPTH_Y = 200
const HEIGHT_Z = 8

/** Realisztikus: alaplemez + 4 láb. Lábak Z-tengely körül állnak (függőlegesen). */
export function BaseRealistic({ componentId }: PartBuilderProps) {
  const footR = 12
  const footH = 18
  const offX = LENGTH_X / 2 - 30
  const offY = DEPTH_Y / 2 - 30
  const zFoot = -HEIGHT_Z / 2 - footH / 2

  return (
    <group userData={{ componentId }}>
      <mesh userData={{ componentId }}>
        <boxGeometry args={[LENGTH_X, DEPTH_Y, HEIGHT_Z]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.9} roughness={0.35} />
      </mesh>
      {[
        [+offX, +offY],
        [+offX, -offY],
        [-offX, +offY],
        [-offX, -offY],
      ].map((corner, i) => {
        const x = corner[0]!
        const y = corner[1]!
        return (
          // A cylinderGeometry default tengelye +Y; X körüli +π/2 forgatás → +Z.
          <mesh
            key={i}
            position={[x, y, zFoot]}
            rotation={[Math.PI / 2, 0, 0]}
            userData={{ componentId }}
          >
            <cylinderGeometry args={[footR, footR * 1.2, footH, 16]} />
            <meshStandardMaterial color="#1f1f1f" metalness={0.8} roughness={0.5} />
          </mesh>
        )
      })}
    </group>
  )
}

/** Medium: alaplemez + 4 egyszerű láb. */
export function BaseMedium({ componentId }: PartBuilderProps) {
  const footR = 10
  const footH = 14
  const offX = LENGTH_X / 2 - 30
  const offY = DEPTH_Y / 2 - 30
  const zFoot = -HEIGHT_Z / 2 - footH / 2
  return (
    <group userData={{ componentId }}>
      <mesh userData={{ componentId }}>
        <boxGeometry args={[LENGTH_X, DEPTH_Y, HEIGHT_Z]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.85} roughness={0.4} />
      </mesh>
      {[
        [+offX, +offY],
        [+offX, -offY],
        [-offX, +offY],
        [-offX, -offY],
      ].map((corner, i) => {
        const x = corner[0]!
        const y = corner[1]!
        return (
          <mesh
            key={i}
            position={[x, y, zFoot]}
            rotation={[Math.PI / 2, 0, 0]}
            userData={{ componentId }}
          >
            <cylinderGeometry args={[footR, footR, footH, 12]} />
            <meshStandardMaterial color="#222" metalness={0.7} roughness={0.5} />
          </mesh>
        )
      })}
    </group>
  )
}

/** Sematikus: csak egy színes doboz (a renderer override-olja a regiszter színére). */
export function BaseSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[LENGTH_X, DEPTH_Y, HEIGHT_Z]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}

export const BASE_DIMENSIONS = {
  /** X tengely menti hossz (mm). */
  length: LENGTH_X,
  /** Y tengely menti mélység (mm). */
  depth: DEPTH_Y,
  /** Z tengely menti vastagság (mm). */
  height: HEIGHT_Z,
}

export const BASE_ANCHORS: Record<string, Anchor> = {
  origin: { position: [0, 0, 0], axis: [0, 0, 1], description: 'Geometriai közép' },
  'top-center': {
    position: [0, 0, +HEIGHT_Z / 2],
    axis: [0, 0, 1],
    description: 'Felső lap közepe (normál +Z)',
  },
  'bottom-center': {
    position: [0, 0, -HEIGHT_Z / 2],
    axis: [0, 0, -1],
    description: 'Alsó lap közepe',
  },
  'top-front-center': {
    position: [0, +DEPTH_Y / 2, +HEIGHT_Z / 2],
    axis: [0, 0, 1],
    description: 'Felső lap operátor felőli él közepe',
  },
  'top-back-center': {
    position: [0, -DEPTH_Y / 2, +HEIGHT_Z / 2],
    axis: [0, 0, 1],
    description: 'Felső lap operátortól távoli él közepe',
  },
  'top-right-center': {
    position: [+LENGTH_X / 2, 0, +HEIGHT_Z / 2],
    axis: [0, 0, 1],
    description: 'Felső lap +X éle közepe',
  },
  'top-left-center': {
    position: [-LENGTH_X / 2, 0, +HEIGHT_Z / 2],
    axis: [0, 0, 1],
    description: 'Felső lap -X éle közepe',
  },

  // ---- 7 új top-level szerelvény datum-pontjai (Phase 4 refaktor) ----
  // Egy helyen hangolható: ezeknek a pozícióit állítgatva mozdul az egész szerelvény.

  /** Konzol-szerelvény: bracket-1 sandwich elhelyezése a base tetején, +X felé eltolva. */
  'top-bracket-1': {
    position: [+150, 0, +HEIGHT_Z / 2],
    axis: [0, 0, 1],
    description: 'Konzol assembly mount pontja: konzol +Z = vertikális',
  },
  /** Tengely-csoport: a forgó csőtengely-szerelvény. Axis = +Y → a tengely operátor felé.
   *  X = SHF20 helye a base hosszán; Z = bore-tengely magassága a base tetejétől. */
  'top-tengely-axis': {
    position: [+150, -DEPTH_Y / 2 + 30, +HEIGHT_Z / 2 + 100],
    axis: [0, 1, 0],
    description: 'Tengely (központi forgó) datum: bore-tengely +Y irányba',
  },
  /** Feszítő (U-groove görgő) helye — preview-shelf, később hangolható. */
  'top-tensioner': {
    position: [-140, +HEIGHT_Z / 2 + 100, +HEIGHT_Z / 2 + 100],
    axis: [0, 1, 0],
    description: 'Feszítő görgő datum: bore +Y operátor felé',
  },
  /** Z-hajtás (gearbox + Z motor) helye a base tetején. */
  'top-z-drive': {
    position: [-200, 0, +HEIGHT_Z / 2],
    axis: [0, 0, 1],
    description: 'Z-hajtás datum: gearbox output +Z (felfelé)',
  },
  /** Y-hajtás (HTD pulley pár) helye — preview, külön motor még nincs definiálva. */
  'top-y-drive': {
    position: [-100, +60, +HEIGHT_Z / 2 + 80],
    axis: [0, 0, 1],
    description: 'Y-hajtás datum: pulley pár preview-pozíciója',
  },
}
