/**
 * Kúpfogaskerék (bevel gear) — 1.5 modul, 20 fog, 45° osztókúpszög.
 *
 * STRIPPED változat: csak a fogazat (bordázat) — 20 db tapered tooth wedge
 * ringben, hub / collar / bore / set screw NÉLKÜL.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

const MODULE_M = 1.5
const TOOTH_COUNT = 20
const PITCH_ANGLE = Math.PI / 4
const COS_PA = Math.cos(PITCH_ANGLE)

const PITCH_R_BACK = (MODULE_M * TOOTH_COUNT) / 2 // 15
const TIP_R_BACK = 31 / 2 // 15.5
const FACE_WIDTH = 9
const TOOTH_AXIAL_EXTENT = FACE_WIDTH * COS_PA // 6.36

const DEDENDUM = 1.25 * MODULE_M
const ROOT_R_BACK = PITCH_R_BACK - DEDENDUM * COS_PA // 13.67

const R_RATIO_TOP = (PITCH_R_BACK - TOOTH_AXIAL_EXTENT) / PITCH_R_BACK // 8.64/15
const ROOT_R_TOP = ROOT_R_BACK * R_RATIO_TOP // 7.87
const TIP_R_TOP = TIP_R_BACK * R_RATIO_TOP // 8.93

// Builder-Z layout: a fogazat -Z oldalán; nagy vég Z=-6.36, kicsi vég Z=0.
const Z_LARGE_END = -TOOTH_AXIAL_EXTENT // -6.36
const Z_TOOTH_TOP = 0

// Hub cilinder a fogazat NAGY (back) végén — Ø24 OD, Ø8 ID.
// A teljes axiális magasság (hub + fogazat) PONTOSAN 20 mm; ebből a fogazat
// 6.36 mm (= toothAxialExtent), így a hub = 20 - 6.36 = 13.64 mm.
// Az axison középen, a fogazat back face-éhez illesztve (Z = Z_LARGE_END).
const TOTAL_AXIAL_TARGET = 20
const HUB_OD = 24
const HUB_OUTER_R = HUB_OD / 2 // 12
const HUB_BORE_DIAM = 8
const HUB_BORE_R = HUB_BORE_DIAM / 2 // 4
const HUB_HEIGHT = TOTAL_AXIAL_TARGET - TOOTH_AXIAL_EXTENT // 13.64
const HUB_Z_TOP = Z_LARGE_END // -6.36 (érintkezik a fogazat back face-ével)
const HUB_Z_BOTTOM = HUB_Z_TOP - HUB_HEIGHT // -20

function buildToothWedgeGeometry(): THREE.BufferGeometry {
  const halfAng = Math.PI / (2 * TOOTH_COUNT)
  const c = Math.cos
  const s = Math.sin

  const vertices = new Float32Array([
    ROOT_R_BACK * c(-halfAng), ROOT_R_BACK * s(-halfAng), Z_LARGE_END, // 0
    TIP_R_BACK  * c(-halfAng), TIP_R_BACK  * s(-halfAng), Z_LARGE_END, // 1
    TIP_R_BACK  * c(+halfAng), TIP_R_BACK  * s(+halfAng), Z_LARGE_END, // 2
    ROOT_R_BACK * c(+halfAng), ROOT_R_BACK * s(+halfAng), Z_LARGE_END, // 3
    ROOT_R_TOP  * c(-halfAng), ROOT_R_TOP  * s(-halfAng), Z_TOOTH_TOP, // 4
    TIP_R_TOP   * c(-halfAng), TIP_R_TOP   * s(-halfAng), Z_TOOTH_TOP, // 5
    TIP_R_TOP   * c(+halfAng), TIP_R_TOP   * s(+halfAng), Z_TOOTH_TOP, // 6
    ROOT_R_TOP  * c(+halfAng), ROOT_R_TOP  * s(+halfAng), Z_TOOTH_TOP, // 7
  ])

  // CCW winding kifelé mutató normálokhoz. A root face (axisra néző belső
  // lap) is benne van — nincs body, ami eltakarná, így a wedge zárt mesh.
  const indices = [
    // Back face (z=Z_LARGE_END) — nagy vég
    0, 3, 2, 0, 2, 1,
    // Front face (z=Z_TOOTH_TOP) — kis vég
    4, 5, 6, 4, 6, 7,
    // Tip face (a tip cone palástján)
    1, 2, 6, 1, 6, 5,
    // Root face (a root cone palástján, axis felé néző normál)
    0, 4, 7, 0, 7, 3,
    // -α flank
    0, 1, 5, 0, 5, 4,
    // +α flank
    3, 6, 2, 3, 7, 6,
  ]

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

function useSteelMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1a1d',
        metalness: 0.85,
        roughness: 0.42,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function useToothGeometry() {
  const geom = useMemo(() => buildToothWedgeGeometry(), [])
  useEffect(() => () => geom.dispose(), [geom])
  return geom
}

/** Egyesített body Lathe-test: hub cilinder + csonka kúp (root cone) ÁTMENŐ
 *  Ø8 furattal. A két részt egy közös profilba egyesítjük, hogy a hub teteje
 *  és a kúp alja közti határ ne okozzon z-fighting-ot, és a furat folyamatos
 *  legyen Z = HUB_Z_BOTTOM (-20) és Z = Z_TOOTH_TOP (0) között.
 *
 *  Profil pontok CCW sorrendben (a lathe outward normálokat ad):
 *    1. (4, -20)           bore @ hub alja
 *    2. (12, -20)          hub alsó síkja kifelé
 *    3. (12, -6.36)        hub palástja felfelé
 *    4. (13.67, -6.36)     LIP — kifelé lép a kúp wide végéig
 *    5. (7.87, 0)          kúp palástja felfelé a kis végig
 *    6. (4, 0)             kúp tetején annular gyűrű befelé a furathoz
 *    7. (4, -20)           bore palástja lefelé (close)
 *
 *  Teljes axiális magasság = 20 mm (hub 13.64 + fogazat 6.36).
 */
