/**
 * HTD 5M AF típusú fogasszíj-tárcsa — 15 fogszám, Ø8 furat, 15 mm szíjszélesség.
 *
 * A `HtdPulley70T_25b` testvér-komponense: ugyanaz a HTD 5M szabvány, csak
 * kisebb fogszámmal és furattal. A felhasználó kérésére kis méretű "pinion"
 * pulleyként a 70T-vel összepárosítható (1:70/15 ≈ 4.67 áttétel).
 *
 * SZÁMÍTOTT MÉRETEK (HTD 5M, Z = 15):
 *   - Pitch (osztó) Ø: d  = (5 · 15) / π ≈ 23.873 mm
 *   - Külső (OD) Ø:    da = d − 2·PLD = d − 0.762 ≈ 23.111 mm
 *   - Lábkör (root) Ø: df = da − 2·tooth_depth = da − 4.12 ≈ 18.991 mm
 *   - Furat (bore) Ø:  8 mm
 *
 * AF TÍPUS (with flanges):
 *   - Belt szélesség: 15 mm
 *   - Body (toothed) szélesség: 16 mm
 *   - Flange Ø: OD + 5 mm = 28.111 mm (kissé visszafogottabb mint a 70T-nél,
 *     mert a kis OD-hez képest a flange-OD aránytalanul nagy lenne 6 mm-rel)
 *   - Flange vastagság: 1.5 mm
 *
 * HUB (a 70T-vel ELLENTÉTBEN VAN):
 *   A 15T pulley OD-ja kicsi (~23 mm), így a body önmagában gyenge a Ø8-as
 *   tengelyre. Ezért egy nagyobb külső Ø-jű hub van az egyik oldalon, ami a
 *   set screw-knek elegendő anyagot ad:
 *     - Hub Ø: 14 mm
 *     - Hub hossz (a body-n túlnyúlva): 8 mm
 *     - 2 db M4 set screw a hub-on, 90°-os elrendezésben, hub-középmagasságban
 *
 * Builder lokális orientáció:
 *   - +Z = a fogaskerék TENGELYE (a furat iránya)
 *   - Origó: a body GEOMETRIAI KÖZÉPPONTJA
 *     - Body Z range: -BODY_W/2 .. +BODY_W/2 = -8 .. +8
 *     - Front flange: +8 .. +9.5
 *     - Back flange:  -9.5 .. -8
 *     - Hub: a back flange MÖGÖTT, Z = -9.5 .. -9.5 - 8 = -17.5
 *       (a tengelyen a motortól TÁVOLABB, hogy a set screw-k hozzáférhetők legyenek
 *        a szerelési oldalról)
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'
import {
  HTD5M_PITCH,
  buildHtdPulleyShape,
  buildPulleyFlangeShape,
  htd5mDimensions,
} from './_htdPulleyShape'

const TOOTH_COUNT = 15
const BORE_DIAM = 8
const BORE_R = BORE_DIAM / 2
const BELT_WIDTH = 15
const BODY_WIDTH = BELT_WIDTH + 1
const FLANGE_THICKNESS = 1.5
const FLANGE_OUTER_OFFSET = 5
const HUB_DIAM = 14
const HUB_R = HUB_DIAM / 2
const HUB_LENGTH = 8

const SET_SCREW_DIAM = 4
const SET_SCREW_HEAD_R = SET_SCREW_DIAM / 2 + 0.5
const SET_SCREW_DEPTH = 1.0

const DIMS = htd5mDimensions(TOOTH_COUNT)
const FLANGE_OUTER_DIAM = DIMS.od + FLANGE_OUTER_OFFSET
const TOTAL_AXIAL_LENGTH = BODY_WIDTH + 2 * FLANGE_THICKNESS + HUB_LENGTH

function useAluminiumMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#a8acb0',
        metalness: 0.7,
        roughness: 0.4,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function useFlangeMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#9aa0a6',
        metalness: 0.65,
        roughness: 0.45,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function useSetScrewMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#0d0d0f',
        metalness: 0.75,
        roughness: 0.55,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function buildBodyGeometry(): THREE.ExtrudeGeometry {
  const shape = buildHtdPulleyShape(TOOTH_COUNT, BORE_DIAM)
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: BODY_WIDTH,
    bevelEnabled: false,
    curveSegments: 4,
  })
  geom.translate(0, 0, -BODY_WIDTH / 2)
  return geom
}

function buildFlangeGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(
    buildPulleyFlangeShape(FLANGE_OUTER_DIAM, BORE_DIAM),
    {
      depth: FLANGE_THICKNESS,
      bevelEnabled: false,
      curveSegments: 36,
    },
  )
  return geom
}

function buildHubGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, HUB_R, 0, Math.PI * 2, false)
  const bore = new THREE.Path()
  bore.absarc(0, 0, BORE_R, 0, Math.PI * 2, true)
  shape.holes.push(bore)
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: HUB_LENGTH,
    bevelEnabled: false,
    curveSegments: 24,
  })
  return geom
}

/** Realisztikus: 15 fogú HTD body + 2 flange + hub + 2 set screw a hub-on. */
export function HtdPulley15T_8bRealistic({ componentId }: PartBuilderProps) {
  const aluMat = useAluminiumMaterial()
  const flangeMat = useFlangeMaterial()
  const screwMat = useSetScrewMaterial()

  const bodyGeom = useMemo(() => buildBodyGeometry(), [])
  const flangeGeom = useMemo(() => buildFlangeGeometry(), [])
  const hubGeom = useMemo(() => buildHubGeometry(), [])

  useEffect(
    () => () => {
      bodyGeom.dispose()
      flangeGeom.dispose()
      hubGeom.dispose()
    },
    [bodyGeom, flangeGeom, hubGeom],
  )

  const hubBackZ = -BODY_WIDTH / 2 - FLANGE_THICKNESS - HUB_LENGTH
  const screwAzimuths = [0, Math.PI / 2]
  const screwZ = hubBackZ + HUB_LENGTH / 2

  return (
    <group userData={{ componentId }}>
      <mesh material={aluMat} geometry={bodyGeom} userData={{ componentId }} />

      {/* Front flange */}
      <mesh
        position={[0, 0, BODY_WIDTH / 2]}
        material={flangeMat}
        geometry={flangeGeom}
        userData={{ componentId }}
      />

      {/* Back flange */}
      <mesh
        position={[0, 0, -BODY_WIDTH / 2 - FLANGE_THICKNESS]}
        material={flangeMat}
        geometry={flangeGeom}
        userData={{ componentId }}
      />

      {/* Hub a back flange MÖGÖTT — Ø14 × 8 mm. */}
      <mesh
        position={[0, 0, hubBackZ]}
        material={aluMat}
        geometry={hubGeom}
        userData={{ componentId }}
      />

      {/* 2 db M4 set screw a hub oldalán, 90°-os elrendezésben. */}
      {screwAzimuths.map((az, i) => {
        const x = (HUB_R - SET_SCREW_DEPTH / 2) * Math.cos(az)
        const y = (HUB_R - SET_SCREW_DEPTH / 2) * Math.sin(az)
        return (
          <mesh
            key={`ss-${i}`}
            position={[x, y, screwZ]}
            rotation={[0, Math.PI / 2, az]}
            material={screwMat}
            userData={{ componentId }}
          >
            <cylinderGeometry
              args={[SET_SCREW_HEAD_R, SET_SCREW_HEAD_R, SET_SCREW_DEPTH * 2, 16]}
            />
          </mesh>
        )
      })}
    </group>
  )
}

