import { Suspense, useMemo, useRef, useCallback, useEffect, memo } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import type { MachineConfig, TubeBenderConfig } from '../../types/machine-config'
import type { Position, DeviceStatus } from '../../types/device'
import CoordinateSystem from './CoordinateSystem'
import type { CameraState } from './MachineVisualization'

// =========================================
// KONVENCIÓ
// Three.js coords (Y-up), de objektumokat Z-magassággal helyezzük el (mint a többi viz).
// Az alábbi modell-konvenció ettől eltérően Y-up "felfelé" konvenciót használ
// a saját jelenetén belül (mint RobotArmVisualization).
//
//   +X = cső előtolás iránya (vízszintes)
//   +Y = függőleges felfelé
//   +Z = előrefelé az operátor felé (a hajlítás "default" iránya)
//
// Gép tengelyek -> Three.js mappingek:
//   gép X (lineáris, mm)       -> cső eltolás +X irányban
//   gép Y (rotációs, fok)      -> hajlító egység rotation.x (csőtengely körül)
//   gép Z (rotációs, fok)      -> hajlítókerék rotation.y (függőleges tengely körül)
// =========================================

const DEFAULT_GEOM: Required<Omit<TubeBenderConfig,
  'drive' | 'showBelt' | 'showCounterweightMotor' | 'showClampDie' | 'yMotorPulleyOnTop' |
  'supportChannelOpenSide' | 'maxBendAngle' |
  'maxTubeDiameter' | 'minBendRadius' | 'feedLength'
>> = {
  baseLength: 600,
  baseWidth: 200,
  baseHeight: 50,
  supportSpineThickness: 12,
  supportFlangeThickness: 12,
  tubeSpindleLength: 220,
  tubeSpindleDiameter: 40,
  tubeDiameter: 20,
  tubeLength: 600,
  bendDieRadius: 60,
  feedRollerDiameter: 60,
  feedRollerWidth: 40,
  upperArmLength: 100,
  lowerArmLength: 100,
  armWidth: 25,
  motorSize: 50,
  fixedPulleyDiameter: 100,
  fixedPulleyThickness: 20,
  bendDieDiameter: 130,
  bendDieThickness: 35,
}

interface ResolvedGeom {
  baseLength: number
  baseWidth: number
  baseHeight: number
  supportSpineThickness: number
  supportFlangeThickness: number
  supportChannelOpenSide: 'positive' | 'negative'
  tubeSpindleLength: number
  tubeSpindleDiameter: number
  tubeDiameter: number
  tubeLength: number
  bendDieRadius: number
  feedRollerDiameter: number
  feedRollerWidth: number
  upperArmLength: number
  lowerArmLength: number
  armWidth: number
  motorSize: number
  fixedPulleyDiameter: number
  fixedPulleyThickness: number
  bendDieDiameter: number
  bendDieThickness: number
  // származtatottak
  spindleY: number          // csőtengely Y magasság (alap tetejétől)
  pillowX: number           // párnacsapágy X-pozíciója (globálisan)
  fixedPulleyX: number      // fix bordástárcsa X-pozíciója
  tubeSpindleStartX: number // csőtengely kezdőpont X
  tubeSpindleEndX: number   // csőtengely végpont X (a párnacsapágynál)
  rollerX: number           // görgős előtoló X-pozíciója
  baseCenterX: number       // alap középpont X
  armVerticalLen: number    // S függőleges szegmens hossza
  drive: 'belt' | 'direct'
  showBelt: boolean
  showCounterweightMotor: boolean
  showClampDie: boolean
  yMotorPulleyOnTop: boolean
}

function resolveGeom(cfg?: TubeBenderConfig): ResolvedGeom {
  const merged = { ...DEFAULT_GEOM, ...cfg }
  // A csőtengely magassága az alap tetejéhez képest. A "+ baseHeight" extra
  // emelés azért, hogy a hajlító egység forgó kara se ütközzön az alappal/támasztóval,
  // és illeszkedjen a magasabb C profilú csőtengely-tartóhoz.
  const spindleY = Math.max(80, merged.baseHeight + 70) + merged.baseHeight
  const pillowX = 0
  const fixedPulleyX = pillowX - merged.fixedPulleyThickness / 2 - 10
  const tubeSpindleEndX = pillowX
  const tubeSpindleStartX = tubeSpindleEndX - merged.tubeSpindleLength
  const rollerX = tubeSpindleStartX + merged.feedRollerDiameter / 2 + 5
  // Alap középpont: a görgős előtoló és a hajlító egység párnacsapágya közötti közepe.
  const baseCenterX = (rollerX + pillowX) / 2
  return {
    ...merged,
    supportChannelOpenSide: cfg?.supportChannelOpenSide ?? 'positive',
    spindleY,
    pillowX,
    fixedPulleyX,
    tubeSpindleStartX,
    tubeSpindleEndX,
    rollerX,
    baseCenterX,
    armVerticalLen: Math.max(80, merged.upperArmLength * 1.2),
    drive: cfg?.drive ?? 'belt',
    showBelt: cfg?.showBelt ?? (cfg?.drive ?? 'belt') === 'belt',
    showCounterweightMotor: cfg?.showCounterweightMotor ?? (cfg?.drive ?? 'belt') === 'belt',
    showClampDie: cfg?.showClampDie ?? true,
    yMotorPulleyOnTop: cfg?.yMotorPulleyOnTop ?? true,
  }
}

