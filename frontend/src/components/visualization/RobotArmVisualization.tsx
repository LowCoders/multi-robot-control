import { Suspense, useMemo, useRef, useCallback, useEffect, memo } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import type { MachineConfig, RobotArmConfig } from '../../types/machine-config'
import type { Position, DeviceStatus, GripperState } from '../../types/device'
import CoordinateSystem from './CoordinateSystem'
import type { CameraState } from './MachineVisualization'

// =========================================
// ROBOT ARM BASE - Álló talp és forgó alap
// =========================================

interface RobotBaseProps {
  diameter: number
  height: number
  frameColor?: string
}

const RobotBase = memo(function RobotBase({ diameter, height, frameColor = '#2d2d2d' }: RobotBaseProps) {
  const radius = diameter / 2

  const baseBodyMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: frameColor,
    metalness: 0.7,
    roughness: 0.4,
  }), [frameColor])

  useEffect(() => {
    return () => {
      baseBodyMaterial.dispose()
    }
  }, [baseBodyMaterial])

  return (
    <group>
      {/* Bázis henger */}
      <mesh position={[0, 0, height / 2]} material={baseBodyMaterial}>
        <cylinderGeometry args={[radius, radius * 1.1, height, 32]} />
      </mesh>
    </group>
  )
})

// =========================================
// ARM JOINT - Ízületi csukló vizualizáció
// =========================================

interface JointProps {
  radius: number
  color: string
}

const Joint = memo(function Joint({ radius, color }: JointProps) {
  const jointMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#333',
    metalness: 0.8,
    roughness: 0.3,
  }), [])

  const ringMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color,
    metalness: 0.6,
    roughness: 0.4,
    emissive: color,
    emissiveIntensity: 0.15,
  }), [color])

  useEffect(() => {
    return () => {
      jointMaterial.dispose()
      ringMaterial.dispose()
    }
  }, [jointMaterial, ringMaterial])

  return (
    <group>
      {/* Csukló gömb */}
      <mesh material={jointMaterial}>
        <sphereGeometry args={[radius, 16, 16]} />
      </mesh>
      {/* Szín gyűrű */}
      <mesh rotation={[Math.PI / 2, 0, 0]} material={ringMaterial}>
        <torusGeometry args={[radius * 1.05, 2, 8, 24]} />
      </mesh>
    </group>
  )
})

// =========================================
// ARM LINK - Kar szegmens
// =========================================

interface ArmLinkProps {
  length: number
  width: number
  color: string
  frameColor?: string
}

const ArmLink = memo(function ArmLink({ length, width, color, frameColor = '#3a3a3a' }: ArmLinkProps) {
  const armMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: frameColor,
    metalness: 0.7,
    roughness: 0.35,
  }), [frameColor])

  const stripeMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color,
    metalness: 0.5,
    roughness: 0.5,
  }), [color])

  const edgeMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: '#555' }), [])

  const boxGeometry = useMemo(() =>
    new THREE.BoxGeometry(width, width * 0.6, length),
    [width, length]
  )
  const edgesGeometry = useMemo(() =>
    new THREE.EdgesGeometry(boxGeometry),
    [boxGeometry]
  )

  useEffect(() => {
    return () => {
      armMaterial.dispose()
      stripeMaterial.dispose()
      edgeMaterial.dispose()
      boxGeometry.dispose()
      edgesGeometry.dispose()
    }
  }, [armMaterial, stripeMaterial, edgeMaterial, boxGeometry, edgesGeometry])

  return (
    <group>
      {/* Kar test */}
      <mesh position={[0, 0, length / 2]} material={armMaterial} geometry={boxGeometry} />
      <lineSegments position={[0, 0, length / 2]} geometry={edgesGeometry} material={edgeMaterial} />

      {/* Szín csík a kar oldalán */}
      <mesh position={[width / 2 + 0.5, 0, length / 2]} material={stripeMaterial}>
        <boxGeometry args={[1.5, width * 0.4, length * 0.8]} />
      </mesh>
      <mesh position={[-width / 2 - 0.5, 0, length / 2]} material={stripeMaterial}>
        <boxGeometry args={[1.5, width * 0.4, length * 0.8]} />
      </mesh>
    </group>
  )
})

