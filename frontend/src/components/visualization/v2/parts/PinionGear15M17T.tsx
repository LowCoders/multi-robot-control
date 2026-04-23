/**
 * Fogaskerék (pinion) — modul 1.5, fogszám 17, Ø8 mm furat, set screw collar.
 *
 * Termék: AliExpress "Spur Gear 1.5M 17T 8mm bore" stílusú szabványos
 *   precíziós fogaskerék, fekete foszfátos szénacél, két M3/M4 hernyócsavar
 *   a hub-on (set screw collar) a tengelyhez rögzítéshez.
 *   Forrás: https://www.aliexpress.com/item/1005005556909924.html
 *   Referencia kép: public/components/tube-bender/pinion-gear-1-5m-17t/refs/product-photo.png
 *
 * Fogazat számítás (DIN/ISO 21771 metrikus involute, 20° nyomásszög):
 *   - Modul M = 1.5 mm
 *   - Fogszám Z = 17
 *   - Osztókör (pitch) átmérő     d  = M·Z              = 25.5 mm
 *   - Fejkör (addendum) átmérő    da = d + 2M           = 28.5 mm
 *   - Lábkör (dedendum) átmérő    df = d − 2.5M         = 21.0 mm
 *   - Alapkör átmérő              db = d·cos(α)         ≈ 23.96 mm  (α=20°)
 *   - Fogvastagság az osztókörön  s  = π·M / 2          ≈ 2.356 mm
 *
 * Geometria (mm), a referenciakép arányai alapján:
 *   - Fogaskerék (gear face / koszorú) magassága:  10 mm  (Z mentén)
 *   - Hub / collar átmérő:                          18 mm
 *   - Hub / collar magassága a koszorún felül:      14 mm
 *   - Furat (bore) Ø:                                8 mm  (átmenő)
 *   - Hernyócsavarok: 2 db M4 a hub-on, két szomszédos oldalon (90°-os
 *     elrendezésben), hub-középre helyezve függőlegesen.
 *
 * Builder lokális orientáció:
 *   - +Z = a fogaskerék TENGELYE (a furat iránya).
 *   - Origó: a koszorú és a hub találkozási síkja.
 *     - Gear face / fogkoszorú:   Z = -GEAR_FACE_W .. 0     (motor felé)
 *     - Hub / collar:             Z = 0 .. +HUB_HEIGHT      (motortól el)
 *   - A regiszterben szülő = `nema23-motor-1`. A motor builder-lokális +Z
 *     tengelye = a tengely iránya, így forgatás NEM kell. A motor builder
 *     a bracket [0, π/2, 0] forgatása révén world +X-be mappolódik, így a
 *     fogaskerék tengelye is world +X.
 *
 * LOD szintek:
 *   - schematic: egyszerű színes henger (tip-átmérő × teljes magasság),
 *                a renderer override-olja a registry színre.
 *   - medium:    fogazatlan henger a tip-átmérővel + hub henger + furat
 *                (a koszorú "tárcsának" látszik, a fogazat nem külön ki-
 *                modellezve — alacsonyabb tri-count).
 *   - realistic: 17 fogú extrudált shape involute-közelítő trapéz fogakkal,
 *                pluszhub henger, átmenő furat, 2 db M4 set screw fej.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Anchor, PartBuilderProps } from '../types'

const MODULE_M = 1.5
const TOOTH_COUNT = 17
const PRESSURE_ANGLE = (20 * Math.PI) / 180

const PITCH_R = (MODULE_M * TOOTH_COUNT) / 2 // 12.75
const TIP_R = PITCH_R + MODULE_M // addendum = M → 14.25
const ROOT_R = PITCH_R - 1.25 * MODULE_M // dedendum = 1.25M → 10.875

const BORE_DIAM = 8
const BORE_R = BORE_DIAM / 2

const GEAR_FACE_W = 10
const HUB_DIAM = 18
const HUB_R = HUB_DIAM / 2
const HUB_HEIGHT = 14

const TOTAL_HEIGHT = GEAR_FACE_W + HUB_HEIGHT // 24

/** Set screw (M4) fej-paraméterek — egyszerűsítve süllyesztett fej-furat formájában. */
const SET_SCREW_DIAM = 4
const SET_SCREW_HEAD_R = SET_SCREW_DIAM / 2 + 0.5 // ≈ 2.5
const SET_SCREW_DEPTH = 1.0 // mennyire látható mélyen a hub felületén