// =========================================
// ANYAGOK (közös, memoizált a részegységekben)
// =========================================

function useFrameMaterial(color: string) {
  return useMemo(() => new THREE.MeshStandardMaterial({
    color,
    metalness: 0.7,
    roughness: 0.4,
  }), [color])
}

function useMotorMaterial() {
  return useMemo(() => new THREE.MeshStandardMaterial({
    color: '#2b2b30',
    metalness: 0.85,
    roughness: 0.3,
  }), [])
}

function useTubeMaterial() {
  return useMemo(() => new THREE.MeshStandardMaterial({
    color: '#bdbdbd',
    metalness: 0.7,
    roughness: 0.3,
  }), [])
}

// =========================================
// ALAP
// =========================================

interface BaseProps {
  geom: ResolvedGeom
  frameColor: string
}

const BaseBlock = memo(function BaseBlock({ geom, frameColor }: BaseProps) {
  const baseMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(frameColor).multiplyScalar(0.6),
    metalness: 0.9,
    roughness: 0.35,
  }), [frameColor])

  const edgeMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#444' }), [])

  const boxGeo = useMemo(
    () => new THREE.BoxGeometry(geom.baseLength, geom.baseHeight, geom.baseWidth),
    [geom.baseLength, geom.baseHeight, geom.baseWidth]
  )
  const edgeGeo = useMemo(() => new THREE.EdgesGeometry(boxGeo), [boxGeo])

  useEffect(() => () => {
    baseMat.dispose()
    edgeMat.dispose()
    boxGeo.dispose()
    edgeGeo.dispose()
  }, [baseMat, edgeMat, boxGeo, edgeGeo])

  return (
    <group position={[geom.baseCenterX, -geom.baseHeight / 2, 0]}>
      <mesh material={baseMat} geometry={boxGeo} />
      <lineSegments material={edgeMat} geometry={edgeGeo} />
    </group>
  )
})

// =========================================
// CSŐTENGELY-TARTÓ LEMEZ (a görgős oldalon)
// =========================================

interface SupportProps {
  geom: ResolvedGeom
  frameColor: string
}

const SpindleSupport = memo(function SpindleSupport({ geom, frameColor }: SupportProps) {
  const mat = useFrameMaterial(frameColor)
  const edgeMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#444' }), [])
  const width = geom.armWidth * 1.5
  // A tartó az alap aljától (Y = -baseHeight) a csőtengely tetejéig (Y = spindleY + tubeR) megy,
  // így baseHeight-tel magasabb mint korábban (lehatol az alap mellé/aljáig).
  const height = geom.spindleY + geom.tubeSpindleDiameter / 2 + geom.baseHeight
  const depth = geom.baseWidth * 0.6
  // X-pozíció: a csőtengely kezdeténél (hátsó vég), kis offsettel a görgős előtoló után.
  // Szándékosan közel a tubeSpindleStartX-hez, hogy a hajlító egység forgó karja
  // (X = 0 ... -upperArmLength) ne ütközzön a támasztóval.
  const supportX = geom.tubeSpindleStartX + width / 2 + 5
  // A tartó center Y-pozíciója: a felső perem spindleY + tubeR-en, az alsó -baseHeight-en
  const supportCenterY = (geom.spindleY + geom.tubeSpindleDiameter / 2 - geom.baseHeight) / 2

  // C profil 3 részre osztva, X irányba nyitott. A nyitott oldalon halad át
  // a hajlító egység Y motorja, amikor a hajlító egység körbeforog.
  const flange = Math.min(geom.supportFlangeThickness, height / 3)
  const spine = Math.min(geom.supportSpineThickness, width / 2)
  // A gerinc X oldala: 'positive' = nyitott X+ felé, gerinc X- oldalon (negatív X)
  const spineSign = geom.supportChannelOpenSide === 'positive' ? -1 : +1
  const spineX = spineSign * (width / 2 - spine / 2)

  const flangeGeo = useMemo(
    () => new THREE.BoxGeometry(width, flange, depth),
    [width, flange, depth]
  )
  const spineGeo = useMemo(
    () => new THREE.BoxGeometry(spine, height, depth),
    [spine, height, depth]
  )
  const flangeEdges = useMemo(() => new THREE.EdgesGeometry(flangeGeo), [flangeGeo])
  const spineEdges = useMemo(() => new THREE.EdgesGeometry(spineGeo), [spineGeo])

  useEffect(() => () => {
    mat.dispose()
    edgeMat.dispose()
    flangeGeo.dispose()
    spineGeo.dispose()
    flangeEdges.dispose()
    spineEdges.dispose()
  }, [mat, edgeMat, flangeGeo, spineGeo, flangeEdges, spineEdges])

  const topY = +height / 2 - flange / 2
  const bottomY = -height / 2 + flange / 2

  return (
    <group position={[supportX, supportCenterY, 0]}>
      {/* Felső szár */}
      <mesh position={[0, topY, 0]} material={mat} geometry={flangeGeo} />
      <lineSegments position={[0, topY, 0]} material={edgeMat} geometry={flangeEdges} />
      {/* Alsó szár */}
      <mesh position={[0, bottomY, 0]} material={mat} geometry={flangeGeo} />
      <lineSegments position={[0, bottomY, 0]} material={edgeMat} geometry={flangeEdges} />
      {/* Gerinc - a C háta, az ellentétes oldalon mint amerre nyitott */}
      <mesh position={[spineX, 0, 0]} material={mat} geometry={spineGeo} />
      <lineSegments position={[spineX, 0, 0]} material={edgeMat} geometry={spineEdges} />
    </group>
  )
})

