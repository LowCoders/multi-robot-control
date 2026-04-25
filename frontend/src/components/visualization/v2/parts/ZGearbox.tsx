/**
 * Bolygóhajtómű (planetary gearbox) — STEPPERONLINE NEMA 23-hoz, 60×60 mm flange.
 *
 * Termék: STEPPERONLINE Nema 23 Planetary Gearbox High Precision Speed Reducer
 *   for Nema 23 (57 mm), 8 mm input shaft variant, áttétel 20:1.
 *   Termékvonal: PLE60 / PLF60 sorozat.
 *
 * Geometria a gyári műszaki rajz alapján (mm):
 *   - **Output flange** (kimenetoldali rögzítő perem): 60 × 60 × 5 mm négyzet
 *     - 4 db Ø5.5 mm átmenő furat a 47.14 × 47.14 mm pattern szerint a 4 sarkon
 *       (a hajtómű terhelés-oldali rögzítéséhez)
 *     - Központi alignment boss: Ø40 mm, 3 mm-rel kiáll a flange előlapjából
 *     - Output shaft: Ø14 mm, **35 mm** hosszan kiáll a flange előlapjától,
 *       D-cut 25 mm hosszan (egyszerűsítve sima hengerként ábrázolva).
 *   - **Test** (cilindrikus házszakasz): Ø58 mm × ~79.5 mm hosszú, fémes-szürke.
 *   - **Input flange** (motor felöli): 60 × 60 × 5 mm négyzet
 *     - 4 db **M5↓10 mm** menetes furat a 47.14 pattern szerint (a NEMA 23 motor
 *       rögzítéséhez; a felhasználó által M4-ről M5-re módosítva, mert a motor
 *       Ø5.1 furatain M5 csavarok mennek át a menetes furatokba).
 *     - Központi Ø8G6 input bore (NEMA 23 motor 8 mm-es tengelyét fogadja)
 *   - Teljes hossz output flange előlapjától input flange hátlapjáig: **89.5 mm**.
 *
 * Áttétel: 20:1 (egyfokozatú bolygóhajtómű, a "20" / "50" konfiguráció közül).
 * A geometria mindkét áttételnél azonos (a fokozatszám csak a belső fogazatra van hatással).
 *
 * Builder lokális orientáció:
 *   - +Z = a hajtómű FŐTENGELYE (input → output irány).
 *   - Origó: a TEST geometriai középpontja (X=0, Y=0, Z=0).
 *   - Output flange: Z = +TOTAL_LENGTH/2 .. +TOTAL_LENGTH/2 - OUTPUT_FLANGE_T,
 *     az alignment boss + shaft a +Z félteret folytatva.
 *   - Input flange: Z = -TOTAL_LENGTH/2 .. -TOTAL_LENGTH/2 + INPUT_FLANGE_T,
 *     az input bore a -Z félteret folytatva.
 *   - A regiszter +π/2 Y-körüli forgatása mappolja: builder +Z → world +X,
 *     vagyis az output shaft +X irányba mutat (ugyanaz mint a motor tengelye).
 *
 * Pozicionálás: jelenleg KÜLÖNÁLLÓAN, a motor szerelvényétől eltolva (a fő
 * X-tengelyen, de a base-en kívül +Z irányba) — a felhasználó később illeszti
 * a motor szerelvényhez.
 *
 * LOD szintek:
 *   - schematic: tömör doboz a teljes bbox-szal (60×60×(89.5+35+3)).
 *   - medium:    flange-ek + body-cilinder + shaft + boss, furatok nélkül.
 *   - realistic: ugyanaz + 4 db Ø5.5 furat az output flange-en (ExtrudeGeometry-vel),
 *                + 4 db M5 cosmetic recess + Ø8 input bore recess az input flange-en.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Anchor, PartBuilderProps } from '../types'

// ---- alapvető méretek ----
const FLANGE_W = 60
const OUTPUT_FLANGE_T = 5
const INPUT_FLANGE_T = 5

const BODY_DIAM = 58
const TOTAL_BODY_LENGTH = 89.5 // output flange előlap → input flange hátlap
const BODY_CYL_LENGTH = TOTAL_BODY_LENGTH - OUTPUT_FLANGE_T - INPUT_FLANGE_T // ≈ 79.5

const MOUNT_PATTERN = 47.14 // NEMA 23 std bolt pattern
const OUTPUT_BOLT_HOLE_D = 5.5 // Ø5.5 átmenő furat az output flange-en
/** Input-oldali menetes furat átmérő: **M5** (a felhasználó által módosítva
 *  M4-ről M5-re, mivel a NEMA 23 motor M5-ös csavarokkal van rögzítve). */
const INPUT_THREAD_D = 5
const INPUT_BORE_D = 8 // Ø8G6 input shaft bore

