/**
 * NEMA 23 closed-loop léptetőmotor — STEPPERONLINE 23HS40-5004D-E1K-1M5.
 *
 * Méretek a hivatalos műszaki rajz alapján (és a felhasználó által specifikált
 * két-profilos body design):
 *   - Body: 57 × 57 × 122 mm. A 122 mm a TELJES motor hossz, két különböző
 *     keresztmetszet-profillal:
 *       * **Mounting flange** (front 5 mm, motor-local Z = +56..+61):
 *         lekerekített 57×57 négyzet (R≈5 sarkok) + 4 db Ø5.1 ÁTMENŐ furat a
 *         47.14 pattern szerint. Itt a menetes szárak a furatokon át, anyaggal
 *         körülvéve haladnak.
 *       * **Iron body main** (98 mm, Z = -42..+56) **és plast cover** (19 mm,
 *         Z = -61..-42): a **sarok-indent** silhouette (R=7 ív befelé hajlik a
 *         M5 csavarpozíciók köré). Az indent voidokon át a 4 menetes szár
 *         vizuálisan láthatóvá válik a body oldalán.
 *   - Pilot boss: Ø38.1 × 1.6 mm (front oldali centrírozó perem).
 *   - Tengely: Ø8 × 22 mm; ezen 15 mm hosszú D-cut Ø7.5 maradékkal (egyszerűsítve
 *     itt sima Ø8 hengernek modellezzük).
 *   - Kábelbevezető: 37 × 32 × 7 mm téglatest alap + 45°-os csonka gúla a tetején
 *     (6 mm magas, felső lap 25 × 20 mm). Összes magasság 13 mm. A motor
 *     hátlapjától indul és **+Z irányban 32 mm hosszan** rátér a motor tetejére.
 *
 * Builder lokális orientáció:
 *   - Body közepe az origóban (motor-local Z = -61 .. +61, ez a TELJES 122 mm).
 *   - Mounting flange (rounded sq + holes): motor-local Z = +56 .. +61 (5 mm).
 *   - Iron body main (indented): motor-local Z = -42 .. +56 (98 mm).
 *   - Hátsó plast fedő (indented): motor-local Z = -61 .. -42 (19 mm).
 *   - Boss: motor-local Z = +61 .. +62.6.
 *   - Tengely: motor-local Z = +61 .. +83.
 *   - Kábelbevezető alapja: motor-local Z = -61 .. -29 (32 mm hosszan), Y = +28.5.
 *
 * A regiszterben a motor a `vertical-bracket-1` gyermeke. A bracket forgatása
 * [0, +π/2, 0] mappolja: motor-local +Z → world +X. Így a tengely világ +X-be néz.
 * A motort a `menetes-szar-szerelveny-1` 4 db M5 menetes szára tartja: a flange
 * Ø5.1 furatain MEGY KERESZTÜL, az iron body main + cover indent voidjaiban
 * pedig LÁTHATÓ a szár.
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

/** Teljes motor hossz (rajz: 122 ± 1). Tartalmazza a flange + iron main + cover-t. */
const BODY_LENGTH = 122
/** A 19 mm hosszú hátsó plast fedő — a 122 mm-es teljes hosszon BELÜL, a hátsó szakaszban. */
const COVER_LENGTH = 19
/** Az iron body szakasza (flange + iron main együtt) — a teljes hossz mínusz a hátsó plast fedő. */
const IRON_LENGTH = BODY_LENGTH - COVER_LENGTH // = 103
/** A frontoldali rögzítő perem (mounting flange) vastagsága.
 *  Ez a 122 mm front 5 mm-e, lekerekített négyzet + 4 Ø5.1 furat profilú. */
const MOUNT_FLANGE_LENGTH = 5
/** Az iron body indented main szakasza a flange MÖGÖTT (= IRON_LENGTH - MOUNT_FLANGE_LENGTH). */
const IRON_MAIN_LENGTH = IRON_LENGTH - MOUNT_FLANGE_LENGTH // = 98

const BOSS_DIAM = 38.1
const BOSS_HEIGHT = 1.6
const SHAFT_DIAM = 8
const SHAFT_LENGTH = 22

/** Kábelbevezető geometria — téglatest alap + 45°-os csonka gúla a tetején.
 *  Alaphossz a rajzból: (32) — referencia dimenzió. */
const CABLE_BASE_W = 37
const CABLE_BASE_L = 32
const CABLE_BASE_H = 7
const CABLE_PYR_H = 6
const CABLE_TOTAL_H = CABLE_BASE_H + CABLE_PYR_H
/** 45°-os csapás → felső lap minden oldalon `pyrH` mm-rel kisebb. */
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