// =========================================
// GÖRGŐS ELŐTOLÓ
// =========================================

interface RollersProps {
  geom: ResolvedGeom
  frameColor: string
  rollerSpinDeg: number // animált forgási szög (°), X mozgáskor pörög
}

const FeedRollers = memo(function FeedRollers({ geom, frameColor, rollerSpinDeg }: RollersProps) {
  const housingMat = useFrameMaterial(frameColor)
  const rollerMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#7a7a7a',
    metalness: 0.85,
    roughness: 0.25,
  }), [])
  const motorMat = useMotorMaterial()

  useEffect(() => () => {
    housingMat.dispose()
    rollerMat.dispose()
    motorMat.dispose()
  }, [housingMat, rollerMat, motorMat])

  const r = geom.feedRollerDiameter / 2
  const rollerSpin = THREE.MathUtils.degToRad(rollerSpinDeg)

  // Két görgő: felül és alul a cső körül (cső Y = spindleY)
  const upperY = geom.spindleY + r + geom.tubeDiameter / 2
  const lowerY = geom.spindleY - r - geom.tubeDiameter / 2

  return (
    <group position={[geom.rollerX, 0, 0]}>
      {/* Görgőház - keret a görgők körül */}
      <mesh
        position={[0, geom.spindleY, 0]}
        material={housingMat}
      >
        <boxGeometry args={[geom.feedRollerWidth + 20, r * 2.4 + geom.tubeDiameter + 30, geom.feedRollerWidth + 30]} />
      </mesh>

      {/* Felső görgő (Z-axis-aligned cylinder, hossza = feedRollerWidth) */}
      <mesh
        position={[0, upperY, 0]}
        rotation={[Math.PI / 2, rollerSpin, 0]}
        material={rollerMat}
      >
        <cylinderGeometry args={[r, r, geom.feedRollerWidth, 24]} />
      </mesh>

      {/* Alsó görgő */}
      <mesh
        position={[0, lowerY, 0]}
        rotation={[Math.PI / 2, -rollerSpin, 0]}
        material={rollerMat}
      >
        <cylinderGeometry args={[r, r, geom.feedRollerWidth, 24]} />
      </mesh>

      {/* X szervó/léptető motor a görgőház oldalán */}
      <mesh
        position={[0, geom.spindleY, geom.feedRollerWidth / 2 + 25 + geom.motorSize / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        material={motorMat}
      >
        <cylinderGeometry args={[geom.motorSize / 2, geom.motorSize / 2, geom.motorSize, 16]} />
      </mesh>
    </group>
  )
})

// =========================================
// CSŐTENGELY (X-axis-aligned cylinder, fix)
// =========================================

const TubeSpindle = memo(function TubeSpindle({ geom, frameColor }: SupportProps) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(frameColor).multiplyScalar(1.4),
    metalness: 0.85,
    roughness: 0.3,
  }), [frameColor])

  useEffect(() => () => { mat.dispose() }, [mat])

  const r = geom.tubeSpindleDiameter / 2
  const cx = (geom.tubeSpindleStartX + geom.tubeSpindleEndX) / 2

  return (
    <mesh
      position={[cx, geom.spindleY, 0]}
      rotation={[0, 0, Math.PI / 2]}
      material={mat}
    >
      <cylinderGeometry args={[r, r, geom.tubeSpindleLength, 24]} />
    </mesh>
  )
})

// =========================================
// FIX BORDÁSTÁRCSA (csőtengelyre rögzítve, soha nem forog)
// =========================================