// =========================================
// GRIPPER - Megfogó végeffektor
// =========================================

interface GripperProps {
  width: number
  length: number
  gripperState: GripperState
}

const Gripper = memo(function Gripper({ width, length, gripperState }: GripperProps) {
  const leftFingerRef = useRef<THREE.Group>(null)
  const rightFingerRef = useRef<THREE.Group>(null)
  const animatedOpenRef = useRef(0.5) // 0 = zárt, 1 = nyitott

  const bodyMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#2a2a2a',
    metalness: 0.8,
    roughness: 0.3,
  }), [])

  const fingerMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#444',
    metalness: 0.7,
    roughness: 0.35,
  }), [])

  const tipMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#666',
    metalness: 0.5,
    roughness: 0.6,
  }), [])

  const indicatorMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: gripperState === 'closed' ? '#ef4444' : '#22c55e',
    emissive: gripperState === 'closed' ? '#ef4444' : '#22c55e',
    emissiveIntensity: 0.4,
  }), [gripperState])

  useEffect(() => {
    return () => {
      bodyMaterial.dispose()
      fingerMaterial.dispose()
      tipMaterial.dispose()
      indicatorMaterial.dispose()
    }
  }, [bodyMaterial, fingerMaterial, tipMaterial, indicatorMaterial])

  const targetOpen = gripperState === 'closed' ? 0 : 1
  const maxOpenDistance = width * 0.4

  // Animáció: gripper nyitás/zárás
  useFrame((_, delta) => {
    const distance = Math.abs(targetOpen - animatedOpenRef.current)
    if (distance > 0.001) {
      animatedOpenRef.current = THREE.MathUtils.lerp(
        animatedOpenRef.current,
        targetOpen,
        Math.min(1, 6 * delta)
      )
    } else {
      animatedOpenRef.current = targetOpen
    }

    const offset = animatedOpenRef.current * maxOpenDistance
    if (leftFingerRef.current) {
      leftFingerRef.current.position.x = -offset / 2 - 5
    }
    if (rightFingerRef.current) {
      rightFingerRef.current.position.x = offset / 2 + 5
    }
  })

  return (
    <group>
      {/* Gripper ház */}
      <mesh material={bodyMaterial}>
        <boxGeometry args={[width * 0.8, width * 0.5, 20]} />
      </mesh>

      {/* Állapot jelző */}
      <mesh position={[0, width * 0.3, 0]} material={indicatorMaterial}>
        <sphereGeometry args={[3, 8, 8]} />
      </mesh>

      {/* Bal ujj */}
      <group ref={leftFingerRef} position={[-maxOpenDistance / 4 - 5, 0, 0]}>
        <mesh position={[0, 0, -length / 2 - 10]} material={fingerMaterial}>
          <boxGeometry args={[8, width * 0.35, length]} />
        </mesh>
        {/* Ujj hegy */}
        <mesh position={[0, 0, -length - 10]} material={tipMaterial}>
          <boxGeometry args={[8, width * 0.25, 8]} />
        </mesh>
      </group>

      {/* Jobb ujj */}
      <group ref={rightFingerRef} position={[maxOpenDistance / 4 + 5, 0, 0]}>
        <mesh position={[0, 0, -length / 2 - 10]} material={fingerMaterial}>
          <boxGeometry args={[8, width * 0.35, length]} />
        </mesh>
        {/* Ujj hegy */}
        <mesh position={[0, 0, -length - 10]} material={tipMaterial}>
          <boxGeometry args={[8, width * 0.25, 8]} />
        </mesh>
      </group>
    </group>
  )
})

