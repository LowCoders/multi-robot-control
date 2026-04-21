/**
 * V2 csőhajlító Canvas wrapper.
 *
 * A Canvas, világítás, OrbitControls, grid és koordináta-rendszer beállítása,
 * majd a `TubeBenderModelV2` rendererre delegál. A meglévő prop-szerződés
 * (config, position, status, onCameraChange) ugyanaz, mint a régié.
 *
 * Háttér-kattintás esetén töröljük a highlight kijelölést.
 */
import { Suspense, memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MachineConfig } from '../../../types/machine-config'
import type { DeviceStatus, Position } from '../../../types/device'
import CoordinateSystem from '../CoordinateSystem'
import type { CameraState } from '../MachineVisualization'
import TubeBenderModelV2 from './TubeBenderModelV2'
import { useHighlightStore } from './highlightStore'

interface SceneProps {
  config: MachineConfig
  cameraPosition?: { x: number; y: number; z: number }
  cameraTarget?: { x: number; y: number; z: number }
  cameraFov?: number
  onCameraChange?: (state: CameraState) => void
}

function Scene({
  config,
  cameraPosition,
  cameraTarget,
  cameraFov,
  onCameraChange,
}: SceneProps) {
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const prevPosKey = useRef<string>('')
  const prevTargetKey = useRef<string>('')
  const prevFov = useRef<number>(40)

  const target = cameraTarget ?? { x: 0, y: 100, z: 0 }

  useEffect(() => {
    if (!cameraPosition) return
    const k = `${cameraPosition.x},${cameraPosition.y},${cameraPosition.z}`
    if (k === prevPosKey.current) return
    camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z)
    prevPosKey.current = k
  }, [camera, cameraPosition])

  useEffect(() => {
    if (!cameraTarget || !controlsRef.current) return
    const k = `${cameraTarget.x},${cameraTarget.y},${cameraTarget.z}`
    if (k === prevTargetKey.current) return
    controlsRef.current.target.set(cameraTarget.x, cameraTarget.y, cameraTarget.z)
    controlsRef.current.update()
    prevTargetKey.current = k
  }, [cameraTarget])

  useEffect(() => {
    if (cameraFov && cameraFov !== prevFov.current) {
      (camera as THREE.PerspectiveCamera).fov = cameraFov
      ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
      prevFov.current = cameraFov
    }
  }, [camera, cameraFov])

  const lastUpdate = useRef(0)
  const handleCameraChange = useCallback(() => {
    const now = Date.now()
    if (now - lastUpdate.current < 100) return
    lastUpdate.current = now
    if (!onCameraChange || !controlsRef.current) return
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
  }, [camera, onCameraChange])

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[300, 400, 400]} intensity={1.1} castShadow />
      <directionalLight position={[-200, 300, -200]} intensity={0.4} />
      <pointLight position={[0, 250, 0]} intensity={0.3} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        minDistance={50}
        maxDistance={2500}
        target={[target.x, target.y, target.z]}
        onChange={handleCameraChange}
      />

      {config.visuals?.showGrid !== false && (
        <Grid
          args={[1500, 1500]}
          position={[0, -50.5, 0]}
          cellSize={20}
          cellThickness={0.3}
          cellColor="#252525"
          sectionSize={100}
          sectionThickness={0.8}
          sectionColor="#ffffff"
          fadeDistance={1500}
        />
      )}

      {config.visuals?.showAxesHelper !== false && (
        <CoordinateSystem size={80} />
      )}

      <TubeBenderModelV2 />
    </>
  )
}

interface Props {
  config: MachineConfig
  position?: Position
  status?: DeviceStatus
  className?: string
  onCameraChange?: (state: CameraState) => void
}

function TubeBenderVisualizationV2Inner({
  config,
  className = '',
  onCameraChange,
}: Props) {
  const bgColor = config.visuals?.backgroundColor ?? '#0a0a0f'

  const defaultCamPos = useMemo(() => ({ x: 500, y: 350, z: 600 }), [])
  const cameraPos = config.visuals?.cameraPosition ?? defaultCamPos
  const cameraTarget = config.visuals?.cameraTarget ?? { x: 0, y: 0, z: 0 }
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
        onPointerMissed={() => useHighlightStore.getState().setSelectedId(null)}
      >
        <Suspense fallback={null}>
          <Scene
            config={config}
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

const TubeBenderVisualizationV2 = memo(TubeBenderVisualizationV2Inner)
export default TubeBenderVisualizationV2
