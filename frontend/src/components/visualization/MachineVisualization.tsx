import { Suspense, useMemo, memo, useRef, useCallback, useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import type { MachineConfig } from '../../types/machine-config'
import type { Position, DeviceStatus } from '../../types/device'
import AxisRenderer from './AxisRenderer'
import ToolHead from './ToolHead'
import Workpiece from './Workpiece'
import CoordinateSystem from './CoordinateSystem'

// Camera position/target for external capture
export interface CameraState {
  position: { x: number; y: number; z: number }
  target: { x: number; y: number; z: number }
}

interface Props {
  config: MachineConfig
  position?: Position
  status?: DeviceStatus
  className?: string
  onCameraChange?: (state: CameraState) => void
}

// Machine frame - the structural base of the CNC
const MachineFrame = memo(function MachineFrame({ config }: { config: MachineConfig }) {
  const { x: envX, y: envY, z: envZ } = config.workEnvelope
  const baseDims = config.base ?? { width: envX + 100, height: 40, depth: envY + 100 }
  
  // Get colors from config or use defaults
  const frameColor = config.visuals?.frameColor ?? '#2d2d2d'
  const baseColor = useMemo(() => {
    const color = new THREE.Color(frameColor)
    color.multiplyScalar(0.6)
    return color
  }, [frameColor])
  
  const columnHeight = envZ + 150
  const gantryHeight = envZ + 100

  // Materials - memoized
  const baseMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.9,
      roughness: 0.3,
    })
  }, [baseColor])

  const frameMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: frameColor,
      metalness: 0.7,
      roughness: 0.4,
    })
  }, [frameColor])

  const tableSlotMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#0f0f0f',
      metalness: 0.5,
      roughness: 0.6,
    })
  }, [])

  const edgesMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: '#444' }), [])
  const baseEdgesMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: '#333' }), [])

  // Geometries - memoized to avoid recreation on every render
  const baseGeometry = useMemo(() => 
    new THREE.BoxGeometry(baseDims.width, baseDims.depth, baseDims.height),
    [baseDims.width, baseDims.depth, baseDims.height]
  )
  const baseEdgesGeometry = useMemo(() => 
    new THREE.EdgesGeometry(baseGeometry),
    [baseGeometry]
  )

  const columnGeometry = useMemo(() => 
    new THREE.BoxGeometry(50, 60, columnHeight),
    [columnHeight]
  )
  const columnEdgesGeometry = useMemo(() => 
    new THREE.EdgesGeometry(columnGeometry),
    [columnGeometry]
  )

  const crossBeamGeometry = useMemo(() => 
    new THREE.BoxGeometry(envX + 110, 50, 40),
    [envX]
  )
  const crossBeamEdgesGeometry = useMemo(() => 
    new THREE.EdgesGeometry(crossBeamGeometry),
    [crossBeamGeometry]
  )

  const slotGeometry = useMemo(() => 
    new THREE.BoxGeometry(baseDims.width - 20, 8, 3),
    [baseDims.width]
  )

  const supportBeamGeometry = useMemo(() => 
    new THREE.BoxGeometry(baseDims.width, 30, baseDims.height + 10),
    [baseDims.width, baseDims.height]
  )

  const footGeometry = useMemo(() => 
    new THREE.CylinderGeometry(15, 20, 30, 8),
    []
  )

  // Cleanup: dispose geometries and materials on unmount
  useEffect(() => {
    return () => {
      // Dispose geometries
      baseGeometry.dispose()
      baseEdgesGeometry.dispose()
      columnGeometry.dispose()
      columnEdgesGeometry.dispose()
      crossBeamGeometry.dispose()
      crossBeamEdgesGeometry.dispose()
      slotGeometry.dispose()
      supportBeamGeometry.dispose()
      footGeometry.dispose()
      // Dispose materials
      baseMaterial.dispose()
      frameMaterial.dispose()
      tableSlotMaterial.dispose()
      edgesMaterial.dispose()
      baseEdgesMaterial.dispose()
    }
  }, [
    baseGeometry, baseEdgesGeometry, columnGeometry, columnEdgesGeometry,
    crossBeamGeometry, crossBeamEdgesGeometry, slotGeometry, supportBeamGeometry, footGeometry,
    baseMaterial, frameMaterial, tableSlotMaterial, edgesMaterial, baseEdgesMaterial
  ])

  return (
    <group>
      {/* Machine base / table */}
      <group position={[envX / 2, envY / 2, -baseDims.height / 2]}>
        <mesh material={baseMaterial} geometry={baseGeometry} />
        <lineSegments geometry={baseEdgesGeometry} material={baseEdgesMaterial} />
      </group>

      {/* T-slot grooves on table surface */}
      {[-0.3, -0.1, 0.1, 0.3].map((offset, i) => (
        <mesh 
          key={i}
          material={tableSlotMaterial}
          geometry={slotGeometry}
          position={[envX / 2, envY / 2 + offset * envY, 1]}
        />
      ))}

      {/* Left gantry column */}
      <group position={[-30, envY / 2, columnHeight / 2 - 20]}>
        <mesh material={frameMaterial} geometry={columnGeometry} />
        <lineSegments geometry={columnEdgesGeometry} material={edgesMaterial} />
      </group>

      {/* Right gantry column */}
      <group position={[envX + 30, envY / 2, columnHeight / 2 - 20]}>
        <mesh material={frameMaterial} geometry={columnGeometry} />
        <lineSegments geometry={columnEdgesGeometry} material={edgesMaterial} />
      </group>

      {/* Gantry cross beam (top) */}
      <group position={[envX / 2, envY / 2, gantryHeight]}>
        <mesh material={frameMaterial} geometry={crossBeamGeometry} />
        <lineSegments geometry={crossBeamEdgesGeometry} material={edgesMaterial} />
      </group>

      {/* Front support beam */}
      <group position={[envX / 2, -25, -baseDims.height / 2]}>
        <mesh material={frameMaterial} geometry={supportBeamGeometry} />
      </group>

      {/* Back support beam */}
      <group position={[envX / 2, envY + 25, -baseDims.height / 2]}>
        <mesh material={frameMaterial} geometry={supportBeamGeometry} />
      </group>

      {/* Corner feet */}
      {[
        [-40, -30],
        [envX + 40, -30],
        [-40, envY + 30],
        [envX + 40, envY + 30],
      ].map(([x, y], i) => (
        <mesh key={i} material={baseMaterial} geometry={footGeometry} position={[x, y, -baseDims.height - 15]} />
      ))}
    </group>
  )
})