// =========================================
// KINEMATIC ARM - Teljes robotkar kinematikai lánc
// =========================================

interface KinematicArmProps {
  config: RobotArmConfig
  position: Position
  gripperState: GripperState
  frameColor?: string
  // X/Y/Z tengely színek a config.axes-ból (a felhasználó által beállított).
  // Default: piros / zöld / kék (klasszikus axis colors).
  axisColorX?: string
  axisColorY?: string
  axisColorZ?: string
}

const KinematicArm = memo(function KinematicArm({
  config,
  position,
  gripperState,
  frameColor = '#2d2d2d',
  axisColorX = '#ef4444',
  axisColorY = '#22c55e',
  axisColorZ = '#3b82f6',
}: KinematicArmProps) {
  const j1Ref = useRef<THREE.Group>(null)
  const j2Ref = useRef<THREE.Group>(null)
  const j3Ref = useRef<THREE.Group>(null)

  // Animált szögek
  const animJ1 = useRef(0)
  const animJ2 = useRef(0)
  const animJ3 = useRef(0)
  const isFirst = useRef(true)

  // X = bázis forgás, Y = váll, Z = könyök
  // jointAngleScale: firmware érték -> fok szorzó (kalibrálható a vizualizáció)
  // jointAngleOffset: vizuális offset fokokban (a firmware értékhez adódik)
  const scale = config.jointAngleScale ?? {}
  const offset = config.jointAngleOffset ?? {}
  const targetJ1 = (position.x ?? 0) * (scale.x ?? 1) + (offset.x ?? 0)
  const targetJ2 = (position.y ?? 0) * (scale.y ?? 1) + (offset.y ?? 0)
  const targetJ3 = (position.z ?? 0) * (scale.z ?? 1) + (offset.z ?? 0)

  // Első rendereléskor azonnal a cél pozícióba
  useEffect(() => {
    if (isFirst.current) {
      animJ1.current = targetJ1
      animJ2.current = targetJ2
      animJ3.current = targetJ3
      isFirst.current = false
    }
  }, [targetJ1, targetJ2, targetJ3])

  // Animáció: ízületi szögek interpolálása
  useFrame((_, delta) => {
    const lerpSpeed = 6

    // X tengely - bázis forgás
    if (Math.abs(targetJ1 - animJ1.current) > 0.01) {
      animJ1.current = THREE.MathUtils.lerp(animJ1.current, targetJ1, Math.min(1, lerpSpeed * delta))
    } else {
      animJ1.current = targetJ1
    }

    // Y tengely - váll
    if (Math.abs(targetJ2 - animJ2.current) > 0.01) {
      animJ2.current = THREE.MathUtils.lerp(animJ2.current, targetJ2, Math.min(1, lerpSpeed * delta))
    } else {
      animJ2.current = targetJ2
    }

    // Z tengely - könyök
    if (Math.abs(targetJ3 - animJ3.current) > 0.01) {
      animJ3.current = THREE.MathUtils.lerp(animJ3.current, targetJ3, Math.min(1, lerpSpeed * delta))
    } else {
      animJ3.current = targetJ3
    }

    // Szögek alkalmazása
    if (j1Ref.current) {
      j1Ref.current.rotation.y = THREE.MathUtils.degToRad(animJ1.current)
    }
    if (j2Ref.current) {
      j2Ref.current.rotation.x = THREE.MathUtils.degToRad(animJ2.current)
    }
    if (j3Ref.current) {
      // Z szög abszolút (vízszinteshez képest), ezért kivonjuk a Y szöget
      // hogy kompenzáljuk a Three.js hierarchikus öröklődést
      j3Ref.current.rotation.x = THREE.MathUtils.degToRad(animJ3.current - animJ2.current)
    }
  })

  const { baseDiameter, baseHeight, lowerArmLength, lowerArmWidth, upperArmLength, upperArmWidth } = config

  return (
    <group>
      {/* X tengely - Bázis forgás (függőleges tengely körül) */}
      <group ref={j1Ref}>
        {/* Bázis (forog a karral együtt) */}
        <RobotBase diameter={baseDiameter} height={baseHeight} frameColor={frameColor} />

        {/* Váll pozíció */}
        <group position={[0, 0, baseHeight]}>
          {/* Váll ízület - X tengely színe */}
          <Joint radius={lowerArmWidth * 0.45} color={axisColorX} />

          {/* Y tengely - Váll forgás (vízszintes tengely körül) */}
          <group ref={j2Ref}>
            {/* Alsó kar - Y tengely színe */}
            <ArmLink length={lowerArmLength} width={lowerArmWidth} color={axisColorY} frameColor={frameColor} />

            {/* Könyök ízület - a kar tetején (Y tengely színe) */}
            <group position={[0, 0, lowerArmLength]}>
              <Joint radius={upperArmWidth * 0.45} color={axisColorY} />

              {/* Z tengely - Könyök forgás */}
              <group ref={j3Ref}>
                {/* Felső kar - Z tengely színe */}
                <ArmLink length={upperArmLength} width={upperArmWidth} color={axisColorZ} frameColor={frameColor} />

                {/* Végeffektor - a felső kar tetején (Z tengely színe) */}
                <group position={[0, 0, upperArmLength]}>
                  <Joint radius={upperArmWidth * 0.35} color={axisColorZ} />

                  {/* Gripper */}
                  {config.endEffector.type === 'gripper' && (
                    <Gripper
                      width={config.endEffector.gripperWidth ?? 60}
                      length={config.endEffector.gripperLength ?? 50}
                      gripperState={gripperState}
                    />
                  )}

                  {/* Szívó (ha szívó típusú végeffektor) */}
                  {config.endEffector.type === 'sucker' && (
                    <SuckerEndEffector />
                  )}
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
})

// =========================================
// SUCKER END EFFECTOR - Szívó végeffektor
// =========================================

const SuckerEndEffector = memo(function SuckerEndEffector() {
  const bodyMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#2a2a2a',
    metalness: 0.7,
    roughness: 0.4,
  }), [])

  const cupMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#555',
    metalness: 0.3,
    roughness: 0.7,
  }), [])

  useEffect(() => {
    return () => {
      bodyMaterial.dispose()
      cupMaterial.dispose()
    }
  }, [bodyMaterial, cupMaterial])

  return (
    <group>
      {/* Szívó test */}
      <mesh position={[0, 0, -15]} material={bodyMaterial}>
        <cylinderGeometry args={[10, 12, 30, 16]} />
      </mesh>
      {/* Szívó korong */}
      <mesh position={[0, 0, -35]} material={cupMaterial}>
        <cylinderGeometry args={[18, 15, 8, 16]} />
      </mesh>
    </group>
  )
})

