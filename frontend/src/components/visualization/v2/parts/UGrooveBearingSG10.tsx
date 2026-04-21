/**
 * SG10 U-groove (V-groove) görgőscsapágy + dedikált M4 × 17 mm vállas csavar.
 *
 * Termék: "SG10 M6 M8 Screw Bolts Bearing U-groove Track Guide Roller Bearing
 *   Textile Machine Pulley Bearings"
 *   Aktuális változat: **SG10 + special screw M4 × 17 mm** (a felhasználó által
 *   mellékelt termékkép szerint).
 *
 * MÉRETEK A TERMÉKKÉP SZERINT (mind mm-ben):
 *   - Belső furat (csavar mérete):     Ø4
 *   - Külső átmérő (race teljes):       Ø13
 *   - Vastagság (axiális):              6
 *   - Hornyolat (groove) szélessége:    4   (a U-horony nyitott szélessége OD-n)
 *   - Hornyolat mélysége:               1   (radiálisan a OD-tól befelé)
 *   - Slot ("inner ring") referencia:   5   (a futófelület belső átmérője — itt
 *                                           a hornyolat ALJÁN mért átmérő nem,
 *                                           hanem a belső gyűrű-vastagság jelzője;
 *                                           vizualizációban nem használjuk
 *                                           külön, mert a Ø4 furat + Ø13 OD
 *                                           párral teljes a profil)
 *
 * SPECIÁLIS M4 × 17 CSAVAR (a csapágyhoz illesztett, VÁLLAS shoulder bolt):
 *   - Fej átmérője:    Ø7
 *   - Fej magassága:   ~3       (alacsony pan-head, becslés)
 *   - Vállas / sima szakasz Ø:  ~4   (a csapágy Ø4 belső furatának illesztéséhez)
 *   - Menetes szár Ø:  ~3.7     (M4 menet külső Ø-je 3.85, belső 3.24 — itt
 *                                vizualizációhoz Ø3.7-re egyszerűsítve)
 *   - Menetes szár hossza: ~10
 *   - Sima vállas szakasz hossza: ~4 (= a csapágy vastagsága + ~kis clearance,
 *                                     hogy a fej a csapágy külső gyűrűjére
 *                                     fekszen fel, ne pedig az inner race-re)
 *   - TELJES hossz (head-től menet végéig): 17
 *
 * U-HORONY (V-GROOVE) PROFIL:
 *   A csapágy KERESZTMETSZETE (X = radiális távolság a tengelytől, Y = axiális
 *   irány a csapágyon belül) az alábbi outline-t adja a fél-térben (Y mentén
 *   szimmetrikus):
 *     - alsó él (race tetejétől távol): X = 0..OD/2 = 0..6.5
 *     - felső él (race közepe felé):    a OD-tól GROOVE_DEPTH-nel BENT (V-alak)
 *       a horony szélessége GROOVE_W = 4, mélysége GROOVE_DEPTH = 1.
 *   A LatheGeometry-vel forgatva a csapágy teljes 3D testét megkapjuk.
 *
 * Builder lokális orientáció:
 *   - +Z = a csavar / csapágy KÖZÖS tengelye (a furat iránya)
 *   - Origó: a csapágy GEOMETRIAI KÖZÉPPONTJA (a Ø13 race közepe, axiálisan
 *     a 6 mm vastag race közepén). A csavar fejjel előrefelé (Z = -) áll, a
 *     menetes vége +Z felé hosszabb, így a csapágyat befogva tartja:
 *       - Csavar fej tetı:       Z = -BEARING_T/2 - SHOULDER_L
 *                               = -3 - 4 = -7
 *       - Csavar fej alja:       Z = -7 + HEAD_T = -7 + 3 = -4
 *       - Sima vállas szakasz:   Z = -4 .. 0      (sima Ø4 → fele a csapágyban)
 *       - Csapágy bele:          Z = -BEARING_T/2 = -3 .. +3 (Ø4 furat itt)
 *       - Sima vállas szakasz vége: Z = 0 .. +3 (a csapágy mögött a sima rész
 *         folytatódik, hogy a fej pontosan a csapágyra fekszen)
 *       - Menetes szár:          Z = +3 .. +13 (M4 menet ~10 mm)
 *     A csavar fej-alapja a csapágy egyik oldalához ér, a menetes szár a túloldalon
 *     ~10 mm-rel kilóg → a 17 mm teljes hossz: HEAD(3) + SHOULDER(4) + BEARING(6)
 *     teljes átmenet (de a vállas a csapágyban van) + MENET(10) - átfedés...
 *   ↑ Egyszerűbb felbontás: HEAD(3) + SHOULDER(4) + THREAD(10) = 17. A vállas
 *     szakasz pont a csapágyon megy át (4 mm sima ≈ 6 mm csapágy + 2 mm menet
 *     a csapágy másik oldalán látható). A pontos hosszviszonyok a termékfotón
 *     láthatóak; a renderben az ÖSSZHOSSZ pontos (17 mm).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'

// ---- Csapágy méretei ----
const BORE_DIAM = 4
const BORE_R = BORE_DIAM / 2
const OD = 13
const OUTER_R = OD / 2
const BEARING_T = 6
const GROOVE_W = 4
const GROOVE_DEPTH = 1

// ---- Csavar méretei ----
const SCREW_TOTAL_LENGTH = 17
const SCREW_HEAD_DIAM = 7
const SCREW_HEAD_R = SCREW_HEAD_DIAM / 2
const SCREW_HEAD_T = 3
const SCREW_SHOULDER_DIAM = BORE_DIAM
const SCREW_SHOULDER_R = SCREW_SHOULDER_DIAM / 2
const SCREW_SHOULDER_L = 4
const SCREW_THREAD_DIAM = 3.7
const SCREW_THREAD_R = SCREW_THREAD_DIAM / 2
const SCREW_THREAD_L =
  SCREW_TOTAL_LENGTH - SCREW_HEAD_T - SCREW_SHOULDER_L

// ---- Material hookok ----

function useBearingOuterMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#c0c2c5',
        metalness: 0.85,
        roughness: 0.25,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function useBearingSealMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1a1c',
        metalness: 0.05,
        roughness: 0.85,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function useBearingInnerMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#9a9d9f',
        metalness: 0.85,
        roughness: 0.32,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function useScrewBlackOxideMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2a2a2d',
        metalness: 0.7,
        roughness: 0.5,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

// ---- Csapágy geometria ----

/**
 * U-horony (V-groove) profil pontjainak építése a LatheGeometry-hez.
 * X = radiális távolság a tengelytől, Y = axiális koordináta a csapágyon belül
 * (a csapágy közepe Y = 0).
 *
 * A profil egy "U" kontúrt rajzol az alábbi sorrendben (CCW a Lathe szempontjából):
 *   1. (BORE_R, -BEARING_T/2)   — bal-belső sarok (a furat mellett)
 *   2. (OUTER_R, -BEARING_T/2)  — bal-külső sarok
 *   3. (OUTER_R, -GROOVE_W/2)   — felfelé az OD-n a horony széléig
 *   4. (OUTER_R - GROOVE_DEPTH, 0) — befelé-le a V-csúcsig (a horony alja)
 *   5. (OUTER_R, +GROOVE_W/2)   — vissza fel-ki a horony másik szélére
 *   6. (OUTER_R, +BEARING_T/2)  — jobb-külső sarok
 *   7. (BORE_R, +BEARING_T/2)   — jobb-belső sarok
 *   és a Lathe a tengelynél (X=0) zárja le.
 *
 * Megjegyzés: a Lathe alapesetben a Y tengely körül forgat, így a builder-lokális
 * tengely Y mentén áll. A `buildBearingLatheGeometry()`-ben rotálunk Z körül π/2-vel,
 * hogy a csapágy tengelye builder-lokális +Z-be essen.
 */