const CENTER_BOSS_D = 40
const CENTER_BOSS_H = 3

const OUTPUT_SHAFT_D = 14
const OUTPUT_SHAFT_LENGTH = 35

// ---- Z poziciók (builder lokálisban; origó = test közepe) ----
const HALF_BODY = TOTAL_BODY_LENGTH / 2 // ≈ 44.75
const OUTPUT_FACE_Z = +HALF_BODY // output flange előlapja
const INPUT_FACE_Z = -HALF_BODY // input flange hátlapja

// ---- színek / anyagok ----

/** Gearbox házszín — sötét anodizált alumínium / fekete por szóró. */
function useHousingMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3a3d42',
        metalness: 0.78,
        roughness: 0.42,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

/** Flange szín — világosabb alumínium (rendszerint élt-eloxált flange-ek). */
function useFlangeMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#8e9097',
        metalness: 0.7,
        roughness: 0.4,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

/** Acél tengely — fényes ezüst-szürke. */
function useShaftMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#b8babf',
        metalness: 0.9,
        roughness: 0.22,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

/** Furatok / recess sötét háttér — átmenő furatok és menetes recesszek vizuális mélysége. */
function useDarkRecessMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#15171a',
        metalness: 0.4,
        roughness: 0.85,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

// ---- shape-ek ----

/** Output flange Shape: 60×60 négyzet 4 db Ø5.5 sarok-furattal a 47.14 pattern szerint. */
function buildOutputFlangeShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-FLANGE_W / 2, -FLANGE_W / 2)
  shape.lineTo(+FLANGE_W / 2, -FLANGE_W / 2)
  shape.lineTo(+FLANGE_W / 2, +FLANGE_W / 2)
  shape.lineTo(-FLANGE_W / 2, +FLANGE_W / 2)
  shape.closePath()

  const halfBP = MOUNT_PATTERN / 2
  const r = OUTPUT_BOLT_HOLE_D / 2
  const boltPositions: Array<[number, number]> = [
    [-halfBP, -halfBP],
    [+halfBP, -halfBP],
    [+halfBP, +halfBP],
    [-halfBP, +halfBP],
  ]
  for (const [px, py] of boltPositions) {
    const hole = new THREE.Path()
    hole.absarc(px, py, r, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }
  return shape
}

/** Output flange ExtrudeGeometry: 5 mm vastag, sarok-furatokkal, builder Z = +HALF_BODY-OUTPUT_FLANGE_T .. +HALF_BODY. */
function buildOutputFlangeGeom(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildOutputFlangeShape(), {
    depth: OUTPUT_FLANGE_T,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geom.translate(0, 0, OUTPUT_FACE_Z - OUTPUT_FLANGE_T)
  return geom
}

/** Input flange Shape: 60×60 négyzet, sarok-furatok NÉLKÜL (M5 menetes furatok cosmetic
 *  recesszekkel ábrázolva, lásd a külön komponenseket). */
function buildInputFlangeShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-FLANGE_W / 2, -FLANGE_W / 2)
  shape.lineTo(+FLANGE_W / 2, -FLANGE_W / 2)
  shape.lineTo(+FLANGE_W / 2, +FLANGE_W / 2)
  shape.lineTo(-FLANGE_W / 2, +FLANGE_W / 2)
  shape.closePath()
  return shape
}

/** Input flange ExtrudeGeometry: builder Z = -HALF_BODY .. -HALF_BODY+INPUT_FLANGE_T. */
function buildInputFlangeGeom(): THREE.ExtrudeGeometry {
  const geom = new THREE.ExtrudeGeometry(buildInputFlangeShape(), {
    depth: INPUT_FLANGE_T,
    bevelEnabled: false,
    curveSegments: 8,
  })
  geom.translate(0, 0, INPUT_FACE_Z)
  return geom
}

// ---- LOD-okat segítő alkomponensek ----

