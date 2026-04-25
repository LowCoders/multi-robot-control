/**
 * HTD 5M AF típusú fogasszíj-tárcsa — 70 fogszám, Ø25 furat, 15 mm szíjszélesség.
 *
 * Termék: "70T/80T/90T/100T/120Teeth HTD 5M AF Type Timing Pulley Pitch 5mm
 *   Bore10-25mm for 15/20mm Width Belt Used In Linear Pulley 5GT"
 *   Aktuális változat: **70T, For 15 mm Belt, Bore 25 mm**
 *
 * SZÁMÍTOTT MÉRETEK (HTD 5M, Z = 70):
 *   - Pitch (osztó) Ø: d  = (5 · 70) / π ≈ 111.408 mm
 *   - Külső (OD) Ø:    da = d − 2·PLD = d − 0.762 ≈ 110.65 mm
 *   - Lábkör (root) Ø: df = da − 2·tooth_depth = da − 4.12 ≈ 106.53 mm
 *   - Furat (bore) Ø:  25 mm
 *
 * AF TÍPUS = "with Flanges on both sides" — a belt-támasztó peremek kétoldalt.
 *   - Belt szélesség: 15 mm
 *   - Body (toothed) szélesség: ~16 mm (fél-mm clearance kétoldalt)
 *   - Flange Ø: OD + 6 mm = 116.65 mm (HTD 5M szabvány AF flange ≈ OD + 6 mm)
 *   - Flange vastagság: 1.5 mm
 *   - TELJES axiális hossz (flange-flange): 16 + 2·1.5 = 19 mm
 *
 * HUB / SET SCREW:
 *   A 70T pulley test elég nagy ahhoz, hogy NE legyen szüksége külön kiemelkedő
 *   hub-ra (a body maga elég vastag). A bore mellett 1 db M5 set screw furat
 *   van a body oldalán (radiálisan), kb. a body közepén.
 *
 * Builder lokális orientáció:
 *   - +Z = a fogaskerék TENGELYE (a furat iránya).
 *   - Origó: a body GEOMETRIAI KÖZÉPPONTJA.
 *     - Body Z range: -BODY_W/2 .. +BODY_W/2 = -8 .. +8
 *     - Front flange: +BODY_W/2 .. +BODY_W/2 + FLANGE_T = +8 .. +9.5
 *     - Back flange:  -BODY_W/2 - FLANGE_T .. -BODY_W/2 = -9.5 .. -8
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

const TOOTH_COUNT = 70
const BORE_DIAM = 25
const BELT_WIDTH = 15
const BODY_WIDTH = BELT_WIDTH + 1
const FLANGE_THICKNESS = 1.5
const FLANGE_OUTER_OFFSET = 6
const SET_SCREW_DIAM = 5
const SET_SCREW_HEAD_R = SET_SCREW_DIAM / 2 + 0.5

const DIMS = htd5mDimensions(TOOTH_COUNT)
const FLANGE_OUTER_DIAM = DIMS.od + FLANGE_OUTER_OFFSET
const TOTAL_AXIAL_LENGTH = BODY_WIDTH + 2 * FLANGE_THICKNESS

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
  const shape = buildPulleyFlangeShape(FLANGE_OUTER_DIAM, BORE_DIAM)
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: FLANGE_THICKNESS,
    bevelEnabled: false,
    curveSegments: 48,
  })
  return geom
}

/** Realisztikus: 70 fogú HTD body + 2 flange + 1 set screw a body oldalán. */
export function YPulley70TRealistic({ componentId }: PartBuilderProps) {
  const aluMat = useAluminiumMaterial()
  const flangeMat = useFlangeMaterial()
  const screwMat = useSetScrewMaterial()

  const bodyGeom = useMemo(() => buildBodyGeometry(), [])
  const flangeGeom = useMemo(() => buildFlangeGeometry(), [])

  useEffect(
    () => () => {
      bodyGeom.dispose()
      flangeGeom.dispose()
    },
    [bodyGeom, flangeGeom],
  )

  return (
    <group userData={{ componentId }}>
      <mesh material={aluMat} geometry={bodyGeom} userData={{ componentId }} />

      {/* Front flange — Z = +BODY/2 .. +BODY/2 + FLANGE_T. */}
      <mesh
        position={[0, 0, BODY_WIDTH / 2]}
        material={flangeMat}
        geometry={flangeGeom}
        userData={{ componentId }}
      />

      {/* Back flange — Z = -BODY/2 - FLANGE_T .. -BODY/2. */}
      <mesh
        position={[0, 0, -BODY_WIDTH / 2 - FLANGE_THICKNESS]}
        material={flangeMat}
        geometry={flangeGeom}
        userData={{ componentId }}
      />

      {/* M5 set screw — radiálisan a body oldalán (X tengelyen kifelé). */}
      <mesh
        position={[DIMS.odR + 0.1, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        material={screwMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[SET_SCREW_HEAD_R, SET_SCREW_HEAD_R, 1.2, 16]} />
      </mesh>
    </group>
  )
}

/** Medium: fogazat NÉLKÜLI body henger (OD diameter) + 2 flange. */
export function YPulley70TMedium({ componentId }: PartBuilderProps) {
  const aluMat = useAluminiumMaterial()
  const flangeMat = useFlangeMaterial()
  const flangeGeom = useMemo(() => buildFlangeGeometry(), [])
  useEffect(() => () => flangeGeom.dispose(), [flangeGeom])

  return (
    <group userData={{ componentId }}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={aluMat} userData={{ componentId }}>
        <cylinderGeometry args={[DIMS.odR, DIMS.odR, BODY_WIDTH, 64, 1, false]} />
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
    </group>
  )
}

/** Sematikus: tömör henger flange-OD-vel × teljes axiális hosszal. */
export function YPulley70TSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} userData={{ componentId }}>
      <cylinderGeometry
        args={[
          FLANGE_OUTER_DIAM / 2,
          FLANGE_OUTER_DIAM / 2,
          TOTAL_AXIAL_LENGTH,
          48,
        ]}
      />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}

export const Y_PULLEY_70T_DIMENSIONS = {
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
  totalAxialLength: TOTAL_AXIAL_LENGTH,
  setScrewSize: 'M5',
}