/**
 * Egy fogaskerék-keresztmetszet THREE.Shape építése (osztókör síkban).
 *
 * Trapéz alakú fogprofil (involute közelítés): a fog OLDALA egyenes vonalban
 * megy a lábkörtől (root) a fejkörig (tip), 20° nyomásszöggel kifelé szűkülve.
 * Pontosabb, valódi involute görbéhez egyenként ~16-32 mintavételezett pont
 * kellene fogonként; itt a vizualizáció szempontjából a trapéz-közelítés
 * elegendő.
 *
 * A nyomásszögből adódó tooth thickness változás:
 *   - Osztókörön (pitch):  half-thickness = π·M / 4
 *   - Fejkörön (tip):      half-thickness = π·M/4 − M·tan(α)
 *   - Lábkörön (root):     half-thickness = π·M/4 + 1.25·M·tan(α)
 *
 * Innen szögben:
 *   - tip half-angle  = (π·M/4 − M·tan(α))      / TIP_R
 *   - root half-angle = (π·M/4 + 1.25·M·tan(α)) / ROOT_R
 *
 * Biztonsági korlát: a root half-angle nem haladhatja meg a fél-osztásszöget
 * (π/Z), különben a fogak átfednének — ekkor visszavágjuk 90%-ára.
 */
function buildGearShape(): THREE.Shape {
  const halfChordPitch = (Math.PI * MODULE_M) / 4
  const tipHalfChord = halfChordPitch - MODULE_M * Math.tan(PRESSURE_ANGLE)
  const rootHalfChord = halfChordPitch + 1.25 * MODULE_M * Math.tan(PRESSURE_ANGLE)

  const tipHalfAngle = Math.max(0.005, tipHalfChord / TIP_R)
  const rawRootHalfAngle = rootHalfChord / ROOT_R
  const halfPitchAngle = Math.PI / TOOTH_COUNT
  const rootHalfAngle = Math.min(rawRootHalfAngle, halfPitchAngle * 0.9)

  const shape = new THREE.Shape()
  const teethStep = (Math.PI * 2) / TOOTH_COUNT

  for (let i = 0; i < TOOTH_COUNT; i++) {
    const center = i * teethStep
    const rL = center - rootHalfAngle
    const tL = center - tipHalfAngle
    const tR = center + tipHalfAngle
    const rR = center + rootHalfAngle

    const pRL: [number, number] = [ROOT_R * Math.cos(rL), ROOT_R * Math.sin(rL)]
    const pTL: [number, number] = [TIP_R * Math.cos(tL), TIP_R * Math.sin(tL)]
    const pRR: [number, number] = [ROOT_R * Math.cos(rR), ROOT_R * Math.sin(rR)]

    if (i === 0) {
      shape.moveTo(pRL[0], pRL[1])
    } else {
      shape.lineTo(pRL[0], pRL[1])
    }

    shape.lineTo(pTL[0], pTL[1])
    shape.absarc(0, 0, TIP_R, tL, tR, false)
    shape.lineTo(pRR[0], pRR[1])

    const nextRootLeftAngle = (i + 1) * teethStep - rootHalfAngle
    shape.absarc(0, 0, ROOT_R, rR, nextRootLeftAngle, false)
  }
  shape.closePath()

  const bore = new THREE.Path()
  bore.absarc(0, 0, BORE_R, 0, Math.PI * 2, true)
  shape.holes.push(bore)

  return shape
}

/** Csak a hub körvonala (kör + furat) — extrudálva adja a hub hengert. */
function buildHubShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, HUB_R, 0, Math.PI * 2, false)
  const bore = new THREE.Path()
  bore.absarc(0, 0, BORE_R, 0, Math.PI * 2, true)
  shape.holes.push(bore)
  return shape
}

/** Sötét foszfátos acél anyag a fogaskerékhez. */
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

/** Set screw fej anyaga — sötétebb, kissé matt. */
function useSetScrewMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#0d0d0f',
        metalness: 0.7,
        roughness: 0.55,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

/**
 * Realisztikus: 17 db extrudált fog + hub henger + bore + 2 db set screw fej.
 *
 * A fogazatot egyetlen ExtrudeGeometry-vel készítjük (gear face Z = -W..0).
 * A hub szintén ExtrudeGeometry, Z = 0..+H. Mindkettő középső furata Ø8.
 */