// Work envelope visualization
function WorkEnvelopeOutline({ config }: { config: MachineConfig }) {
  const { x, y, z } = config.workEnvelope
  
  const points = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints([
      // Bottom rectangle
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(x, 0, 0),
      new THREE.Vector3(x, 0, 0),
      new THREE.Vector3(x, y, 0),
      new THREE.Vector3(x, y, 0),
      new THREE.Vector3(0, y, 0),
      new THREE.Vector3(0, y, 0),
      new THREE.Vector3(0, 0, 0),
      // Top rectangle
      new THREE.Vector3(0, 0, z),
      new THREE.Vector3(x, 0, z),
      new THREE.Vector3(x, 0, z),
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(0, y, z),
      new THREE.Vector3(0, y, z),
      new THREE.Vector3(0, 0, z),
      // Vertical edges
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, z),
      new THREE.Vector3(x, 0, 0),
      new THREE.Vector3(x, 0, z),
      new THREE.Vector3(x, y, 0),
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(0, y, 0),
      new THREE.Vector3(0, y, z),
    ])
  }, [x, y, z])

  return (
    <lineSegments geometry={points}>
      <lineBasicMaterial color="#3b82f6" opacity={0.2} transparent />
    </lineSegments>
  )
}

interface SceneProps extends Omit<Props, 'className'> {
  cameraPosition?: { x: number; y: number; z: number }
  cameraTarget?: { x: number; y: number; z: number }
  cameraFov?: number
  onCameraChange?: (state: CameraState) => void
}

