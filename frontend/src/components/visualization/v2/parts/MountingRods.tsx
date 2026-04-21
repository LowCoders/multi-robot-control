/**
 * Menetes szár szerelvény — 4 db M5 menetes szár + 16 db M5 hex anya, ami a NEMA 23
 * motort tartja KÉT függőleges konzol között (`függőleges konzol 1` elöl és
 * `függőleges konzol 2` hátul).
 *
 * Funkcionális leírás:
 *   - 4 db M5 menetes szár halad keresztül a motor 47.14 mm pattern szerinti
 *     rögzítő furatain (a flange Ø5.1 ÁTMENŐ furatain), majd a `függőleges konzol 2`
 *     4 db Ø5.1 átmenő furatán is.
 *   - A motor a HÁTSÓ konzol (bracket-2) zsebébe (4 mm mély, motor body silhouette)
 *     fekszik fel — a motor back face a zseb fenekéhez ér, így a motor és bracket-2
 *     KÖZVETLENÜL érintkeznek (közöttük NINCS anya).
 *   - A szár TELJES végén (bracket-2 HÁTSÓ oldalán) ÚJ végeanya rögzíti bracket-2-t
 *     a száron — ez fogja össze a motort a hátsó konzollal.
 *   - A szár későbbi (motoron túli, +X irányú) szakaszán a `függőleges konzol 1` is
 *     rögzítve van mindkét oldalról hex anyával — bracket-1 független mechanikai
 *     rögzítése a száron, ami megengedi a motor +X felé való elcsúsztatását úgy,
 *     hogy a body keresztülmegy bracket-1 cutout-ján.
 *   - A szár LEGFELÜL (motor flange előlapja előtt) anya rögzíti a motor flange-et
 *     a száron.
 *
 * Builder lokális orientáció:
 *   - +Z = motor tengelyiránya (a konzol forgatása után = world +X).
 *   - Component origó: a motor közepe (a regiszter `transform.position`-je
 *     ugyanaz, mint a motoré: bracket-1-local (0, +50, MOTOR_OFFSET_Z)).
 *
 * Az 5 anya-pozíció minden száron (component-lokális Z-ben), motor közepétől
 * hátulról előre haladva:
 *   1. **bracket-2 hátsó anya** (rod-end): Z = bracket-2 back face Z - clearance - h/2
 *      ≈ -69.4 — ez fogja össze bracket-2-t a motorral.
 *   2. **bracket-1 hátsó anya**: Z = +(bracket-1 back face) - clearance ≈ -1.4
 *      (a motor body BELSEJÉBE esik — fade-módban látható).
 *   3. **bracket-1 elülső anya**: Z = +(bracket-1 front face) + clearance ≈ +13.4
 *      (a motor body BELSEJÉBE esik — fade-módban látható).
 *   4. **motor előlap MÖGÖTTI anya** (ÚJ): Z = +BODY_HALF - mountFlangeLength
 *      - clearance - h/2 ≈ +53.6 — a motor flange BACK face-e mögött, az iron
 *      body main belsejében (fade-módban látható), a motor flange-et a szárhoz
 *      rögzíti hátulról.
 *   5. **gear-bracket BELSŐ anya** (ÚJ): Z = gear-bracket front face + clearance
 *      + h/2 ≈ +73.4 — a gear-bracket-1 base wall-jának ELÜLSŐ (U-belseji)
 *      oldalán, a U-cavity-ben. Ez szorítja a gear-bracket-et hátrafelé a motor
 *      flange front face-éhez.
 *
 * MEGSZŰNT (átszervezve):
 *   - A régi "motor flange előlapi anya" (motor és gear-bracket KÖZÖTT, motor-Z
 *     ≈ +63.4): TÖRÖLVE. Helyette az új #4 (motor flange mögött) és #5 (gear-
 *     bracket belsejében) anyák szorítják össze ezt a két felületet KÖZVETLEN
 *     érintkezésre, anya nélkül a kettő közöttük.
 *   - A régi "motor hátlap-anya" (a motor hátulja a száron) — bracket-2 zsebe
 *     pótolja: a motor back face KÖZVETLENÜL a zseb fenekére fekszik fel.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PartBuilderProps } from '../types'
import { NEMA23_BOLT_PATTERN } from './_motorSilhouette'
import { GEAR_BRACKET_DIMENSIONS } from './GearBracket'
import { NEMA23_MOTOR_DIMENSIONS } from './Nema23Motor'
import { VERTICAL_BRACKET_1_DIMENSIONS } from './VerticalBracket1'
import { VERTICAL_BRACKET_2_DIMENSIONS } from './VerticalBracket2'

/** M5 menetes szár — egyszerűsítve sima Ø5 hengerként ábrázoljuk. */
const ROD_DIAM = 5

/** M5 hex anya — DIN 934 szerint. Across-flats = 8 mm, magasság = 4 mm. */
const NUT_AF = 8
const NUT_HEIGHT = 4
/** Cylinder geometry RadialSegments=6 → hex prism. A radius = corner-to-center,
 *  amit AF (across-flats) → AF / sqrt(3) képlettel kapunk meg. */