export function PinionGear15M17TRealistic({ componentId }: PartBuilderProps) {
  const steelMat = useSteelMaterial()
  const screwMat = useSetScrewMaterial()

  const gearGeom = useMemo(() => {
    const shape = buildGearShape()
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: GEAR_FACE_W,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.2,
      bevelThickness: 0.2,
      curveSegments: 6,
    })
    // ExtrudeGeometry +Z-be extrudál; mi a koszorút Z = -W..0 közé akarjuk.
    geom.translate(0, 0, -GEAR_FACE_W)
    return geom
  }, [])

  const hubGeom = useMemo(() => {
    const shape = buildHubShape()
    return new THREE.ExtrudeGeometry(shape, {
      depth: HUB_HEIGHT,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.3,
      bevelThickness: 0.3,
      curveSegments: 24,
    })
  }, [])

  useEffect(() => () => gearGeom.dispose(), [gearGeom])
  useEffect(() => () => hubGeom.dispose(), [hubGeom])

  // Set screwök: 2 db, a hub-középmagasságban (Z = HUB_HEIGHT/2).
  // Két szomszédos oldalon (a referencia képen ugyanazon a látható oldalon
  // 2 db hernyócsavar van — az egyik kissé feljebb mint a másik nem
  // jellemző, általában 90°-os elrendezésű 2 db). Itt: 0° és 90° azimuton.
  const screwAzimuths = [0, Math.PI / 2]
  const screwZ = HUB_HEIGHT / 2

  return (
    <group userData={{ componentId }}>
      <mesh geometry={gearGeom} material={steelMat} userData={{ componentId }} />
      <mesh geometry={hubGeom} material={steelMat} userData={{ componentId }} />
      {screwAzimuths.map((az, i) => {
        const x = (HUB_R - SET_SCREW_DEPTH / 2) * Math.cos(az)
        const y = (HUB_R - SET_SCREW_DEPTH / 2) * Math.sin(az)
        return (
          <mesh
            key={i}
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

/**
 * Medium: fogazat nélküli koszorú (tip-Ø henger) + hub henger + furat.
 * A fogazat látszólag eltűnik, csak a befoglaló hengerként jelenik meg —
 * a renderben kissé "tárcsának" tűnik, de tri-count szempontjából olcsó.
 */
export function PinionGear15M17TMedium({ componentId }: PartBuilderProps) {
  const steelMat = useSteelMaterial()
  return (
    <group userData={{ componentId }}>
      <mesh
        position={[0, 0, -GEAR_FACE_W / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={steelMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[TIP_R, TIP_R, GEAR_FACE_W, 32, 1, false]} />
      </mesh>
      <mesh
        position={[0, 0, HUB_HEIGHT / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={steelMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[HUB_R, HUB_R, HUB_HEIGHT, 24, 1, false]} />
      </mesh>
      {/* Furat — sötét belső "lyuk" effekt egy belső hengerrel (negatív geometria
       *  helyett egyszerűsítve egy small-radius lyukasztott formával). */}
      <mesh
        position={[0, 0, (HUB_HEIGHT - GEAR_FACE_W) / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[BORE_R, BORE_R, TOTAL_HEIGHT + 0.2, 24, 1, false]} />
        <meshStandardMaterial color="#050506" metalness={0.2} roughness={0.9} />
      </mesh>
    </group>
  )
}

/**
 * Sematikus: egyetlen henger a tip-átmérővel és teljes magassággal —
 * a renderer a regiszter színére override-olja.
 */
export function PinionGear15M17TSchematic({ componentId }: PartBuilderProps) {
  return (
    <mesh
      position={[0, 0, (HUB_HEIGHT - GEAR_FACE_W) / 2]}
      rotation={[Math.PI / 2, 0, 0]}
      userData={{ componentId }}
    >
      <cylinderGeometry args={[TIP_R, TIP_R, TOTAL_HEIGHT, 24, 1, false]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}

export const PINION_GEAR_15M_17T_DIMENSIONS = {
  module: MODULE_M,
  toothCount: TOOTH_COUNT,
  pressureAngleDeg: 20,
  pitchDiam: PITCH_R * 2,
  tipDiam: TIP_R * 2,
  rootDiam: ROOT_R * 2,
  boreDiam: BORE_DIAM,
  gearFaceWidth: GEAR_FACE_W,
  hubDiam: HUB_DIAM,
  hubHeight: HUB_HEIGHT,
  totalHeight: TOTAL_HEIGHT,
}

// ---------------------------------------------------------------------------
// Anchor-export — builder-lokális frame (+Z = furat iránya / tengely; origó
// a koszorú és hub találkozási síkján).
// ---------------------------------------------------------------------------
export const PINION_GEAR_15M_17T_ANCHORS: Record<string, Anchor> = {
  origin: {
    position: [0, 0, 0],
    axis: [0, 0, 1],
    description: 'Koszorú-hub határsík; +Z = tengely (gear face -Z, hub +Z).',
  },
  'gear-face-bottom': {
    position: [0, 0, -GEAR_FACE_W],
    axis: [0, 0, -1],
    description: 'A fogkoszorú alsó (motor felöli) síkja',
  },
  'hub-top': {
    position: [0, 0, +HUB_HEIGHT],
    axis: [0, 0, 1],
    description: 'A hub teteje (a tengely + axis vége)',
  },
  'pitch-mate': {
    position: [PITCH_R, 0, -GEAR_FACE_W / 2],
    axis: [1, 0, 0],
    description:
      'A pitch körön a meshing-partner érintkezési pontja (radiálisan +X-en, axiálisan a gear face közepén).',
  },
}