function buildBearingProfilePoints(): THREE.Vector2[] {
  return [
    new THREE.Vector2(BORE_R, -BEARING_T / 2),
    new THREE.Vector2(OUTER_R, -BEARING_T / 2),
    new THREE.Vector2(OUTER_R, -GROOVE_W / 2),
    new THREE.Vector2(OUTER_R - GROOVE_DEPTH, 0),
    new THREE.Vector2(OUTER_R, +GROOVE_W / 2),
    new THREE.Vector2(OUTER_R, +BEARING_T / 2),
    new THREE.Vector2(BORE_R, +BEARING_T / 2),
  ]
}

function buildBearingLatheGeometry(): THREE.LatheGeometry {
  const geom = new THREE.LatheGeometry(buildBearingProfilePoints(), 64)
  // Lathe forgástengely = builder-Y. Forgatjuk Z körül π/2-vel, így a tengely +Z lesz.
  // Ekkor az X (radiális) tengely Y mentén marad, a Y (axiális) tengely átfordul Z-be.
  // Kompozíció: (X, Y, Z) → (X·cos+Y·sin, -X·sin+Y·cos, Z) hagyományosan, de itt a
  // BufferGeometry rotateX/rotateY/rotateZ helyettesítik a megoldást.
  geom.rotateX(Math.PI / 2)
  return geom
}