const FixedPulley = memo(function FixedPulley({ geom }: { geom: ResolvedGeom }) {
  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#383840',
    metalness: 0.6,
    roughness: 0.5,
  }), [])
  const teethMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#22c55e',
    metalness: 0.5,
    roughness: 0.4,
    emissive: '#22c55e',
    emissiveIntensity: 0.1,
  }), [])

  useEffect(() => () => { bodyMat.dispose(); teethMat.dispose() }, [bodyMat, teethMat])

  const r = geom.fixedPulleyDiameter / 2

  return (
    <group position={[geom.fixedPulleyX, geom.spindleY, 0]} rotation={[0, 0, Math.PI / 2]}>
      {/* Korong test */}
      <mesh material={bodyMat}>
        <cylinderGeometry args={[r, r, geom.fixedPulleyThickness, 32]} />
      </mesh>
      {/* Fogazás vizuális jelölése - vékony zöld gyűrű a peremen */}
      <mesh material={teethMat}>
        <torusGeometry args={[r, geom.fixedPulleyThickness / 4, 8, 48]} />
      </mesh>
    </group>
  )
})

// =========================================
// MUNKADARAB CSŐ - egyenes szakasz (X mozgás)
// =========================================

interface StraightTubeProps {
  geom: ResolvedGeom
  pushOffset: number  // animált X eltolódás
}

const StraightTube = memo(function StraightTube({ geom, pushOffset }: StraightTubeProps) {
  const mat = useTubeMaterial()
  useEffect(() => () => { mat.dispose() }, [mat])

  const r = geom.tubeDiameter / 2
  // A cső a csőtengely kezdetétől a hajlítókerék kontaktpontjáig megy.
  // Tube-X-tartomány lokálisan: -L/2 ... +L/2.
  // A kerék kontaktpontja: pillowX (lokálisan a hajlító egység group-jában X=0,
  //   plusz a kar VÉGÉN: X=lowerArmLength). Globálisan: pillowX + lowerArmLength.
  // De az egyenes cső a kerékig megy => globális end X = pillowX + lowerArmLength.
  // pushOffset = pozitív érték = cső előretolódik (de a cső csak akkor mozog,
  // ha még van hossza a görgőkben). Egyszerűsítés: az egész cső tolódik el +X-szel.
  const tubeStartGlobalX = geom.tubeSpindleStartX - geom.tubeLength / 2 + pushOffset
  const tubeEndGlobalX = tubeStartGlobalX + geom.tubeLength
  const cx = (tubeStartGlobalX + tubeEndGlobalX) / 2

  return (
    <mesh
      position={[cx, geom.spindleY, 0]}
      rotation={[0, 0, Math.PI / 2]}
      material={mat}
    >
      <cylinderGeometry args={[r, r, geom.tubeLength, 16]} />
    </mesh>
  )
})

// =========================================
// HAJLÍTOTT CSŐ SZAKASZ (a hajlító egység group-jában, animZ-vel)
// =========================================

interface BentTubeProps {
  geom: ResolvedGeom
  bendAngleDeg: number   // animZ
  bendStart: [number, number, number]  // a kontaktpont (kerékhez érés) lokálisan
}

const BentTube = memo(function BentTube({ geom, bendAngleDeg, bendStart }: BentTubeProps) {
  const mat = useTubeMaterial()

  const tubeGeometry = useMemo(() => {
    const angle = THREE.MathUtils.degToRad(Math.max(-180, Math.min(180, bendAngleDeg)))
    const sign = angle >= 0 ? 1 : -1
    const absAngle = Math.abs(angle)
    if (absAngle < 0.005) {
      // egészen kicsi szögnél nincs ív, dummy üres geometria
      return new THREE.BufferGeometry()
    }
    const segments = Math.max(8, Math.ceil(absAngle / (Math.PI / 36)))
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= segments; i++) {
      const a = (absAngle * i) / segments
      // Kerék középpontja a kontaktponttól +Z irányban van bendDieRadius-szal eltolva.
      // A cső a kerék körül forog, a horony a kerék peremén (ami a kontaktpontból indul).
      // Lokális koordináták (bendStart-tól):
      const x = geom.bendDieRadius * Math.sin(a)
      const z = sign * (geom.bendDieRadius - geom.bendDieRadius * Math.cos(a))
      pts.push(new THREE.Vector3(bendStart[0] + x, bendStart[1], bendStart[2] + z))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    return new THREE.TubeGeometry(curve, segments * 2, geom.tubeDiameter / 2, 12, false)
  }, [bendAngleDeg, geom.bendDieRadius, geom.tubeDiameter, bendStart])

  useEffect(() => () => {
    mat.dispose()
    tubeGeometry.dispose()
  }, [mat, tubeGeometry])

  return <mesh material={mat} geometry={tubeGeometry} />
})