/** Output flange 4 db Ø5.5 átmenő furattal + center boss + shaft. */
function OutputFlangeAssembly({ componentId }: PartBuilderProps) {
  const flangeMat = useFlangeMaterial()
  const housingMat = useHousingMaterial()
  const shaftMat = useShaftMaterial()

  const flangeGeom = useMemo(() => buildOutputFlangeGeom(), [])
  useEffect(() => () => flangeGeom.dispose(), [flangeGeom])

  return (
    <group userData={{ componentId }}>
      {/* Flange (sarok-furatokkal) */}
      <mesh material={flangeMat} geometry={flangeGeom} userData={{ componentId }} />
      {/* Központi alignment boss (Ø40 × 3 mm) — kiáll a flange előlapja előtt */}
      <mesh
        position={[0, 0, OUTPUT_FACE_Z + CENTER_BOSS_H / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={housingMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[CENTER_BOSS_D / 2, CENTER_BOSS_D / 2, CENTER_BOSS_H, 32]} />
      </mesh>
      {/* Output shaft (Ø14 × 35 mm a flange-előlapától) */}
      <mesh
        position={[0, 0, OUTPUT_FACE_Z + OUTPUT_SHAFT_LENGTH / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={shaftMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[OUTPUT_SHAFT_D / 2, OUTPUT_SHAFT_D / 2, OUTPUT_SHAFT_LENGTH, 24]} />
      </mesh>
    </group>
  )
}

/** Input flange + bemeneti M5 menetes recesszek + Ø8G6 input bore. */
function InputFlangeAssembly({
  componentId,
  showRecesses,
}: PartBuilderProps & { showRecesses: boolean }) {
  const flangeMat = useFlangeMaterial()
  const recessMat = useDarkRecessMaterial()

  const flangeGeom = useMemo(() => buildInputFlangeGeom(), [])
  useEffect(() => () => flangeGeom.dispose(), [flangeGeom])

  const halfBP = MOUNT_PATTERN / 2
  const THREAD_RECESS_DEPTH = 1.2 // vizuális mélység (a tényleges menet 10 mm, csak felszíni jelzés)
  const THREAD_RECESS_R = (INPUT_THREAD_D + 0.4) / 2 // M5 furat-átmérő ~5.4 mm-es körrel
  const recessFaceZ = INPUT_FACE_Z + THREAD_RECESS_DEPTH / 2 + 0.01 // épp a flange hátlapján

  return (
    <group userData={{ componentId }}>
      <mesh material={flangeMat} geometry={flangeGeom} userData={{ componentId }} />
      {showRecesses && (
        <>
          {/* 4 db M5 menetes furat — vizuális recesszek a hátlapon */}
          {([
            [-halfBP, -halfBP],
            [+halfBP, -halfBP],
            [+halfBP, +halfBP],
            [-halfBP, +halfBP],
          ] as Array<[number, number]>).map(([px, py], i) => (
            <mesh
              key={`m5-${i}`}
              position={[px, py, recessFaceZ]}
              rotation={[Math.PI / 2, 0, 0]}
              material={recessMat}
              userData={{ componentId }}
            >
              <cylinderGeometry args={[THREAD_RECESS_R, THREAD_RECESS_R, THREAD_RECESS_DEPTH, 12]} />
            </mesh>
          ))}
          {/* Ø8G6 input bore — kissé mélyebb cosmetic recess a középen */}
          <mesh
            position={[0, 0, INPUT_FACE_Z + 4 / 2 + 0.01]}
            rotation={[Math.PI / 2, 0, 0]}
            material={recessMat}
            userData={{ componentId }}
          >
            <cylinderGeometry args={[INPUT_BORE_D / 2, INPUT_BORE_D / 2, 4, 24]} />
          </mesh>
        </>
      )}
    </group>
  )
}

/** Central body — Ø58 mm-es henger a két flange között. */
function BodyCylinder({ componentId }: PartBuilderProps) {
  const housingMat = useHousingMaterial()
  return (
    <mesh
      position={[0, 0, 0]}
      rotation={[Math.PI / 2, 0, 0]}
      material={housingMat}
      userData={{ componentId }}
    >
      <cylinderGeometry args={[BODY_DIAM / 2, BODY_DIAM / 2, BODY_CYL_LENGTH, 48]} />
    </mesh>
  )
}

// ---- LOD belépési pontok ----

/** Realisztikus: teljes geometria, output flange 4 sarok-furattal,
 *  input flange M5 + Ø8 recesszekkel, central boss, output shaft. */
export function ZGearboxRealistic({ componentId }: PartBuilderProps) {
  return (
    <group userData={{ componentId }}>
      <OutputFlangeAssembly componentId={componentId} />
      <BodyCylinder componentId={componentId} />
      <InputFlangeAssembly componentId={componentId} showRecesses />
    </group>
  )
}

/** Medium: flange-ek + body + shaft + boss, sarok-furatok és cosmetic recesszek nélkül. */
export function ZGearboxMedium({ componentId }: PartBuilderProps) {
  const flangeMat = useFlangeMaterial()
  const housingMat = useHousingMaterial()
  const shaftMat = useShaftMaterial()
  return (
    <group userData={{ componentId }}>
      {/* Output flange (egyszerű box, furatok nélkül) */}
      <mesh
        position={[0, 0, OUTPUT_FACE_Z - OUTPUT_FLANGE_T / 2]}
        material={flangeMat}
        userData={{ componentId }}
      >
        <boxGeometry args={[FLANGE_W, FLANGE_W, OUTPUT_FLANGE_T]} />
      </mesh>
      {/* Boss + shaft */}
      <mesh
        position={[0, 0, OUTPUT_FACE_Z + CENTER_BOSS_H / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={housingMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[CENTER_BOSS_D / 2, CENTER_BOSS_D / 2, CENTER_BOSS_H, 24]} />
      </mesh>
      <mesh
        position={[0, 0, OUTPUT_FACE_Z + OUTPUT_SHAFT_LENGTH / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={shaftMat}
        userData={{ componentId }}
      >
        <cylinderGeometry args={[OUTPUT_SHAFT_D / 2, OUTPUT_SHAFT_D / 2, OUTPUT_SHAFT_LENGTH, 16]} />
      </mesh>
      <BodyCylinder componentId={componentId} />
      <mesh
        position={[0, 0, INPUT_FACE_Z + INPUT_FLANGE_T / 2]}
        material={flangeMat}
        userData={{ componentId }}
      >
        <boxGeometry args={[FLANGE_W, FLANGE_W, INPUT_FLANGE_T]} />
      </mesh>
    </group>
  )
}

/** Sematikus: tömör doboz a teljes szerelvény bbox-szal — a renderer override-olja
 *  a regiszter színére. */
export function ZGearboxSchematic({ componentId }: PartBuilderProps) {
  const totalZ = TOTAL_BODY_LENGTH + CENTER_BOSS_H + OUTPUT_SHAFT_LENGTH
  // Origó = test középpontja, így a doboz +Z-irányban erősebben kinyúlik (boss + shaft).
  const centerZ = (-(TOTAL_BODY_LENGTH / 2) + (TOTAL_BODY_LENGTH / 2 + CENTER_BOSS_H + OUTPUT_SHAFT_LENGTH)) / 2
  return (
    <mesh position={[0, 0, centerZ]} userData={{ componentId }}>
      <boxGeometry args={[FLANGE_W, FLANGE_W, totalZ]} />
      <meshStandardMaterial color="#888" />
    </mesh>
  )
}

export const Z_GEARBOX_DIMENSIONS = {
  flangeWidth: FLANGE_W,
  outputFlangeThickness: OUTPUT_FLANGE_T,
  inputFlangeThickness: INPUT_FLANGE_T,
  bodyDiameter: BODY_DIAM,
  bodyTotalLength: TOTAL_BODY_LENGTH,
  bodyCylLength: BODY_CYL_LENGTH,
  mountPattern: MOUNT_PATTERN,
  outputBoltHoleDiam: OUTPUT_BOLT_HOLE_D,
  inputThreadDiam: INPUT_THREAD_D,
  inputBoreDiam: INPUT_BORE_D,
  centerBossDiam: CENTER_BOSS_D,
  centerBossHeight: CENTER_BOSS_H,
  outputShaftDiam: OUTPUT_SHAFT_D,
  outputShaftLength: OUTPUT_SHAFT_LENGTH,
  /** Teljes Z-tengely menti kiterjedés a builder lokálisban: input flange hátlapjától output shaft tetejéig. */
  totalLengthWithShaft: TOTAL_BODY_LENGTH + CENTER_BOSS_H + OUTPUT_SHAFT_LENGTH,
}

// ---------------------------------------------------------------------------
// Anchor-export — builder-lokális frame-ben (+Z = hajtómű főtengelye)
// ---------------------------------------------------------------------------
export const Z_GEARBOX_ANCHORS: Record<string, Anchor> = {
  origin: {
    position: [0, 0, 0],
    axis: [0, 0, 1],
    description: 'A test geometriai középpontja; +Z = hajtómű főtengelye (input → output)',
  },
  'output-shaft-tip': {
    position: [0, 0, OUTPUT_FACE_Z + CENTER_BOSS_H + OUTPUT_SHAFT_LENGTH],
    axis: [0, 0, 1],
    description: 'Output (Ø14) tengely vége +Z mentén',
  },
  'output-flange-front': {
    position: [0, 0, OUTPUT_FACE_Z],
    axis: [0, 0, 1],
    description: 'Output flange előlapja (terhelés-oldali rögzítő felület)',
  },
  'input-flange-back': {
    position: [0, 0, INPUT_FACE_Z],
    axis: [0, 0, 1],
    description:
      'Input flange hátlapja (motor felöli felület). Axis = +Z (a teljes szerelvény főtengelyének iránya, input → output) — itt fekszik a NEMA 23 motor `mount-flange-front` anchor-ja, axisok parallel-aligned.',
  },
  'input-bore-center': {
    position: [0, 0, INPUT_FACE_Z + INPUT_FLANGE_T],
    axis: [0, 0, 1],
    description: 'Input Ø8G6 bore belső kezdete (a NEMA 23 motor tengelye ide nyúlik be)',
  },
}
