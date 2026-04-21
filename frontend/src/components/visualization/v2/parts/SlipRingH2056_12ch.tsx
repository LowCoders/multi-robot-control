/**
 * SENRING H2056-12 — through-hole / through-bore csúszógyűrű (slip ring),
 * 20 mm-es belső furattal és 56 mm-es külső átmérővel, 12 csatorna, 10 A / csatorna.
 *
 * Termékcsalád: SENRING "Through Hole/Bore Slip Ring" sorozat
 *   - Aktuális változat: **20 × 56 mm, 12 CH, 10 A** → ID = 20, OD = 56,
 *     12 db áramvivő gyűrű (csatorna), csatornánként 10 A teherbírás
 *
 * MÉRETEK:
 *   - Belső furat (ID, through-bore): Ø20 mm
 *   - Külső átmérő (OD, body):        Ø56 mm
 *   - Body axiális hossz:             ~38 mm
 *
 * EGYSZERŰSÍTETT GEOMETRIA (a felhasználó kérésére):
 *   A body MAGÁBA foglalja a stator + rotor szakaszt egyetlen Ø56 × 38 mm-es,
 *   középen Ø20-as furattal ellátott hengerként. Sem a mounting flange, sem a
 *   csatornagyűrűk (réz színű körkörös ringek a body külsején), sem a két
 *   oldali tangenciális vezetékkötegek nincsenek modellezve — csak a központi
 *   henger. Ez tisztán befoglaló-méret nézetet ad; a részletes felépítés
 *   (flange-furatok, vezetékvégek, kefés-réz csatornarendszer) későbbi
 *   iterációra hagyva.
 *
 * Builder lokális orientáció:
 *   - +Z = a forgástengely (a through-bore iránya).
 *   - Origó: a henger GEOMETRIAI KÖZÉPPONTJA (X = Y = 0, Z = 0).
 *     Body Z range: -BODY_LENGTH/2 .. +BODY_LENGTH/2 = -19 .. +19.
 *
 *   A regiszterben a transform.rotation [0, π/2, 0]: builder +Z → world +X,
 *   vagyis a bore VÍZSZINTESEN a world +X irányba néz.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

const BORE_DIAM = 20
const BORE_R = BORE_DIAM / 2
const OD = 56
const OUTER_R = OD / 2

const BODY_LENGTH = 38

function useBodyMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3a3d42',
        metalness: 0.55,
        roughness: 0.5,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

/** Annulus 2D shape: Ø56 körlap középen Ø20 furattal. */
function buildAnnulusShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, OUTER_R, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  hole.absarc(0, 0, BORE_R, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  return shape
}

/** Body henger (annulus extrúzió, közepén bore). */
function buildBodyGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildAnnulusShape(), {
    depth: BODY_LENGTH,
    bevelEnabled: false,
    curveSegments: 48,
  })
  geom.translate(0, 0, -BODY_LENGTH / 2)
  return geom
}

/** Realisztikus: egyszerű Ø56 × 38 mm henger Ø20 furattal. */
export function SlipRingH2056_12chRealistic({ componentId }: PartBuilderProps) {
  const bodyMat = useBodyMaterial()
  const bodyGeom = useMemo(() => buildBodyGeometry(), [])
  useEffect(() => () => bodyGeom.dispose(), [bodyGeom])

  return (
    <group userData={{ componentId }}>
      <mesh material={bodyMat} geometry={bodyGeom} userData={{ componentId }} />
    </group>
  )
}

/** Medium: ugyanaz mint a realistic — a body önmaga is egyszerű henger. */
export function SlipRingH2056_12chMedium({ componentId }: PartBuilderProps) {
  const bodyMat = useBodyMaterial()
  const bodyGeom = useMemo(() => buildBodyGeometry(), [])
  useEffect(() => () => bodyGeom.dispose(), [bodyGeom])

  return (
    <group userData={{ componentId }}>
      <mesh material={bodyMat} geometry={bodyGeom} userData={{ componentId }} />
    </group>
  )
}

/** Sematikus: tömör henger Ø56 × 38 (a renderer override-olja a regiszter színre). */
export function SlipRingH2056_12chSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} userData={{ componentId }}>
      <cylinderGeometry args={[OUTER_R, OUTER_R, BODY_LENGTH, 32]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}

export const SLIP_RING_H2056_12CH_DIMENSIONS = {
  boreDiam: BORE_DIAM,
  outerDiam: OD,
  bodyLength: BODY_LENGTH,
  channels: 12,
  ratedCurrentA: 10,
  /** Teljes axiális kiterjedés (csak a body, flange/vezetékek nélkül), Z mentén. */
  totalAxialLength: BODY_LENGTH,
}