// =========================================
// HAJLÍTÓ EGYSÉG (Y körül forgó kompozit, oldalról S-alakú)
// =========================================

interface BendUnitProps {
  geom: ResolvedGeom
  frameColor: string
  yRotationDeg: number  // gép Y axis = forgás csőtengely (X) körül
  zRotationDeg: number  // gép Z axis = hajlítási szög
}

const BendUnit = memo(function BendUnit({ geom, frameColor, yRotationDeg, zRotationDeg }: BendUnitProps) {
  const armMat = useFrameMaterial(frameColor)
  const motorMat = useMotorMaterial()
  const gearboxMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#1f1f24',
    metalness: 0.7,
    roughness: 0.4,
  }), [])
  const dieMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#3b82f6',
    metalness: 0.55,
    roughness: 0.35,
    emissive: '#3b82f6',
    emissiveIntensity: 0.08,
  }), [])
  const pillowMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#22c55e',
    metalness: 0.6,
    roughness: 0.4,
    emissive: '#22c55e',
    emissiveIntensity: 0.08,
  }), [])
  const beltMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#1a1a1a',
    metalness: 0.2,
    roughness: 0.8,
  }), [])

  useEffect(() => () => {
    armMat.dispose()
    motorMat.dispose()
    gearboxMat.dispose()
    dieMat.dispose()
    pillowMat.dispose()
    beltMat.dispose()
  }, [armMat, motorMat, gearboxMat, dieMat, pillowMat, beltMat])

  const groupRef = useRef<THREE.Group>(null)
  const dieRef = useRef<THREE.Group>(null)
  const animY = useRef(0)
  const animZ = useRef(0)
  const isFirst = useRef(true)

  // Első rendereléskor azonnal a cél pozícióba ugrik
  useEffect(() => {
    if (isFirst.current) {
      animY.current = yRotationDeg
      animZ.current = zRotationDeg
      isFirst.current = false
    }
  }, [yRotationDeg, zRotationDeg])

  useFrame((_, delta) => {
    const lerpSpeed = 6
    if (Math.abs(yRotationDeg - animY.current) > 0.05) {
      animY.current = THREE.MathUtils.lerp(animY.current, yRotationDeg, Math.min(1, lerpSpeed * delta))
    } else {
      animY.current = yRotationDeg
    }
    if (Math.abs(zRotationDeg - animZ.current) > 0.05) {
      animZ.current = THREE.MathUtils.lerp(animZ.current, zRotationDeg, Math.min(1, lerpSpeed * delta))
    } else {
      animZ.current = zRotationDeg
    }
    if (groupRef.current) {
      // Forgás a csőtengely (X) körül
      groupRef.current.rotation.x = THREE.MathUtils.degToRad(animY.current)
    }
    if (dieRef.current) {
      // Hajlítókerék forgása (Y, függőleges tengely)
      dieRef.current.rotation.y = THREE.MathUtils.degToRad(animZ.current)
    }
  })

  const v = geom.armVerticalLen
  const w = geom.armWidth
  const upL = geom.upperArmLength
  const loL = geom.lowerArmLength
  const motorR = geom.motorSize / 2
  const dieR = geom.bendDieDiameter / 2

  // A párnacsapágy a hajlító egység group lokális [0,0,0]-jában van.
  // A csapágy felfelé függőleges szegmens, majd hátra (X-) a felső karon.
  // Lefelé függőleges szegmens, majd előre (X+) az alsó karon.
  // A hajlítókerék KONTAKTPONTJA a csővel (lokálisan): X = loL, Y = 0, Z = 0
  // A hajlítókerék KÖZÉPPONTJA: X = loL, Y = 0, Z = bendDieRadius
  const bendDieCenterLocal: [number, number, number] = [loL, 0, geom.bendDieRadius]
  const bendStartLocal: [number, number, number] = [loL, 0, 0]

  return (
    <group position={[geom.pillowX, geom.spindleY, 0]} ref={groupRef}>
      {/* Párnacsapágy - középen, a forgáspont */}
      <mesh material={pillowMat}>
        <boxGeometry args={[w * 1.4, w * 1.4, w * 2.2]} />
      </mesh>

      {/* === FELSŐ KAR (S felső szára) === */}
      {/* Függőleges szegmens (felfelé) */}
      <mesh position={[0, v / 2, 0]} material={armMat}>
        <boxGeometry args={[w, v, w]} />
      </mesh>
      {/* Vízszintes szegmens (hátrafelé X-) */}
      <mesh position={[-upL / 2, v, 0]} material={armMat}>
        <boxGeometry args={[upL, w, w]} />
      </mesh>
      {/* Y motor - a felső kar végén, hátrafelé néző tengellyel (X-axis-aligned).
          Ha yMotorPulleyOnTop = true, akkor a motor "fordítva" van szerelve, a szíjtárcsa a motor FELETT
          (a tengelye felfelé/elfelé az alaptól néz). Ekkor a bordásszíj a fix bordástárcsa FÖLÖTT halad át.
          Ha false, a tárcsa a motor ALATT (régi viselkedés). */}
      {geom.showCounterweightMotor && (
        <group position={[-upL - motorR, v, 0]}>
          {/* Motor henger (X-axis-aligned) */}
          <mesh rotation={[0, 0, Math.PI / 2]} material={motorMat}>
            <cylinderGeometry args={[motorR, motorR, geom.motorSize, 16]} />
          </mesh>
          {/* Szíjtárcsa - felül vagy alul a yMotorPulleyOnTop szerint */}
          <mesh
            position={[0, geom.yMotorPulleyOnTop ? motorR + 5 : -motorR - 5, 0]}
            rotation={[0, 0, Math.PI / 2]}
            material={pillowMat}
          >
            <cylinderGeometry args={[motorR * 0.7, motorR * 0.7, 12, 16]} />
          </mesh>
        </group>
      )}

      {/* === BORDÁSSZÍJ - a motor szíjtárcsája és a fix bordástárcsa között.
          yMotorPulleyOnTop = true: a tárcsa felül van, a szíj a fix bordástárcsa FELETT fut át. */}
      {geom.showBelt && (
        <BeltVisualization
          geom={geom}
          beltMat={beltMat}
          motorPulleyPos={[
            -upL - motorR,
            geom.yMotorPulleyOnTop ? v + motorR + 11 : v - motorR - 11,
            0,
          ]}
        />
      )}

      {/* === ALSÓ KAR (S alsó szára) === */}
      {/* Függőleges szegmens (lefelé) */}
      <mesh position={[0, -v / 2, 0]} material={armMat}>
        <boxGeometry args={[w, v, w]} />
      </mesh>
      {/* Vízszintes szegmens (előrefelé X+) */}
      <mesh position={[loL / 2, -v, 0]} material={armMat}>
        <boxGeometry args={[loL, w, w]} />
      </mesh>
      {/* Z motor - az alsó kar végén, előrefelé néző tengellyel (X-axis-aligned) */}
      <group position={[loL + motorR, -v, 0]}>
        {/* Motor henger (X-axis-aligned) */}
        <mesh rotation={[0, 0, Math.PI / 2]} material={motorMat}>
          <cylinderGeometry args={[motorR, motorR, geom.motorSize, 16]} />
        </mesh>
      </group>
      {/* Z gearbox - a motor és a kerék között */}
      <mesh position={[loL, -v + w * 1.2, 0]} material={gearboxMat}>
        <boxGeometry args={[w * 1.5, w * 2.4, w * 1.5]} />
      </mesh>
      {/* Hajlítókerék tartó tengely (függőleges, gearboxból a kerékig) */}
      <mesh position={[loL, -v / 2 + w, 0]} material={motorMat}>
        <cylinderGeometry args={[6, 6, v - w * 1.2, 12]} />
      </mesh>

      {/* === HAJLÍTÓKERÉK + behajlott cső szakasz === */}
      {/* A kerék külön group rotation.y-vel = animZ */}
      <group position={bendDieCenterLocal} ref={dieRef}>
        {/* Kerék test */}
        <mesh material={dieMat}>
          <cylinderGeometry args={[dieR, dieR, geom.bendDieThickness, 32]} />
        </mesh>
        {/* Horony jelölése - vékony torus a perem körül */}
        <mesh material={pillowMat}>
          <torusGeometry args={[dieR, geom.tubeDiameter / 2 * 0.9, 8, 48]} />
        </mesh>
      </group>

      {/* Szorítópofa (clamp die, statikus) */}
      {geom.showClampDie && (
        <mesh
          position={[loL - dieR * 0.5, 0, -dieR * 0.4]}
          material={gearboxMat}
        >
          <boxGeometry args={[dieR * 0.6, geom.tubeDiameter * 1.6, geom.tubeDiameter * 1.6]} />
        </mesh>
      )}

      {/* Behajlott cső szakasz (rotation.x-szel együtt forog a hajlító egységgel) */}
      <BentTube geom={geom} bendAngleDeg={zRotationDeg} bendStart={bendStartLocal} />
    </group>
  )
})