/** Fekete műanyag (hátsó driver-fedő, kábelbevezető). */
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

/**
 * Egybe-meshes kábelbevezető geometria: alul `baseW × baseL × baseH` téglatest,
 * tetején 45°-os csonka gúla (`baseW × baseL` → `topW × topL`, `pyrH` magas).
 *
 * A mesh-lokális koordináták:
 *   - origó: az alap-téglatest aljának közepe (X-Z közép, Y = 0)
 *   - +Y: felfelé (téglatest teteje Y=baseH-nál, gúla teteje Y=totalH-nál)
 */
function buildCableExitGeometry(): THREE.BufferGeometry {
  const hbw = CABLE_BASE_W / 2
  const hbl = CABLE_BASE_L / 2
  const htw = CABLE_TOP_W / 2
  const htl = CABLE_TOP_L / 2
  const baseTopY = CABLE_BASE_H
  const totalH = CABLE_TOTAL_H

  const positions = new Float32Array([
    -hbw, 0, -hbl,        // 0  BBL
    +hbw, 0, -hbl,        // 1  BBR
    +hbw, 0, +hbl,        // 2  BFR
    -hbw, 0, +hbl,        // 3  BFL
    -hbw, baseTopY, -hbl, // 4  TBL
    +hbw, baseTopY, -hbl, // 5  TBR
    +hbw, baseTopY, +hbl, // 6  TFR
    -hbw, baseTopY, +hbl, // 7  TFL
    -htw, totalH, -htl,   // 8  PBL
    +htw, totalH, -htl,   // 9  PBR
    +htw, totalH, +htl,   // 10 PFR
    -htw, totalH, +htl,   // 11 PFL
  ])

  const indices = [
    // Téglatest alja (-Y)
    0, 1, 2,    0, 2, 3,
    // Téglatest hátulja (-Z)
    0, 5, 1,    0, 4, 5,
    // Téglatest jobb (+X)
    1, 5, 6,    1, 6, 2,
    // Téglatest eleje (+Z)
    2, 7, 3,    2, 6, 7,
    // Téglatest bal (-X)
    0, 7, 4,    0, 3, 7,
    // Csonka gúla — hátsó (-Z, +Y, 45°)
    4, 9, 5,    4, 8, 9,
    // Csonka gúla — jobb (+X, +Y)
    5, 10, 6,   5, 9, 10,
    // Csonka gúla — eleje (+Z, +Y)
    6, 11, 7,   6, 10, 11,
    // Csonka gúla — bal (-X, +Y)
    7, 11, 8,   7, 8, 4,
    // Csonka gúla teteje (+Y)
    8, 10, 9,   8, 11, 10,
  ]

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

/** Mounting flange (front 5 mm) extrude geometria — lekerekített négyzet + 4 db
 *  Ø5.1 ÁTMENŐ furat. Itt mennek át a M5 menetes szárak, anyaggal körülvéve. */
function buildMountFlangeGeometry(): THREE.ExtrudeGeometry {
  const shape = buildNema23Shape(0, 0)
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: MOUNT_FLANGE_LENGTH,
    bevelEnabled: false,
    curveSegments: 24,
  })
  // Flange Z range a motor-lokálisban: +56 .. +61. ExtrudeGeometry: 0..5.
  // Eltolás: +56.
  geom.translate(0, 0, BODY_LENGTH / 2 - MOUNT_FLANGE_LENGTH)
  return geom
}

/** Iron body main szakasz (98 mm a flange MÖGÖTT) extrude geometria — sarok-indent
 *  silhouette. Az indent voidokon át a 4 menetes szár vizuálisan látható a body
 *  oldalán. NINCS külön furat: a Ø5 szár belefér az R=7-es indent-arc clearance-ébe. */
function buildIronMainGeometry(): THREE.ExtrudeGeometry {
  const shape = buildNema23IndentedShape(0, 0)
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: IRON_MAIN_LENGTH,
    bevelEnabled: false,
    curveSegments: 24,
  })
  // Iron main Z range a motor-lokálisban: -42 .. +56. ExtrudeGeometry: 0..98.
  // Eltolás: -42.
  geom.translate(0, 0, -BODY_LENGTH / 2 + COVER_LENGTH)
  return geom
}

/** Hátsó plast fedő szakasz extrude geometria — sarok-indent silhouette
 *  (mint az iron main), a closed-loop driver háza. A szárak itt is láthatóak az
 *  indent voidokban. */
