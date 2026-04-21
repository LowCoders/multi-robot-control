/**
 * NEMA 23 closed-loop léptetőmotor — **Z-TENGELY VARIÁNS** (rövidebb törzs).
 *
 * A `Nema23Motor.tsx` (122 mm-es X-motor) egy az egyben másolata, a felhasználó
 * kérésére egyetlen paraméter-változással: a teljes motor-hossz **81 mm** (a
 * 122 mm helyett). Ez egy alacsonyabb nyomatékú, rövidebb NEMA 23 variáns,
 * amit a felhasználó a Z-tengely léptetőjének szán (a bolygóhajtómű alá kerül,
 * tengelye felfelé mutat, hogy a gearbox input bore-jába illeszkedjen).
 *
 * A két-profilos body design AZONOS a 122 mm-es verzióval:
 *   - **Mounting flange** (front 5 mm, motor-local Z = +35.5 .. +40.5):
 *       lekerekített 56.4×56.4 négyzet + 4 db Ø5.1 ÁTMENŐ furat a 47.14 pattern-en.
 *       Itt mennek át a gearbox M5 csavarjai (a csavar a motor hátuljáról indul,
 *       áthalad a cover + iron main indent voidjain, majd a flange Ø5.1 furatain,
 *       és a gearbox input oldali M5 menetes furatába csavarodik).
 *   - **Iron body main** (57 mm, Z = -21.5 .. +35.5): sarok-indent silhouette
 *       (R=4 ív befelé, R=2 fillet, 1 mm KIFELÉ offset — azonos mint a 122 mm-esen).
 *   - **Hátsó plast fedő** (19 mm, Z = -40.5 .. -21.5): closed-loop driver háza,
 *       szintén sarok-indent silhouette. **Ugyanaz a 19 mm** mint a 122 mm-es motornál.
 *
 * A cover hossza 19 mm marad (a closed-loop driver méretét a motor-hossz NEM
 * befolyásolja — a driver-NYÁK geometriája független). Az iron body main a
 * rövidítés miatt csak 57 mm (98 helyett): IRON_MAIN_LENGTH = 81 - 19 - 5 = 57.
 *
 * Builder lokális orientáció:
 *   - Body közepe az origóban (motor-local Z = -40.5 .. +40.5, ez a TELJES 81 mm).
 *   - Mounting flange: motor-local Z = +35.5 .. +40.5 (5 mm).
 *   - Iron body main: motor-local Z = -21.5 .. +35.5 (57 mm).
 *   - Hátsó plast fedő: motor-local Z = -40.5 .. -21.5 (19 mm).
 *   - Boss: motor-local Z = +40.5 .. +42.1.
 *   - Tengely: motor-local Z = +40.5 .. +62.5 (Ø8 × 22 — a gearbox Ø8G6 bore-jába megy).
 *   - Kábelbevezető alapja: motor-local Z = -40.5 .. -8.5 (32 mm hosszan), Y = +28.2.
 *
 * A regiszterben a Z-motor a `gearbox-1` GYERMEKE (parent=gearbox-1). Mivel a
 * gearbox rotációja [-π/2, 0, 0] (builder +Z → world +Y), és a motor rotációja
 * [0, 0, 0] (relatív a gearbox-hoz), a motor builder +Z ugyancsak world +Y-ba
 * mappolódik → a tengely FELFELÉ mutat a gearbox input bore-jába.
 *
 * EZ A FÁJL SZÁNDÉKOS DUPLIKÁTUM: A felhasználó explicit kérte, hogy készítsünk
 * "egy másolatot" a motorrol. A jövőben közös builder faktorral
 * összevonhatóak (l. `_motorBuilder.ts` refactor, ha kell).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'
import {
  NEMA23_BODY_SIZE,
  NEMA23_BOLT_HOLE_DIAM,
  NEMA23_INDENT_FILLET_R,
  NEMA23_INDENT_OUTWARD_OFFSET,
  NEMA23_INDENT_R,
  buildNema23IndentedShape,
  buildNema23Shape,
} from './_motorSilhouette'

/** Teljes motor hossz — **81 mm** (a Z-tengelyes rövidebb variáns). */
const BODY_LENGTH = 81
/** Hátsó plast fedő — 19 mm (az 122 mm-es motornál is ennyi, a driver-ház mérete független a törzshosszótól). */
const COVER_LENGTH = 19
/** Iron body szakasz (flange + iron main): 81 - 19 = 62 mm. */
const IRON_LENGTH = BODY_LENGTH - COVER_LENGTH // = 62
/** Frontoldali mounting flange vastagsága — 5 mm. */
const MOUNT_FLANGE_LENGTH = 5
/** Iron body indented main a flange MÖGÖTT: 62 - 5 = 57 mm. */
const IRON_MAIN_LENGTH = IRON_LENGTH - MOUNT_FLANGE_LENGTH // = 57