// =========================================
// BORDÁSSZÍJ vizualizáció (két párhuzamos szakasz)
// =========================================

interface BeltVisProps {
  geom: ResolvedGeom
  beltMat: THREE.Material
  motorPulleyPos: [number, number, number]
}

const BeltVisualization = memo(function BeltVisualization({ geom, beltMat, motorPulleyPos }: BeltVisProps) {
  // A bordásszíj a motor szíjtárcsája és a fix bordástárcsa felső (vagy alsó) peremét érinti tangenciálisan.
  // A fix bordástárcsa lokálisan a hajlító egység koordinátáiban: X = fixedPulleyX - pillowX, Y = 0, Z = 0
  const fixedPulleyLocalX = geom.fixedPulleyX - geom.pillowX
  const fixedPulleyR = geom.fixedPulleyDiameter / 2
  const motorPulleyR = geom.motorSize / 2 * 0.7

  // Melyik peremet érinti a szíj: ha a motor szíjtárcsája felül van, akkor a tárcsák FELSŐ peremét.
  const side = geom.yMotorPulleyOnTop ? +1 : -1

  // A motor szíjtárcsa középpontja és a fix bordástárcsa középpontja közötti tangenciális (érintő) szakasz
  // két végpontja a két tárcsa felső (ill. alsó) peremén:
  const startX = motorPulleyPos[0]
  const startY = motorPulleyPos[1] + side * motorPulleyR
  const endX = fixedPulleyLocalX
  const endY = 0 + side * fixedPulleyR
  const dx = endX - startX
  const dy = endY - startY
  const length = Math.sqrt(dx * dx + dy * dy)
  const angle = Math.atan2(dy, dx)  // Z körüli forgatás
  const cx = (startX + endX) / 2
  const cy = (startY + endY) / 2

  // Két párhuzamos szíjág Z irányban szétválasztva (a tárcsa szélességéhez igazítva)
  const thickness = 4
  const z1 = +Math.min(motorPulleyR, fixedPulleyR) * 0.85
  const z2 = -z1

  return (
    <group>
      {/* Két párhuzamos érintő szíjszakasz - ferde Z körüli forgással */}
      <mesh position={[cx, cy, z1]} rotation={[0, 0, angle]} material={beltMat}>
        <boxGeometry args={[length, thickness, thickness * 1.5]} />
      </mesh>
      <mesh position={[cx, cy, z2]} rotation={[0, 0, angle]} material={beltMat}>
        <boxGeometry args={[length, thickness, thickness * 1.5]} />
      </mesh>
    </group>
  )
})