// Main 3D scene
function Scene({ config, position, status, cameraPosition, cameraTarget, cameraFov, onCameraChange }: SceneProps) {
  const currentPosition = position ?? { x: 0, y: 0, z: 0 }
  const isSpinning = status?.state === 'running'
  const spindleSpeed = status?.spindle_speed ?? 0
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const prevCameraPositionRef = useRef<string>('')
  const prevCameraTargetRef = useRef<string>('')
  const prevCameraFovRef = useRef<number>(40)

  // Position offset for the moving parts - start above the table
  const movingPartsOffset: [number, number, number] = [0, 0, config.workEnvelope.z + 50]
  
  // Camera target - use provided or default to center of work envelope
  const target = cameraTarget ?? {
    x: config.workEnvelope.x / 2,
    y: config.workEnvelope.y / 2,
    z: 0,
  }

  // Update camera position when props change (from config editor)
  useEffect(() => {
    if (cameraPosition) {
      const newPosKey = `${cameraPosition.x},${cameraPosition.y},${cameraPosition.z}`
      if (newPosKey !== prevCameraPositionRef.current) {
        camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z)
        prevCameraPositionRef.current = newPosKey
      }
    }
  }, [camera, cameraPosition])

  // Update camera target when props change
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

  // Update camera FOV when props change
  useEffect(() => {
    if (cameraFov && cameraFov !== prevCameraFovRef.current) {
      (camera as THREE.PerspectiveCamera).fov = cameraFov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix()
      prevCameraFovRef.current = cameraFov
    }
  }, [camera, cameraFov])

  // Handle camera change from OrbitControls - throttled to avoid excessive updates
  const lastCameraUpdateRef = useRef(0)
  const handleCameraChange = useCallback(() => {
    const now = Date.now()
    // Throttle to max 10 updates per second (100ms)
    if (now - lastCameraUpdateRef.current < 100) return
    lastCameraUpdateRef.current = now

    if (onCameraChange && controlsRef.current) {
      const controls = controlsRef.current
      onCameraChange({
        position: {
          x: Math.round(camera.position.x),
          y: Math.round(camera.position.y),
          z: Math.round(camera.position.z),
        },
        target: {
          x: Math.round(controls.target.x),
          y: Math.round(controls.target.y),
          z: Math.round(controls.target.z),
        },
      })
    }
  }, [camera, onCameraChange])

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight 
        position={[300, 300, 400]} 
        intensity={1.2} 
        castShadow 
      />
      <directionalLight 
        position={[-200, -200, 200]} 
        intensity={0.4} 
      />
      <pointLight position={[config.workEnvelope.x / 2, config.workEnvelope.y / 2, 200]} intensity={0.3} />

      {/* Camera controls */}
      <OrbitControls 
        ref={controlsRef}
        makeDefault 
        minDistance={50}
        maxDistance={2000}
        target={[target.x, target.y, target.z]}
        onChange={handleCameraChange}
      />

      {/* Grid on table surface */}
      {config.visuals?.showGrid !== false && (
        <Grid 
          args={[800, 800]} 
          position={[config.workEnvelope.x / 2, config.workEnvelope.y / 2, 0.5]}
          cellSize={10}
          cellThickness={0.3}
          cellColor="#252525"
          sectionSize={50}
          sectionThickness={0.8}
          sectionColor="#353535"
          fadeDistance={1000}
        />
      )}

      {/* Coordinate system at origin */}
      {config.visuals?.showAxesHelper !== false && (
        <CoordinateSystem size={50} />
      )}

      {/* Machine frame and structure */}
      <MachineFrame config={config} />

      {/* Work envelope outline */}
      <WorkEnvelopeOutline config={config} />

      {/* Sample workpiece on table */}
      <Workpiece 
        width={80} 
        height={25} 
        depth={60} 
        position={[config.workEnvelope.x / 2 - 40, config.workEnvelope.y / 2 - 30, 0]}
      />

      {/* Moving parts - kinematic chain with tool head */}
      <group position={movingPartsOffset}>
        <AxisRenderer axes={config.axes} position={currentPosition}>
          <ToolHead
            spindleDiameter={config.spindle?.diameter ?? 52}
            spindleLength={config.spindle?.length ?? 80}
            toolDiameter={config.tool?.diameter ?? 6}
            toolLength={config.tool?.length ?? 30}
            isSpinning={isSpinning}
            rpm={spindleSpeed}
          />
        </AxisRenderer>
      </group>
    </>
  )
}

function MachineVisualizationInner({ 
  config, 
  position, 
  status,
  className = '',
  onCameraChange,
}: Props) {
  const bgColor = config.visuals?.backgroundColor ?? '#0a0a0f'
  
  // Get camera settings from config or use sensible defaults based on work envelope
  const defaultCamPos = useMemo(() => {
    const env = config.workEnvelope
    // Position camera at a good viewing angle based on work envelope size
    const distance = Math.max(env.x, env.y, env.z) * 2
    return {
      x: env.x / 2 + distance * 0.7,
      y: env.y / 2 - distance * 0.5,
      z: env.z / 2 + distance * 0.5,
    }
  }, [config.workEnvelope])
  
  const cameraPos = config.visuals?.cameraPosition ?? defaultCamPos
  const cameraTarget = config.visuals?.cameraTarget ?? {
    x: config.workEnvelope.x / 2,
    y: config.workEnvelope.y / 2,
    z: 0,
  }
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

// Memoize to prevent re-renders from unrelated state changes
// Uses simple shallow comparison - config objects should be new references when changed
const MachineVisualization = memo(MachineVisualizationInner)

export default MachineVisualization