/** Medium: fogazat NÉLKÜLI body (OD-henger) + 2 flange + hub. */
export function HtdPulley15T_8bMedium({ componentId }: PartBuilderProps) {
  const aluMat = useAluminiumMaterial()
  const flangeMat = useFlangeMaterial()
  const flangeGeom = useMemo(() => buildFlangeGeometry(), [])
  const hubGeom = useMemo(() => buildHubGeometry(), [])
  useEffect(
    () => () => {
      flangeGeom.dispose()
      hubGeom.dispose()
    },
    [flangeGeom, hubGeom],
  )

  const hubBackZ = -BODY_WIDTH / 2 - FLANGE_THICKNESS - HUB_LENGTH

  return (
    <group userData={{ componentId }}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={aluMat} userData={{ componentId }}>
        <cylinderGeometry args={[DIMS.odR, DIMS.odR, BODY_WIDTH, 32, 1, false]} />
      </mesh>
      <mesh
        position={[0, 0, BODY_WIDTH / 2]}
        material={flangeMat}
        geometry={flangeGeom}
        userData={{ componentId }}
      />
      <mesh
        position={[0, 0, -BODY_WIDTH / 2 - FLANGE_THICKNESS]}
        material={flangeMat}
        geometry={flangeGeom}
        userData={{ componentId }}
      />
      <mesh
        position={[0, 0, hubBackZ]}
        material={aluMat}
        geometry={hubGeom}
        userData={{ componentId }}
      />
    </group>
  )
}

/** Sematikus: tömör henger flange-OD-vel × teljes axiális hosszal. */
export function HtdPulley15T_8bSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh
      position={[0, 0, -HUB_LENGTH / 2]}
      rotation={[Math.PI / 2, 0, 0]}
      userData={{ componentId }}
    >
      <cylinderGeometry
        args={[
          FLANGE_OUTER_DIAM / 2,
          FLANGE_OUTER_DIAM / 2,
          TOTAL_AXIAL_LENGTH,
          24,
        ]}
      />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}

export const HTD_PULLEY_15T_8B_DIMENSIONS = {
  pitch: HTD5M_PITCH,
  toothCount: TOOTH_COUNT,
  pitchDiam: DIMS.pitchDiam,
  outsideDiam: DIMS.od,
  rootDiam: DIMS.rootDiam,
  flangeOuterDiam: FLANGE_OUTER_DIAM,
  boreDiam: BORE_DIAM,
  beltWidth: BELT_WIDTH,
  bodyWidth: BODY_WIDTH,
  flangeThickness: FLANGE_THICKNESS,
  hubDiam: HUB_DIAM,
  hubLength: HUB_LENGTH,
  totalAxialLength: TOTAL_AXIAL_LENGTH,
  setScrewSize: 'M4',
}