function buildCoverGeometry(): THREE.ExtrudeGeometry {
  const shape = buildNema23IndentedShape(0, 0)
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: COVER_LENGTH,
    bevelEnabled: false,
    curveSegments: 24,
  })
  // Cover Z range a motor-lokálisban: -61 .. -42. ExtrudeGeometry: 0..19.
  // Eltolás: -61.
  geom.translate(0, 0, -BODY_LENGTH / 2)
  return geom
}

/** Realisztikus: két-profilos body — front 5 mm mounting flange (rounded sq +
 *  4 db Ø5.1 furat) + 98 mm iron main (sarok-indent) + 19 mm hátsó plast fedő
 *  (sarok-indent) + pilot boss + tengely + kábelbevezető. */
export function Nema23MotorRealistic({ componentId }: PartBuilderProps) {
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
      {/* Mounting flange — 5 mm front szakasz, lekerekített négyzet + 4 Ø5.1 furat. */}
      <mesh material={bodyMat} geometry={flangeGeom} userData={{ componentId }} />

      {/* Iron body main — 98 mm a flange mögött, sarok-indent silhouette (R=7). */}
      <mesh material={bodyMat} geometry={ironGeom} userData={{ componentId }} />

      {/* Hátsó plast fedő (closed-loop driver háza) — 19 mm sarok-indent silhouette. */}
      <mesh material={plasticMat} geometry={coverGeom} userData={{ componentId }} />

      {/*
        Kábelbevezető — téglatest + csonka gúla. Mesh-lokális origó az alap aljának
        közepén. A motor tetején (Y = body half) a hátlapnál (Z = -BODY_LENGTH/2)
        kezdődik és +Z irányban CABLE_BASE_L (= 32 mm) hosszan tart.
      */}
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

      {/* Pilot boss — Ø38.1 × 1.6, a body front face-éből kiemelkedve. */}
      <mesh
        position={[0, 0, BODY_LENGTH / 2 + BOSS_HEIGHT / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={bossMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[BOSS_DIAM / 2, BOSS_DIAM / 2, BOSS_HEIGHT, 48]} />
      </mesh>

      {/* Tengely — Ø8 × 22, a boss-ból kiállva. */}
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
export function Nema23MotorMedium({ componentId }: PartBuilderProps) {
  const bodyMat = useBodyMaterial()
  const shaftMat = useShaftMaterial()
  const plasticMat = usePlasticMaterial()
  return (
    <group userData={{ componentId }}>
      {/* Iron body box — 103 mm a hátsó cover ELŐTT. */}
      <mesh
        position={[0, 0, (BODY_LENGTH - IRON_LENGTH) / 2]} // = +9.5
        material={bodyMat}
        userData={{ componentId }}
      >
        <boxGeometry args={[NEMA23_BODY_SIZE, NEMA23_BODY_SIZE, IRON_LENGTH]} />
      </mesh>
      {/* Hátsó plast fedő box — 19 mm a hátsó szakaszban. */}
      <mesh
        position={[0, 0, -(BODY_LENGTH - COVER_LENGTH) / 2]} // = -51.5
        material={plasticMat}
        userData={{ componentId }}
      >
        <boxGeometry args={[NEMA23_BODY_SIZE, NEMA23_BODY_SIZE, COVER_LENGTH]} />
      </mesh>
      {/* Kábelbevezető — egyszerűsített box (alapméretű). */}
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
export function Nema23MotorSchematic({ componentId }: PartBuilderProps) {
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

export const NEMA23_MOTOR_DIMENSIONS = {
  bodySize: NEMA23_BODY_SIZE,
  /** TELJES motor hossz (iron + hátsó plast fedő együtt) — 122 mm. */
  bodyLength: BODY_LENGTH,
  /** Iron body szakasz hossza (flange + main együtt) a teljes 122 mm-en BELÜL. */
  ironLength: IRON_LENGTH,
  /** Hátsó plast fedő szakasz hossza a teljes 122 mm-en BELÜL. */
  coverLength: COVER_LENGTH,
  /** Frontoldali rögzítő perem (mounting flange) vastagsága — itt mennek át a szárak a furatokon. */
  mountFlangeLength: MOUNT_FLANGE_LENGTH,
  /** Iron body indented main szakasza a flange mögött — itt láthatóak a szárak az indent voidokban. */
  ironMainLength: IRON_MAIN_LENGTH,
  /** Sarok-indent silhouette ívsugara (iron main + cover) — konkáv ív befelé hajlik a M5 csavarpozíciók köré. */
  indentRadius: NEMA23_INDENT_R,
  /** Konvex fillet sugár az indent-ívek és a body egyenes éleinek találkozásánál. */
  indentFilletRadius: NEMA23_INDENT_FILLET_R,
  /** Indent center diagonális KIFELÉ eltolása a csavar-pozíciótól, mm. */
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