// =========================================
// MUNKAKÖRNYEZET KERET (az alap körüli sávhoz)
// =========================================

const WorkArea = memo(function WorkArea({ geom }: { geom: ResolvedGeom }) {
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({
    color: '#3b82f6',
    opacity: 0.2,
    transparent: true,
  }), [])
  useEffect(() => () => { lineMat.dispose() }, [lineMat])

  const totalReach = geom.bendDieRadius + geom.lowerArmLength + 50
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = []
    const segments = 64
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const x = geom.pillowX + Math.cos(a) * totalReach
      const y = geom.spindleY + Math.sin(a) * totalReach
      pts.push(new THREE.Vector3(x, Math.max(0, y), 0))
    }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [totalReach, geom.pillowX, geom.spindleY])

  useEffect(() => () => { points.dispose() }, [points])

  return <lineLoop geometry={points} material={lineMat} />
})

// =========================================
// SCENE - teljes 3D jelenet
// =========================================

interface SceneProps {
  config: MachineConfig
  position?: Position
  status?: DeviceStatus
  cameraPosition?: { x: number; y: number; z: number }
  cameraTarget?: { x: number; y: number; z: number }
  cameraFov?: number
  onCameraChange?: (state: CameraState) => void
}

function Scene({
  config,
  position,
  cameraPosition,
  cameraTarget,
  cameraFov,
  onCameraChange,
}: SceneProps) {
  const currentPos = position ?? { x: 0, y: 0, z: 0 }
  const geom = useMemo(() => resolveGeom(config.tubeBender), [config.tubeBender])
  const frameColor = config.visuals?.frameColor ?? '#2d2d2d'

  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const prevCameraPositionRef = useRef<string>('')
  const prevCameraTargetRef = useRef<string>('')
  const prevCameraFovRef = useRef<number>(40)

  const target = cameraTarget ?? { x: 0, y: geom.spindleY, z: 0 }

  useEffect(() => {
    if (cameraPosition) {
      const newPosKey = `${cameraPosition.x},${cameraPosition.y},${cameraPosition.z}`
      if (newPosKey !== prevCameraPositionRef.current) {
        camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z)
        prevCameraPositionRef.current = newPosKey
      }
    }
  }, [camera, cameraPosition])

  useEffect(() => {
    if (cameraTarget && controlsRef.current) {
      const key = `${cameraTarget.x},${cameraTarget.y},${cameraTarget.z}`
      if (key !== prevCameraTargetRef.current) {
        controlsRef.current.target.set(cameraTarget.x, cameraTarget.y, cameraTarget.z)
        controlsRef.current.update()
        prevCameraTargetRef.current = key
      }
    }
  }, [cameraTarget])

  useEffect(() => {
    if (cameraFov && cameraFov !== prevCameraFovRef.current) {
      (camera as THREE.PerspectiveCamera).fov = cameraFov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix()
      prevCameraFovRef.current = cameraFov
    }
  }, [camera, cameraFov])

  // Throttle camera change
  const lastUpdate = useRef(0)
  const handleCameraChange = useCallback(() => {
    const now = Date.now()
    if (now - lastUpdate.current < 100) return
    lastUpdate.current = now
    if (onCameraChange && controlsRef.current) {
      onCameraChange({
        position: {
          x: Math.round(camera.position.x),
          y: Math.round(camera.position.y),
          z: Math.round(camera.position.z),
        },
        target: {
          x: Math.round(controlsRef.current.target.x),
          y: Math.round(controlsRef.current.target.y),
          z: Math.round(controlsRef.current.target.z),
        },
      })
    }
  }, [camera, onCameraChange])

  // Animációs ref-ek a görgőhöz (X mozgás követése)
  const lastPushXRef = useRef(currentPos.x ?? 0)
  const rollerSpinRef = useRef(0)
  useFrame((_, delta) => {
    const px = currentPos.x ?? 0
    const dx = px - lastPushXRef.current
    lastPushXRef.current = px
    if (Math.abs(dx) > 0.001) {
      // 1 mm előtolás = 360 / (Ø*pi) fok görgőforgás (közelítőleg).
      // Egyszerűsítés: 1 mm = 4° görgőforgás.
      rollerSpinRef.current += dx * (360 / (Math.PI * geom.feedRollerDiameter))
    } else if (delta > 0) {
      // lassú lecsillapodás (statikus jelenetben nem pörögjön)
    }
  })

  return (
    <>
      {/* Megvilágítás */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[300, 400, 400]} intensity={1.1} castShadow />
      <directionalLight position={[-200, 300, -200]} intensity={0.4} />
      <pointLight position={[0, 250, 0]} intensity={0.3} />

      {/* Kamera vezérlés */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        minDistance={100}
        maxDistance={2500}
        target={[target.x, target.y, target.z]}
        onChange={handleCameraChange}
      />

      {/* Padlórács */}
      {config.visuals?.showGrid !== false && (
        <Grid
          args={[1500, 1500]}
          position={[geom.baseCenterX, -geom.baseHeight - 0.5, 0]}
          cellSize={20}
          cellThickness={0.3}
          cellColor="#252525"
          sectionSize={100}
          sectionThickness={0.8}
          sectionColor="#ffffff"
          fadeDistance={1500}
        />
      )}

      {/* Koordináta rendszer az origónál */}
      {config.visuals?.showAxesHelper !== false && (
        <CoordinateSystem size={80} />
      )}

      {/* Munkaterület körív */}
      <WorkArea geom={geom} />

      {/* Statikus elemek */}
      <BaseBlock geom={geom} frameColor={frameColor} />
      <SpindleSupport geom={geom} frameColor={frameColor} />
      <FeedRollers geom={geom} frameColor={frameColor} rollerSpinDeg={rollerSpinRef.current} />
      <TubeSpindle geom={geom} frameColor={frameColor} />
      <FixedPulley geom={geom} />

      {/* Munkadarab cső - egyenes szakasz, X-szel eltolódik */}
      <StraightTube geom={geom} pushOffset={currentPos.x ?? 0} />

      {/* Hajlító egység (Y körül forgó) */}
      <BendUnit
        geom={geom}
        frameColor={frameColor}
        yRotationDeg={currentPos.y ?? 0}
        zRotationDeg={currentPos.z ?? 0}
      />
    </>
  )
}