const NUT_RADIUS = NUT_AF / Math.sqrt(3) // ≈ 4.62 mm

const BODY_HALF = NEMA23_MOTOR_DIMENSIONS.bodyLength / 2
const PLATE_HALF_T = VERTICAL_BRACKET_1_DIMENSIONS.thickness / 2
const PLATE2_HALF_T = VERTICAL_BRACKET_2_DIMENSIONS.thickness / 2
const POCKET_DEPTH = VERTICAL_BRACKET_2_DIMENSIONS.pocketDepth

/** A motor bracket-1-lokális Z-eltolása (a regiszterben). +60 mm-rel előre csúsztatva
 *  az eredeti -66-ról. Ha ezt változtatjuk, itt is frissíteni kell. */
const MOTOR_OFFSET_Z = -6

/** Anyák között hagyott kis hézag (mm) — csak vizuális, hogy elváljanak a body-tól. */
const CLEARANCE = 0.4

/** Komponens-lokális Z tengelye = motor tengelye, origó = motor közepén.
 *  Motor flange előlapja: Z = +BODY_HALF, motor hátlapja: Z = -BODY_HALF.
 *
 *  ÚJ #4 — motor flange BACK face-e MÖGÖTTI anya (az iron body main belsejében).
 *  A flange motor-Z = +BODY_HALF - mountFlangeLength .. +BODY_HALF közé esik
 *  (= +56..+61). A flange back face mögötti anya: */
const MOTOR_FLANGE_BACK_Z = +BODY_HALF - NEMA23_MOTOR_DIMENSIONS.mountFlangeLength // = +56
const MOTOR_BACK_OF_FLANGE_NUT_Z = MOTOR_FLANGE_BACK_Z - CLEARANCE - NUT_HEIGHT / 2 // ≈ +53.6

/** ÚJ #5 — gear-bracket-1 BELSŐ (U-cavity-beli) anyája: a base wall front face-e
 *  ELŐTT, a U szárai között. A gear-bracket-1 base wall back face KÖZVETLENÜL
 *  érintkezik a motor flange front face-ével (motor-Z = +BODY_HALF = +61),
 *  vagyis a base wall front face = +61 + materialThickness. */
const GEAR_BRACKET_BACK_Z = +BODY_HALF // = +61 (közvetlenül a motor flange-en)
const GEAR_BRACKET_FRONT_Z = GEAR_BRACKET_BACK_Z + GEAR_BRACKET_DIMENSIONS.materialThickness // = +71
const GEAR_BRACKET_INSIDE_NUT_Z = GEAR_BRACKET_FRONT_Z + CLEARANCE + NUT_HEIGHT / 2 // ≈ +73.4

/** Bracket-1 a komponens-lokálisban: bracket-1-lokális Z = -PLATE_HALF_T..+PLATE_HALF_T,
 *  és component-lokális Z = bracket-1-lokális Z - MOTOR_OFFSET_Z. */
const BRACKET1_BACK_Z = -PLATE_HALF_T - MOTOR_OFFSET_Z // = -5 - (-6) = +1
const BRACKET1_FRONT_Z = +PLATE_HALF_T - MOTOR_OFFSET_Z // = +5 - (-6) = +11
const BRACKET1_BACK_NUT_Z = BRACKET1_BACK_Z - CLEARANCE - NUT_HEIGHT / 2 // ≈ -1.4
const BRACKET1_FRONT_NUT_Z = BRACKET1_FRONT_Z + CLEARANCE + NUT_HEIGHT / 2 // ≈ +13.4

/** Bracket-2 a komponens-lokálisban: a zseb feneke a motor hátlapját érinti,
 *  vagyis bracket-2 front face = motor back face + POCKET_DEPTH. Ezért:
 *  bracket-2 center component-local Z = (-BODY_HALF) + POCKET_DEPTH - PLATE2_HALF_T.
 *  Pl. -61 + 4 - 5 = -62.  Bracket-2 back face: -62 - 5 = -67. */
const BRACKET2_CENTER_Z = -BODY_HALF + POCKET_DEPTH - PLATE2_HALF_T
const BRACKET2_BACK_Z = BRACKET2_CENTER_Z - PLATE2_HALF_T // ≈ -67
/** A szár ABSOLÚT végén: bracket-2 hátsó síkja mögött a végeanya. */
const BRACKET2_END_NUT_Z = BRACKET2_BACK_Z - CLEARANCE - NUT_HEIGHT / 2 // ≈ -69.4

/** Anya-pozíciók a komponens-lokális Z tengelyen, hátulról előre haladva. */
const NUT_Z_POSITIONS: number[] = [
  BRACKET2_END_NUT_Z,
  BRACKET1_BACK_NUT_Z,
  BRACKET1_FRONT_NUT_Z,
  MOTOR_BACK_OF_FLANGE_NUT_Z,
  GEAR_BRACKET_INSIDE_NUT_Z,
]