function useBodyGeometry() {
  const geom = useMemo(() => {
    const profile = [
      new THREE.Vector2(HUB_BORE_R, HUB_Z_BOTTOM),    // 1
      new THREE.Vector2(HUB_OUTER_R, HUB_Z_BOTTOM),   // 2
      new THREE.Vector2(HUB_OUTER_R, HUB_Z_TOP),      // 3
      new THREE.Vector2(ROOT_R_BACK, Z_LARGE_END),    // 4 (HUB_Z_TOP == Z_LARGE_END)
      new THREE.Vector2(ROOT_R_TOP, Z_TOOTH_TOP),     // 5
      new THREE.Vector2(HUB_BORE_R, Z_TOOTH_TOP),     // 6
      new THREE.Vector2(HUB_BORE_R, HUB_Z_BOTTOM),    // 7 (close)
    ]
    const lathe = new THREE.LatheGeometry(profile, 64)
    lathe.rotateX(Math.PI / 2)
    lathe.computeVertexNormals()
    return lathe
  }, [])
  useEffect(() => () => geom.dispose(), [geom])
  return geom
}

function ToothRing({ componentId }: PartBuilderProps) {
  const mat = useSteelMaterial()
  const toothGeom = useToothGeometry()
  const bodyGeom = useBodyGeometry()
  const teethStep = (Math.PI * 2) / TOOTH_COUNT

  return (
    <group userData={{ componentId }}>
      <mesh geometry={bodyGeom} material={mat} userData={{ componentId }} />
      {Array.from({ length: TOOTH_COUNT }).map((_, i) => (
        <mesh
          key={i}
          rotation={[0, 0, i * teethStep]}
          geometry={toothGeom}
          material={mat}
          userData={{ componentId }}
        />
      ))}
    </group>
  )
}

export function BevelGear15M20T45degRealistic({ componentId }: PartBuilderProps) {
  return <ToothRing componentId={componentId} />
}

export function BevelGear15M20T45degMedium({ componentId }: PartBuilderProps) {
  return <ToothRing componentId={componentId} />
}

export function BevelGear15M20T45degSchematic({ componentId }: PartBuilderProps) {
  return <ToothRing componentId={componentId} />
}

export const BEVEL_GEAR_15M_20T_45DEG_DIMENSIONS = {
  module: MODULE_M,
  toothCount: TOOTH_COUNT,
  pitchAngleDeg: 45,
  pitchDiamBack: PITCH_R_BACK * 2,
  pitchDiamFront: 2 * PITCH_R_BACK * R_RATIO_TOP,
  tipDiamBack: TIP_R_BACK * 2,
  tipDiamFront: TIP_R_TOP * 2,
  rootDiamBack: ROOT_R_BACK * 2,
  rootDiamFront: ROOT_R_TOP * 2,
  faceWidth: FACE_WIDTH,
  toothAxialExtent: TOOTH_AXIAL_EXTENT,
  /** Builder-Z, ahol a fogazat NAGY vége (back face) van. */
  zLargeEnd: Z_LARGE_END,
  /** Builder-Z, ahol a fogazat KIS vége (cilinder felőli) van. */
  zToothTop: Z_TOOTH_TOP,
  hubOuterDiam: HUB_OD,
  hubBoreDiam: HUB_BORE_DIAM,
  hubHeight: HUB_HEIGHT,
  /** Builder-Z, ahol a hub cilinder alsó síkja van. */
  zHubBottom: HUB_Z_BOTTOM,
  /** Az össz axiális (Z) magasság: hub alja → fogazat kis vége. */
  totalAxialExtent: Z_TOOTH_TOP - HUB_Z_BOTTOM,
}