// =========================================
// FŐ KOMPONENS
// =========================================

interface Props {
  config: MachineConfig
  position?: Position
  status?: DeviceStatus
  className?: string
  onCameraChange?: (state: CameraState) => void
}

function TubeBenderVisualizationInner({
  config,
  position,
  status,
  className = '',
  onCameraChange,
}: Props) {
  const bgColor = config.visuals?.backgroundColor ?? '#0a0a0f'

  const defaultCamPos = useMemo(() => ({
    x: 500,
    y: 350,
    z: 600,
  }), [])
  const cameraPos = config.visuals?.cameraPosition ?? defaultCamPos
  const cameraTarget = config.visuals?.cameraTarget ?? { x: 0, y: 120, z: 0 }
  const cameraFov = config.visuals?.cameraFov ?? 40

  return (
    <div className={`w-full h-full rounded-lg overflow-hidden ${className}`}>
      <Canvas
        camera={{
          position: [cameraPos.x, cameraPos.y, cameraPos.z],
          fov: cameraFov,
          near: 1,
          far: 5000,
        }}
        style={{ background: bgColor }}
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <Scene
            config={config}
            position={position}
            status={status}
            cameraPosition={cameraPos}
            cameraTarget={cameraTarget}
            cameraFov={cameraFov}
            onCameraChange={onCameraChange}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}

const TubeBenderVisualization = memo(TubeBenderVisualizationInner)
export default TubeBenderVisualization