/**
 * Két lapos szigetelő/seal annulus a csapágy két lapján (vizuálisan a két
 * fekete tömítőgyűrű a referenciaképen). A seal a OD és a BORE között foglal
 * helyet egy kis (~0.3 mm) résben, a két lapon kifelé.
 */
function buildSealRingShape(): THREE.Shape {
  const sealOuterR = OUTER_R - GROOVE_DEPTH - 0.4
  const sealInnerR = BORE_R + 0.5
  const shape = new THREE.Shape()
  shape.absarc(0, 0, sealOuterR, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  hole.absarc(0, 0, sealInnerR, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  return shape
}

function buildSealGeometry(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildSealRingShape(), {
    depth: 0.3,
    bevelEnabled: false,
    curveSegments: 48,
  })
  return geom
}

/**
 * Realisztikus csapágy: lathe-extrude race + 2 db fekete seal annulus + belső
 * race-utalás (egy kis, sötétebb gyűrű a furat körül a 2 lap belsejében).
 */
function BearingRealistic({ componentId }: PartBuilderProps) {
  const outerMat = useBearingOuterMaterial()
  const sealMat = useBearingSealMaterial()
  const innerMat = useBearingInnerMaterial()

  const raceGeom = useMemo(() => buildBearingLatheGeometry(), [])
  const sealGeom = useMemo(() => buildSealGeometry(), [])

  useEffect(
    () => () => {
      raceGeom.dispose()
      sealGeom.dispose()
    },
    [raceGeom, sealGeom],
  )

  return (
    <group userData={{ componentId }}>
      <mesh material={outerMat} geometry={raceGeom} userData={{ componentId }} />

      {/* Két oldali fekete seal annulus a race két lapján. */}
      {([-BEARING_T / 2 + 0.01, +BEARING_T / 2 - 0.31] as const).map((z, i) => (
        <mesh
          key={`seal-${i}`}
          position={[0, 0, z]}
          material={sealMat}
          geometry={sealGeom}
          userData={{ componentId }}
        />
      ))}

      {/* Belső race utalás — kis enyhén sötétebb gyűrű a furat körül,
          a két oldali laponal belül, hogy a csapágy szerkezete érzékelhető legyen. */}
      {([-BEARING_T / 2 + 0.31, +BEARING_T / 2 - 0.31] as const).map((z, i) => (
        <mesh
          key={`inner-${i}`}
          position={[0, 0, z]}
          rotation={[Math.PI / 2, 0, 0]}
          material={innerMat}
          userData={{ componentId }}
        >
          <torusGeometry args={[BORE_R + 0.6, 0.3, 6, 32]} />
        </mesh>
      ))}
    </group>
  )
}

// ---- Csavar geometria ----

/**
 * Realisztikus csavar: 3 szakasz (fej + sima vállas + menetes), mind a +Z
 * mentén egymás után. A csavar tengelye = builder +Z, a fej -Z-felé van.
 *
 * - Csavar fej (Z = -SCREW_TOTAL/2 .. -SCREW_TOTAL/2 + HEAD_T): Ø7 × 3 mm
 * - Sima vállas (Z = HEAD vége .. HEAD vége + SHOULDER_L): Ø4 × 4 mm
 * - Menetes szár (Z = SHOULDER vége .. +SCREW_TOTAL/2): Ø3.7 × 10 mm
 *
 * A renderben a vállas szakasz pontosan a csapágy belső furatában megy át,
 * így a fej a csapágy egyik lapjára fekszik fel, a menetes szár pedig a
 * túloldalon kilóg ~3-4 mm-rel (a gyors befogásra alkalmas).
 */
function ScrewRealistic({ componentId }: PartBuilderProps) {
  const screwMat = useScrewBlackOxideMaterial()
  return (
    <group userData={{ componentId }}>
      {/* Csavar fej — a csavar -Z végén, a csapágytól TÁVOLABB. */}
      <mesh
        position={[0, 0, -SCREW_TOTAL_LENGTH / 2 + SCREW_HEAD_T / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={screwMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[SCREW_HEAD_R, SCREW_HEAD_R, SCREW_HEAD_T, 24]} />
      </mesh>
      {/* Sima vállas szakasz — a csapágy furatában fut, Ø4. */}
      <mesh
        position={[
          0,
          0,
          -SCREW_TOTAL_LENGTH / 2 + SCREW_HEAD_T + SCREW_SHOULDER_L / 2,
        ]}
        rotation={[Math.PI / 2, 0, 0]}
        material={screwMat}
        userData={{ componentId }}
      >
        <cylinderGeometry
          args={[SCREW_SHOULDER_R, SCREW_SHOULDER_R, SCREW_SHOULDER_L, 16]}
        />
      </mesh>
      {/* Menetes szár — Ø3.7 × 10 mm, a csapágy túloldalán kilógva. */}
      <mesh
        position={[
          0,
          0,
          -SCREW_TOTAL_LENGTH / 2 +
            SCREW_HEAD_T +
            SCREW_SHOULDER_L +
            SCREW_THREAD_L / 2,
        ]}
        rotation={[Math.PI / 2, 0, 0]}
        material={screwMat}
        userData={{ componentId }}
      >
        <cylinderGeometry
          args={[SCREW_THREAD_R, SCREW_THREAD_R, SCREW_THREAD_L, 12]}
        />
      </mesh>
    </group>
  )
}

// ---- LOD belépési pontok (csapágy + csavar együtt) ----

/**
 * Realisztikus: U-horony lathe + 2 seal + 2 inner-race utalás + dedikált
 * M4 × 17 csavar a csapágy közepén áthúzva.
 */
export function UGrooveBearingSG10Realistic(props: PartBuilderProps) {
  return (
    <group userData={{ componentId: props.componentId }}>
      <BearingRealistic componentId={props.componentId} />
      <ScrewRealistic componentId={props.componentId} />
    </group>
  )
}

/**
 * Medium: csak a csapágy lathe (seal-ek nélkül) + a csavar 3 szakaszban.
 */
export function UGrooveBearingSG10Medium({ componentId }: PartBuilderProps) {
  const outerMat = useBearingOuterMaterial()
  const screwMat = useScrewBlackOxideMaterial()
  const raceGeom = useMemo(() => buildBearingLatheGeometry(), [])
  useEffect(() => () => raceGeom.dispose(), [raceGeom])

  return (
    <group userData={{ componentId }}>
      <mesh material={outerMat} geometry={raceGeom} userData={{ componentId }} />
      {/* Csavar fej. */}
      <mesh
        position={[0, 0, -SCREW_TOTAL_LENGTH / 2 + SCREW_HEAD_T / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={screwMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[SCREW_HEAD_R, SCREW_HEAD_R, SCREW_HEAD_T, 16]} />
      </mesh>
      {/* Egyesített szár (vállas + menet együtt egyetlen Ø4 hengerként). */}
      <mesh
        position={[
          0,
          0,
          -SCREW_TOTAL_LENGTH / 2 +
            SCREW_HEAD_T +
            (SCREW_SHOULDER_L + SCREW_THREAD_L) / 2,
        ]}
        rotation={[Math.PI / 2, 0, 0]}
        material={screwMat}
        userData={{ componentId }}
      >
        <cylinderGeometry
          args={[
            SCREW_SHOULDER_R,
            SCREW_SHOULDER_R,
            SCREW_SHOULDER_L + SCREW_THREAD_L,
            12,
          ]}
        />
      </mesh>
    </group>
  )
}

/**
 * Sematikus: tömör Ø13 × 6 henger + egy hosszú Ø4 × 17 henger a tengely mentén.
 * A renderer override-olja a regiszter színre.
 */
export function UGrooveBearingSG10Schematic({ componentId }: PartBuilderProps) {
  return (
    <group userData={{ componentId }}>
      <mesh rotation={[Math.PI / 2, 0, 0]} userData={{ componentId }}>
        <cylinderGeometry args={[OUTER_R, OUTER_R, BEARING_T, 24]} />
        <meshStandardMaterial color="#888" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} userData={{ componentId }}>
        <cylinderGeometry
          args={[SCREW_HEAD_R, SCREW_HEAD_R, SCREW_TOTAL_LENGTH, 16]}
        />
        <meshStandardMaterial color="#666" />
      </mesh>
    </group>
  )
}

export const U_GROOVE_BEARING_SG10_DIMENSIONS = {
  boreDiam: BORE_DIAM,
  outerDiam: OD,
  thickness: BEARING_T,
  grooveWidth: GROOVE_W,
  grooveDepth: GROOVE_DEPTH,
  screwTotalLength: SCREW_TOTAL_LENGTH,
  screwHeadDiam: SCREW_HEAD_DIAM,
  screwHeadHeight: SCREW_HEAD_T,
  screwShoulderDiam: SCREW_SHOULDER_DIAM,
  screwShoulderLength: SCREW_SHOULDER_L,
  screwThreadDiam: SCREW_THREAD_DIAM,
  screwThreadLength: SCREW_THREAD_L,
  /** Teljes axiális kiterjedés — a csavar fejtől a menet végéig. */
  totalAxialLength: SCREW_TOTAL_LENGTH,
}