/** Szár-vég puffer (mm) — a legszélső anya után még ennyivel túlnyúlik a szár vége. */
const ROD_END_PADDING = 3
const ROD_MIN_Z = Math.min(...NUT_Z_POSITIONS) - ROD_END_PADDING
const ROD_MAX_Z = Math.max(...NUT_Z_POSITIONS) + ROD_END_PADDING
/** A szár (cylinder) közepe a komponens-lokálisban (NEM 0, mert az elrendezés
 *  aszimmetrikus: a hátsó konzol (bracket-2) mögé nyúlik a leghátsó anya, az
 *  elülső konzol (bracket-1) mögött pedig a motor flange + anya). */
const ROD_CENTER_Z = (ROD_MIN_Z + ROD_MAX_Z) / 2
/** A szár teljes hossza (mm). */
const ROD_LENGTH = ROD_MAX_Z - ROD_MIN_Z

/** A 4 szár-pozíció a komponens-lokális (X, Y) síkban (47.14 mm négyzet pattern,
 *  a motor csavar-furatainak megfelelően). */
const HALF_BP = NEMA23_BOLT_PATTERN / 2
const ROD_OFFSETS: Array<[number, number]> = [
  [-HALF_BP, -HALF_BP],
  [+HALF_BP, -HALF_BP],
  [+HALF_BP, +HALF_BP],
  [-HALF_BP, +HALF_BP],
]

/** Cinkezett acél menetes szár — semleges szürke. */
function useRodMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#9a9ca0',
        metalness: 0.85,
        roughness: 0.42,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

/** Sötétebb hex anya — DIN 934. */
function useNutMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3d3f44',
        metalness: 0.88,
        roughness: 0.45,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

/** Realisztikus: 4 db M5 szár + 20 db M5 hex anya (5/szár). */
export function MountingRodsRealistic({ componentId }: PartBuilderProps) {
  const rodMat = useRodMaterial()
  const nutMat = useNutMaterial()
  return (
    <group userData={{ componentId }}>
      {ROD_OFFSETS.map(([dx, dy], i) => (
        <group key={i}>
          {/* M5 menetes szár — egyszerűsített Ø5 henger a tengely mentén (Z). */}
          <mesh
            position={[dx, dy, ROD_CENTER_Z]}
            rotation={[Math.PI / 2, 0, 0]}
            material={rodMat}
            userData={{ componentId }}
          >
            <cylinderGeometry args={[ROD_DIAM / 2, ROD_DIAM / 2, ROD_LENGTH, 12]} />
          </mesh>
          {/* 5 db M5 hex anya minden száron: bracket-2 vég-anya, bracket-1 hátulja, bracket-1 eleje, motor flange MÖGÖTTE (iron body belsejében), gear-bracket BELSEJÉBEN (U-cavity). */}
          {NUT_Z_POSITIONS.map((nz, j) => (
            <mesh
              key={j}
              position={[dx, dy, nz]}
              rotation={[Math.PI / 2, 0, 0]}
              material={nutMat}
              userData={{ componentId }}
            >
              <cylinderGeometry args={[NUT_RADIUS, NUT_RADIUS, NUT_HEIGHT, 6]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

/** Medium: 4 db szár, anyák nélkül. */
export function MountingRodsMedium({ componentId }: PartBuilderProps) {
  const rodMat = useRodMaterial()
  return (
    <group userData={{ componentId }}>
      {ROD_OFFSETS.map(([dx, dy], i) => (
        <mesh
          key={i}
          position={[dx, dy, ROD_CENTER_Z]}
          rotation={[Math.PI / 2, 0, 0]}
          material={rodMat}
          userData={{ componentId }}
        >
          <cylinderGeometry args={[ROD_DIAM / 2, ROD_DIAM / 2, ROD_LENGTH, 8]} />
        </mesh>
      ))}
    </group>
  )
}

/** Sematikus: 4 db vékony szár, a renderer override-olja a komponens színére. */
export function MountingRodsSchematic({ componentId }: PartBuilderProps) {
  return (
    <group userData={{ componentId }}>
      {ROD_OFFSETS.map(([dx, dy], i) => (
        <mesh
          key={i}
          position={[dx, dy, ROD_CENTER_Z]}
          rotation={[Math.PI / 2, 0, 0]}
          userData={{ componentId }}
        >
          <cylinderGeometry args={[ROD_DIAM / 2, ROD_DIAM / 2, ROD_LENGTH, 6]} />
          <meshStandardMaterial color="#888" />
        </mesh>
      ))}
    </group>
  )
}

export const MOUNTING_RODS_DIMENSIONS = {
  rodDiam: ROD_DIAM,
  rodLength: ROD_LENGTH,
  numRods: ROD_OFFSETS.length,
  nutAcrossFlats: NUT_AF,
  nutHeight: NUT_HEIGHT,
  numNutsPerRod: NUT_Z_POSITIONS.length,
  motorOffsetZ: MOTOR_OFFSET_Z,
  /** A komponens transform.position-jéhez ezt használjuk a regiszterben. */
  componentLocalCenter: { y: VERTICAL_BRACKET_1_DIMENSIONS.cutoutCenterY, z: MOTOR_OFFSET_Z },
}