const BOSS_DIAM = 38.1
const BOSS_HEIGHT = 1.6
const SHAFT_DIAM = 8
const SHAFT_LENGTH = 22

const CABLE_BASE_W = 37
const CABLE_BASE_L = 32
const CABLE_BASE_H = 7
const CABLE_PYR_H = 6
const CABLE_TOTAL_H = CABLE_BASE_H + CABLE_PYR_H
const CABLE_TOP_W = CABLE_BASE_W - 2 * CABLE_PYR_H // 25
const CABLE_TOP_L = CABLE_BASE_L - 2 * CABLE_PYR_H // 20

function useBodyMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3a3a40',
        metalness: 0.7,
        roughness: 0.4,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function useBossMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#4a4a52',
        metalness: 0.75,
        roughness: 0.35,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function useShaftMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#cccccc',
        metalness: 0.95,
        roughness: 0.15,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function usePlasticMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#0e0e10',
        metalness: 0.05,
        roughness: 0.65,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function buildCableExitGeometry(): THREE.BufferGeometry {
  const hbw = CABLE_BASE_W / 2
  const hbl = CABLE_BASE_L / 2
  const htw = CABLE_TOP_W / 2
  const htl = CABLE_TOP_L / 2
  const baseTopY = CABLE_BASE_H
  const totalH = CABLE_TOTAL_H

  const positions = new Float32Array([
    -hbw, 0, -hbl,
    +hbw, 0, -hbl,
    +hbw, 0, +hbl,
    -hbw, 0, +hbl,
    -hbw, baseTopY, -hbl,
    +hbw, baseTopY, -hbl,
    +hbw, baseTopY, +hbl,
    -hbw, baseTopY, +hbl,
    -htw, totalH, -htl,
    +htw, totalH, -htl,
    +htw, totalH, +htl,
    -htw, totalH, +htl,
  ])

  const indices = [
    0, 1, 2,    0, 2, 3,
    0, 5, 1,    0, 4, 5,
    1, 5, 6,    1, 6, 2,
    2, 7, 3,    2, 6, 7,
    0, 7, 4,    0, 3, 7,
    4, 9, 5,    4, 8, 9,
    5, 10, 6,   5, 9, 10,
    6, 11, 7,   6, 10, 11,
    7, 11, 8,   7, 8, 4,
    8, 10, 9,   8, 11, 10,
  ]

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

function buildMountFlangeGeometry(): THREE.ExtrudeGeometry {
  const shape = buildNema23Shape(0, 0)
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: MOUNT_FLANGE_LENGTH,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geom.translate(0, 0, BODY_LENGTH / 2 - MOUNT_FLANGE_LENGTH)
  return geom
}

function buildIronMainGeometry(): THREE.ExtrudeGeometry {
  const shape = buildNema23IndentedShape(0, 0)
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: IRON_MAIN_LENGTH,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geom.translate(0, 0, -BODY_LENGTH / 2 + COVER_LENGTH)
  return geom
}

function buildCoverGeometry(): THREE.ExtrudeGeometry {
  const shape = buildNema23IndentedShape(0, 0)
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: COVER_LENGTH,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geom.translate(0, 0, -BODY_LENGTH / 2)
  return geom
}

/** Realisztikus: két-profilos body — front 5 mm mounting flange (rounded sq +
 *  4 db Ø5.1 furat) + 57 mm iron main (sarok-indent) + 19 mm hátsó plast fedő
 *  (sarok-indent) + pilot boss + tengely + kábelbevezető. Összes body hossz: 81 mm. */
export function Nema23MotorZRealistic({ componentId }: PartBuilderProps) {
  const bodyMat = useBodyMaterial()
  const bossMat = useBossMaterial()
  const shaftMat = useShaftMaterial()
  const plasticMat = usePlasticMaterial()

  const flangeGeom = useMemo(() => buildMountFlangeGeometry(), [])
  const ironGeom = useMemo(() => buildIronMainGeometry(), [])
  const coverGeom = useMemo(() => buildCoverGeometry(), [])
  const cableExitGeom = useMemo(() => buildCableExitGeometry(), [])

  useEffect(() => {
    return () => {
      flangeGeom.dispose()
      ironGeom.dispose()
      coverGeom.dispose()
      cableExitGeom.dispose()
    }
  }, [flangeGeom, ironGeom, coverGeom, cableExitGeom])

  return (
    <group userData={{ componentId }}>
      <mesh material={bodyMat} geometry={flangeGeom} userData={{ componentId }} />
      <mesh material={bodyMat} geometry={ironGeom} userData={{ componentId }} />
      <mesh material={plasticMat} geometry={coverGeom} userData={{ componentId }} />

      <mesh
        position={[
          0,
          NEMA23_BODY_SIZE / 2,
          -BODY_LENGTH / 2 + CABLE_BASE_L / 2,
        ]}
        material={plasticMat}
        geometry={cableExitGeom}
        userData={{ componentId }}
      />

      <mesh
        position={[0, 0, BODY_LENGTH / 2 + BOSS_HEIGHT / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={bossMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[BOSS_DIAM / 2, BOSS_DIAM / 2, BOSS_HEIGHT, 48]} />
      </mesh>

      <mesh
        position={[0, 0, BODY_LENGTH / 2 + SHAFT_LENGTH / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={shaftMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[SHAFT_DIAM / 2, SHAFT_DIAM / 2, SHAFT_LENGTH, 24]} />
      </mesh>
    </group>
  )
}

/** Medium: egyszerűsített body (box) front + hátsó box-fedő + kábelbevezető (egyszerű box). */
export function Nema23MotorZMedium({ componentId }: PartBuilderProps) {
  const bodyMat = useBodyMaterial()
  const shaftMat = useShaftMaterial()
  const plasticMat = usePlasticMaterial()
  return (
    <group userData={{ componentId }}>
      <mesh
        position={[0, 0, (BODY_LENGTH - IRON_LENGTH) / 2]}
        material={bodyMat}
        userData={{ componentId }}
      >
        <boxGeometry args={[NEMA23_BODY_SIZE, NEMA23_BODY_SIZE, IRON_LENGTH]} />
      </mesh>
      <mesh
        position={[0, 0, -(BODY_LENGTH - COVER_LENGTH) / 2]}
        material={plasticMat}
        userData={{ componentId }}
      >
        <boxGeometry args={[NEMA23_BODY_SIZE, NEMA23_BODY_SIZE, COVER_LENGTH]} />
      </mesh>
      <mesh
        position={[
          0,
          NEMA23_BODY_SIZE / 2 + CABLE_TOTAL_H / 2,
          -BODY_LENGTH / 2 + CABLE_BASE_L / 2,
        ]}
        material={plasticMat}
        userData={{ componentId }}
      >
        <boxGeometry args={[CABLE_BASE_W, CABLE_TOTAL_H, CABLE_BASE_L]} />
      </mesh>
      <mesh
        position={[0, 0, BODY_LENGTH / 2 + SHAFT_LENGTH / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={shaftMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[SHAFT_DIAM / 2, SHAFT_DIAM / 2, SHAFT_LENGTH, 16]} />
      </mesh>
    </group>
  )
}

/** Sematikus: tömör box body, vékony tengellyel — a renderer override-olja a színt. */
export function Nema23MotorZSchematic({ componentId }: PartBuilderProps) {
  return (
    <group userData={{ componentId }}>
      <mesh userData={{ componentId }}>
        <boxGeometry args={[NEMA23_BODY_SIZE, NEMA23_BODY_SIZE, BODY_LENGTH]} />
        <meshStandardMaterial color="#888" />
      </mesh>
      <mesh
        position={[0, 0, BODY_LENGTH / 2 + SHAFT_LENGTH / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[SHAFT_DIAM / 2, SHAFT_DIAM / 2, SHAFT_LENGTH, 12]} />
        <meshStandardMaterial color="#aaa" />
      </mesh>
    </group>
  )
}

export const NEMA23_MOTOR_Z_DIMENSIONS = {
  bodySize: NEMA23_BODY_SIZE,
  /** TELJES motor hossz — **81 mm** (Z-tengely variáns, a 122 mm-es X-motor helyett). */
  bodyLength: BODY_LENGTH,
  /** Iron body szakasz (flange + main) — 62 mm a 81 mm-en belül. */
  ironLength: IRON_LENGTH,
  /** Hátsó plast fedő — 19 mm (a driver-ház mérete független a törzshosszótól). */
  coverLength: COVER_LENGTH,
  /** Mounting flange vastagsága — 5 mm, itt mennek át a gearbox M5 csavarjai. */
  mountFlangeLength: MOUNT_FLANGE_LENGTH,
  /** Iron body indented main a flange mögött — 57 mm. */
  ironMainLength: IRON_MAIN_LENGTH,
  indentRadius: NEMA23_INDENT_R,
  indentFilletRadius: NEMA23_INDENT_FILLET_R,
  indentOutwardOffset: NEMA23_INDENT_OUTWARD_OFFSET,
  bossDiam: BOSS_DIAM,
  bossHeight: BOSS_HEIGHT,
  shaftDiam: SHAFT_DIAM,
  shaftLength: SHAFT_LENGTH,
  boltHoleDiam: NEMA23_BOLT_HOLE_DIAM,
  cableExitBaseW: CABLE_BASE_W,
  cableExitBaseL: CABLE_BASE_L,
  cableExitBaseH: CABLE_BASE_H,
  cableExitPyramidH: CABLE_PYR_H,
  cableExitTotalH: CABLE_TOTAL_H,
}