// =========================================
// REACH ENVELOPE - Elérési tartomány
// =========================================

interface ReachEnvelopeProps {
  config: RobotArmConfig
}

const ReachEnvelope = memo(function ReachEnvelope({ config }: ReachEnvelopeProps) {
  const totalReach = config.lowerArmLength + config.upperArmLength
  
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = []
    const segments = 64
    // Felső félkör (az elérési tartomány oldalnézete)
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2
      const x = Math.cos(angle) * totalReach
      const z = Math.sin(angle) * totalReach + config.baseHeight
      pts.push(new THREE.Vector3(x, 0, Math.max(0, z)))
    }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [totalReach, config.baseHeight])

  useEffect(() => {
    return () => { points.dispose() }
  }, [points])

  const lineMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: '#3b82f6',
    opacity: 0.15,
    transparent: true,
  }), [])

  useEffect(() => {
    return () => { lineMaterial.dispose() }
  }, [lineMaterial])

  return (
    <lineLoop geometry={points} material={lineMaterial} />
  )
})

// =========================================
// SCENE - Teljes 3D jelenet
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

function Scene({ config, position, status, cameraPosition, cameraTarget, cameraFov, onCameraChange }: SceneProps) {
  const currentPosition = position ?? { x: 0, y: 0, z: 0 }
  const gripperState: GripperState = status?.gripper_state ?? 'unknown'
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const prevCameraPositionRef = useRef<string>('')
  const prevCameraTargetRef = useRef<string>('')
  const prevCameraFovRef = useRef<number>(40)

  const target = cameraTarget ?? { x: 0, y: 0, z: 150 }

  // Kamera pozíció frissítés
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
      const newTargetKey = `${cameraTarget.x},${cameraTarget.y},${cameraTarget.z}`
      if (newTargetKey !== prevCameraTargetRef.current) {
        controlsRef.current.target.set(cameraTarget.x, cameraTarget.y, cameraTarget.z)
        controlsRef.current.update()
        prevCameraTargetRef.current = newTargetKey
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

  // Kamera változás throttle
  const lastCameraUpdateRef = useRef(0)
  const handleCameraChange = useCallback(() => {
    const now = Date.now()
    if (now - lastCameraUpdateRef.current < 100) return
    lastCameraUpdateRef.current = now

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

  // Robot arm konfigurációs adatok
  const robotArmConfig = config.robotArm ?? {
    baseDiameter: 120,
    baseHeight: 60,
    lowerArmLength: 200,
    lowerArmWidth: 50,
    upperArmLength: 200,
    upperArmWidth: 40,
    endEffector: { type: 'gripper' as const, gripperWidth: 60, gripperLength: 50, gripperFingerCount: 2 },
  }

  // X/Y/Z tengelyek beállított színei a configból
  const axisColorX = config.axes.find((a) => a.name === 'X')?.color ?? '#ef4444'
  const axisColorY = config.axes.find((a) => a.name === 'Y')?.color ?? '#22c55e'
  const axisColorZ = config.axes.find((a) => a.name === 'Z')?.color ?? '#3b82f6'

  return (
    <>
      {/* Megvilágítás */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[300, 300, 400]} intensity={1.2} castShadow />
      <directionalLight position={[-200, -200, 200]} intensity={0.4} />
      <pointLight position={[0, 0, 300]} intensity={0.3} />

      {/* Kamera vezérlés */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        minDistance={100}
        maxDistance={2000}
        target={[target.x, target.y, target.z]}
        onChange={handleCameraChange}
      />

      {/* Padlórács */}
      {config.visuals?.showGrid !== false && (
        <Grid
          args={[1000, 1000]}
          position={[0, -42, 0]}
          cellSize={20}
          cellThickness={0.3}
          cellColor="#252525"
          sectionSize={100}
          sectionThickness={0.8}
          sectionColor="#ffffff"
          fadeDistance={1200}
        />
      )}

      {/* Koordináta rendszer az origónál */}
      {config.visuals?.showAxesHelper !== false && (
        <CoordinateSystem size={80} />
      )}

      {/* Elérési tartomány */}
      <ReachEnvelope config={robotArmConfig} />

      {/* Robotkar */}
      <KinematicArm
        config={robotArmConfig}
        position={currentPosition}
        gripperState={gripperState}
        frameColor={config.visuals?.frameColor}
        axisColorX={axisColorX}
        axisColorY={axisColorY}
        axisColorZ={axisColorZ}
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

function RobotArmVisualizationInner({
  config,
  position,
  status,
  className = '',
  onCameraChange,
}: Props) {
  const bgColor = config.visuals?.backgroundColor ?? '#0a0a0f'

  const defaultCamPos = useMemo(() => ({
    x: 400,
    y: -400,
    z: 350,
  }), [])

  const cameraPos = config.visuals?.cameraPosition ?? defaultCamPos
  const cameraTarget = config.visuals?.cameraTarget ?? { x: 0, y: 0, z: 150 }
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

const RobotArmVisualization = memo(RobotArmVisualizationInner)
export default RobotArmVisualization
