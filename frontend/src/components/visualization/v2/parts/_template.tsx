/**
 * SABLON új alkatrész felviteléhez.
 *
 * Workflow:
 *   1. Másold át a fájlt `parts/<Id>.tsx` néven (camelCase, pl. `ZMotor.tsx`).
 *   2. Olvasd ki a méreteket a `frontend/public/components/tube-bender/<id>/refs/`
 *      alá tett képekből/datasheet-ekből.
 *   3. Implementáld a 3 LOD-szintet (legalább a sematikust mindenképp).
 *   4. Regisztráld a `componentRegistry.ts`-ben a `builders` mezőben.
 *
 * KÖTELEZŐ: minden mesh-nek `userData={{ componentId }}` kell hogy legyen,
 * hogy a táblázat-kattintás és highlight működjön. Group-ra is rátehető;
 * a renderer rekurzívan terjeszti, de explicit jobb.
 *
 * Példa: NEMA 23 szervo motor (57BYG250D, 56.4 x 56.4 x 76 mm, tengely Ø8 x 24).
 * Forrás: public/components/tube-bender/<id>/refs/datasheet.pdf
 *         GrabCAD: https://...
 */
import type { PartBuilderProps } from '../types'

const BODY = 56.4
const LENGTH = 76
const SHAFT_DIAM = 8
const SHAFT_LENGTH = 24
const BOLT_CIRCLE = 47.14
const BOLT_HOLE_DIAM = 5.2

/** Realisztikus: motortest + tengely + 4 furat + tengely-perem (boss). */
export function TemplateRealistic({ componentId }: PartBuilderProps) {
  return (
    <group userData={{ componentId }}>
      <mesh userData={{ componentId }}>
        <boxGeometry args={[BODY, LENGTH, BODY]} />
        <meshStandardMaterial color="#2b2b30" metalness={0.85} roughness={0.3} />
      </mesh>

      <mesh
        position={[0, LENGTH / 2 + 4, 0]}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[14, 14, 8, 24]} />
        <meshStandardMaterial color="#3a3a40" metalness={0.85} roughness={0.3} />
      </mesh>

      <mesh
        position={[0, LENGTH / 2 + 8 + SHAFT_LENGTH / 2, 0]}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[SHAFT_DIAM / 2, SHAFT_DIAM / 2, SHAFT_LENGTH, 16]} />
        <meshStandardMaterial color="#cccccc" metalness={0.95} roughness={0.15} />
      </mesh>

      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4
        const x = (Math.cos(a) * BOLT_CIRCLE) / 2
        const z = (Math.sin(a) * BOLT_CIRCLE) / 2
        return (
          <mesh
            key={i}
            position={[x, LENGTH / 2 + 0.1, z]}
            rotation={[Math.PI / 2, 0, 0]}
            userData={{ componentId }}
          >
            <cylinderGeometry args={[BOLT_HOLE_DIAM / 2, BOLT_HOLE_DIAM / 2, 8, 12]} />
            <meshStandardMaterial color="#101010" metalness={0.5} roughness={0.6} />
          </mesh>
        )
      })}
    </group>
  )
}

/** Medium: motortest + tengely (furatok és perem nélkül). */
export function TemplateMedium({ componentId }: PartBuilderProps) {
  return (
    <group userData={{ componentId }}>
      <mesh userData={{ componentId }}>
        <boxGeometry args={[BODY, LENGTH, BODY]} />
        <meshStandardMaterial color="#2b2b30" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh
        position={[0, LENGTH / 2 + SHAFT_LENGTH / 2 + 4, 0]}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[SHAFT_DIAM / 2, SHAFT_DIAM / 2, SHAFT_LENGTH, 12]} />
        <meshStandardMaterial color="#cccccc" metalness={0.9} roughness={0.2} />
      </mesh>
    </group>
  )
}

/** Sematikus: egyetlen színes box (a renderer override-olja a regiszter színére). */
export function TemplateSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh userData={{ componentId }}>
      <boxGeometry args={[BODY, LENGTH, BODY]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}
