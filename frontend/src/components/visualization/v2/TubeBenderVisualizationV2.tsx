/**
 * V2 csőhajlító Canvas wrapper.
 *
 * A Canvas, világítás, OrbitControls, grid és koordináta-rendszer beállítása,
 * majd a `TubeBenderModelV2` rendererre delegál. A meglévő prop-szerződés
 * (config, position, status, onCameraChange) ugyanaz, mint a régié.
 *
 * **Koordinátarendszer**: CAD Z-up konvenció (lásd `types.ts` JSDoc):
 *   - +X = csőelőtolás iránya
 *   - +Y = operátor felé (mélység)
 *   - +Z = függőlegesen FEL (magasság)
 *
 * A Three.js alapból Y-up; itt globálisan átállítjuk Z-up-ra a
 * `THREE.Object3D.DEFAULT_UP = (0, 0, 1)` beállítással. Ez kihat:
 *   - a kamera "up" vektorára (OrbitControls természetesen Z körül forgat),
 *   - a default world-orientációra.
 *
 * A `Grid` componentet (drei) explicit XY síkba forgatjuk (`rotation = [π/2, 0, 0]`),
 * mert a `<Grid>` alapból az XZ síkban (Y=const) rajzol. A `CoordinateSystem`
 * gizmo a tengelyek színét megőrzi (X = piros, Y = zöld, Z = kék), de a Z most
 * a "fel" tengely.
 *
 * Háttér-kattintás esetén töröljük a highlight kijelölést.
 */
import { Suspense, memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import {
  GizmoHelper,
  GizmoViewcube,
  Grid,
  OrbitControls,
} from '@react-three/drei'
import * as THREE from 'three'
import type { MachineConfig } from '../../../types/machine-config'
import type { DeviceStatus, Position } from '../../../types/device'
import CoordinateSystem from '../CoordinateSystem'
import type { CameraState } from '../MachineVisualization'
import TubeBenderModelV2, { isClickSuppressionActive } from './TubeBenderModelV2'
import { useHighlightStore } from './highlightStore'
import CameraPanPad from './CameraPanPad'

// Globális Z-up konvenció. Új Object3D-k (kamera, gizmo) ezt veszik át.
// Egyszer kell beállítani, modul-szinten — nem komponens-effektben.
THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1)

interface SceneProps {
  config: MachineConfig
  cameraPosition?: { x: number; y: number; z: number }
  cameraTarget?: { x: number; y: number; z: number }
  cameraFov?: number
  onCameraChange?: (state: CameraState) => void
  /** Megjelenjen-e a ViewCube overlay (drei `GizmoHelper` + `GizmoViewcube`). */
  showViewCube?: boolean
}

function Scene({
  config,
  cameraPosition,
  cameraTarget,
  cameraFov,
  onCameraChange,
  showViewCube = true,
}: SceneProps) {
  const controlsRef = useRef<any>(null)
  const { camera } = useThree()
  const prevPosKey = useRef<string>('')
  const prevTargetKey = useRef<string>('')
  const prevFov = useRef<number>(40)
  const panCommand = useHighlightStore((s) => s.panCommand)
  const resetCommand = useHighlightStore((s) => s.resetCommand)
  const setCameraPose = useHighlightStore((s) => s.setCameraPose)

  // Z-up: alap target a base teteje fölé (Y irányban a base közepe = 0,
  // a model magassága +Z mentén megy fel).
  const target = cameraTarget ?? { x: 0, y: 0, z: 100 }

  // A kamera up-vektorát explicit Z-up-ra állítjuk (a globális DEFAULT_UP miatt
  // az új Canvas-kameráknál ez már automatikus, de a meglévő instance-ot biztosra
  // megy javítjuk).
  useEffect(() => {
    camera.up.set(0, 0, 1)
    camera.lookAt(target.x, target.y, target.z)
  }, [camera, target.x, target.y, target.z])

  // Init: első mount-kor olvassuk a perzisztált `cameraPose`-t. Ha létezik,
  // azzal írjuk felül a config-eredetű alap-pozíciót (a felhasználó utolsó
  // nézete jön vissza). NEM iratkozunk fel a store-ra — csak az inicializáció,
  // mert utána az OrbitControls maga vezeti a kamerát.
  //
  // **Kezdeti pose írás:** ha a store-ban még nincs `cameraPose` (pl. friss
  // session, vagy a felhasználó nem mozgatta a kamerát), akkor is felírjuk az
  // EFFEKTÍV induló kamerát a store-ba. Erre azért van szükség, hogy a
  // `VisualizationPanel` "Mentés alapértelmezett nézetként" gombja akkor is
  // tudjon menteni, ha a felhasználó még semmihez sem nyúlt — különben a
  // `cameraPose === null` miatt no-op lenne.
  const didInitFromPose = useRef(false)
  useEffect(() => {
    if (didInitFromPose.current) return
    if (!controlsRef.current) return
    const persistedPose = useHighlightStore.getState().cameraPose
    if (persistedPose) {
      camera.position.set(...persistedPose.pos)
      camera.up.set(0, 0, 1)
      controlsRef.current.target.set(...persistedPose.target)
      camera.lookAt(...persistedPose.target)
      controlsRef.current.update()
      // A config-eredetű effect-eknek ne legyen kedve felülírni a perzisztáltat.
      prevPosKey.current = `${persistedPose.pos[0]},${persistedPose.pos[1]},${persistedPose.pos[2]}`
      prevTargetKey.current = `${persistedPose.target[0]},${persistedPose.target[1]},${persistedPose.target[2]}`
    } else {
      // Nincs perzisztált pose → írjuk fel a config-eredetű alap-pose-t. Az
      // `onChange` az `update()` hívás után úgyis lefutna, de explicit írással
      // garantáljuk, hogy a store soha nem marad `null`-on egy aktív Scene
      // mellett.
      setCameraPose({
        pos: [camera.position.x, camera.position.y, camera.position.z],
        target: [
          controlsRef.current.target.x,
          controlsRef.current.target.y,
          controlsRef.current.target.z,
        ],
      })
    }
    didInitFromPose.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Pan-parancs (CameraPanPad overlay → store → Scene). A pan = a kamera ÉS
  // a target együttes eltolása a képernyő-relatív "right" / "up" vektor mentén,
  // így a nézés iránya változatlan marad — a kép csak elcsúszik.
  useEffect(() => {
    if (!panCommand || !controlsRef.current) return
    const cam = camera as THREE.PerspectiveCamera
    const forward = new THREE.Vector3()
    cam.getWorldDirection(forward)
    // A világ-up cam.up-pal lehet enyhén dőlt; a képernyő-up a forward-ra
    // merőleges projekció, így a pan TÉNYLEGESEN képernyő-relatív marad.
    const right = new THREE.Vector3().crossVectors(forward, cam.up).normalize()
    const screenUp = new THREE.Vector3().crossVectors(right, forward).normalize()

    const delta = new THREE.Vector3()
    if (panCommand.dir === 'right') delta.copy(right).multiplyScalar(panCommand.amount)
    else if (panCommand.dir === 'left') delta.copy(right).multiplyScalar(-panCommand.amount)
    else if (panCommand.dir === 'up') delta.copy(screenUp).multiplyScalar(panCommand.amount)
    else if (panCommand.dir === 'down') delta.copy(screenUp).multiplyScalar(-panCommand.amount)

    cam.position.add(delta)
    controlsRef.current.target.add(delta)
    controlsRef.current.update()
    // A `setCameraPose` az OrbitControls onChange-en keresztül automatikusan
    // megíródik (a controlsRef.update() változás-eseményt vált ki).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panCommand?.tick])

  // Reset-parancs (CameraPanPad reset gomb → store → Scene). A config-eredetű
  // alap-pozícióra ugrik vissza, és a `cameraPose`-t a store maga törli.
  useEffect(() => {
    if (!resetCommand || !controlsRef.current) return
    const fallbackTarget = cameraTarget ?? { x: 0, y: 0, z: 100 }
    const fallbackPos = cameraPosition ?? { x: 500, y: 600, z: 350 }
    camera.position.set(fallbackPos.x, fallbackPos.y, fallbackPos.z)
    camera.up.set(0, 0, 1)
    controlsRef.current.target.set(
      fallbackTarget.x,
      fallbackTarget.y,
      fallbackTarget.z,
    )
    camera.lookAt(fallbackTarget.x, fallbackTarget.y, fallbackTarget.z)
    controlsRef.current.update()
    prevPosKey.current = `${fallbackPos.x},${fallbackPos.y},${fallbackPos.z}`
    prevTargetKey.current = `${fallbackTarget.x},${fallbackTarget.y},${fallbackTarget.z}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetCommand?.tick])

  const lastUpdate = useRef(0)
  const handleCameraChange = useCallback(() => {
    const now = Date.now()
    if (now - lastUpdate.current < 100) return
    lastUpdate.current = now
    if (!controlsRef.current) return
    // A nyers (nem kerekített) pozíciót mentjük perzisztens store-ba, hogy a
    // következő mountkor ugyanaz a sub-mm pontosságú nézet jöjjön vissza.
    setCameraPose({
      pos: [camera.position.x, camera.position.y, camera.position.z],
      target: [
        controlsRef.current.target.x,
        controlsRef.current.target.y,
        controlsRef.current.target.z,
      ],
    })
    if (onCameraChange) {
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
  }, [camera, onCameraChange, setCameraPose])

  return (
    <>
      {/* Z-up világítás: a "fő" fény felülről (+Z), a kiegészítő oldalról és lentről. */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[300, 400, 400]} intensity={1.1} castShadow />
      <directionalLight position={[-200, -200, 300]} intensity={0.4} />
      <pointLight position={[0, 0, 250]} intensity={0.3} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        minDistance={50}
        maxDistance={2500}
        target={[target.x, target.y, target.z]}
        onChange={handleCameraChange}
      />

      {config.visuals?.showGrid !== false && (
        // A drei <Grid> alapból az XZ síkban (Y=const) rajzol; Z-up esetén forgatással
        // tesszük az XY síkba (Z=const). A pozíció: a base fizikai alja alá ~50 mm-rel.
        <Grid
          args={[1500, 1500]}
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, 0, -50.5]}
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

      {/*
        AutoCAD-szerű ViewCube overlay a jobb-felső sarokban. Forog a kamerával,
        a 6 lap, 12 él és 8 sarok kattintásra animáltan átsnap-eli a kamerát az
        adott nézetbe. Ez váltotta le a régi 3x3 preset-grid `CameraControls`-t.
      */}
      {showViewCube && (
        <GizmoHelper alignment="top-right" margin={[80, 80]}>
          {/*
            A drei `GizmoViewcube` a 6 face-feliratot fix sorrendben rakja a
            `BoxGeometry` material slot-jaira: `[+X, -X, +Y, -Y, +Z, -Z]`,
            default labelek (Y-up): `['Right','Left','Top','Bottom','Front','Back']`.

            A mi scenénk Z-up CAD-konvenció:
              +X = csőtolás iránya (jobbra)
              +Y = operátor felé (mélység)
              +Z = felfelé

            A klasszikus CAD "Front view" az, amikor a néző a -Y irányból
            néz a +Y felé: ekkor a +X jobbra, a +Z felfelé esik. Ezért:
              +X face → Right     -X face → Left
              +Y face → Back      -Y face → Front
              +Z face → Top       -Z face → Bottom

            (Korábban tévesen +Y volt Front-ként címkézve — innen a tükrözött
            felirat. A `tweenCamera` a face.normal-t használja, így a
            kameramozgás konzisztens marad a felirattal.)
          */}
          <GizmoViewcube
            faces={['Right', 'Left', 'Back', 'Front', 'Top', 'Bottom']}
            color="#1e293b"
            strokeColor="#334155"
            textColor="#e2e8f0"
            hoverColor="#3b82f6"
          />
        </GizmoHelper>
      )}
    </>
  )
}

interface Props {
  config: MachineConfig
  position?: Position
  status?: DeviceStatus
  className?: string
  onCameraChange?: (state: CameraState) => void
  /**
   * A kamera-overlay-ek (drei `GizmoViewcube` jobb-felül + `CameraPanPad`
   * jobb-alul) megjelenítése. A felhasználói preferencia a `VisualizationPanel`
   * kapcsolójából jön és localStorage-ba mentődik. Default: true.
   */
  showCameraControls?: boolean
}

function TubeBenderVisualizationV2Inner({
  config,
  className = '',
  onCameraChange,
  showCameraControls = true,
}: Props) {
  const bgColor = config.visuals?.backgroundColor ?? '#0a0a0f'

  // Z-up alap kamera-poz (lásd a fájl tetején a koord-konvenciót):
  //   X = +500 (oldalról nézve, az operátor jobbja felől)
  //   Y = +600 (az operátor felőli oldalról hátrafelé tekintve a gépre)
  //   Z = +350 (kissé felülről)
  // Ha a felhasználó saját `cameraPosition`-t ad a configban, az felülírja ezt.
  // Y-up legacy konfig esetén (config.visuals.coordSystem === 'y-up') a kamera
  // koordinátáit átfordítjuk Z-up-ra: (x, y_up, z_up) → (x, -z_up, y_up),
  // ami a "+Y_up = fel" → "+Z_zup = fel" tengely-cserének felel meg.
  const defaultCamPos = useMemo(() => ({ x: 500, y: 600, z: 350 }), [])
  const rawCamPos = config.visuals?.cameraPosition ?? defaultCamPos
  const rawCamTarget = config.visuals?.cameraTarget ?? { x: 0, y: 0, z: 0 }
  const isLegacyYup = config.visuals?.coordSystem === 'y-up'
  const cameraPos = useMemo(
    () => (isLegacyYup ? { x: rawCamPos.x, y: -rawCamPos.z, z: rawCamPos.y } : rawCamPos),
    [isLegacyYup, rawCamPos],
  )
  const cameraTarget = useMemo(
    () =>
      isLegacyYup
        ? { x: rawCamTarget.x, y: -rawCamTarget.z, z: rawCamTarget.y }
        : rawCamTarget,
    [isLegacyYup, rawCamTarget],
  )
  const cameraFov = config.visuals?.cameraFov ?? 40

  // A pan-pad alapértelmezett lépése: a config-ban definiált alap-pozíció
  // hosszának ~10%-a (a kamera-eredőtől). Ha nincs config, default ~700 mm.
  const panDistance = useMemo(() => {
    const d = Math.hypot(cameraPos.x, cameraPos.y, cameraPos.z)
    return d > 50 ? d : 700
  }, [cameraPos])
  const panStep = panDistance / 10

  return (
    <div className={`w-full h-full rounded-lg overflow-hidden relative ${className}`}>
      <Canvas
        camera={{
          position: [cameraPos.x, cameraPos.y, cameraPos.z],
          fov: cameraFov,
          near: 1,
          far: 5000,
        }}
        style={{ background: bgColor }}
        gl={{ antialias: true }}
        onPointerMissed={() => {
          // Drag-end utáni "fantommiss" elnyelése — ugyanaz a probléma, mint
          // a `ComponentNode.handleClick`-ben: a TransformControls drag-end
          // pointerup-ja után az R3F egy `pointerMissed`-et is kibocsát ha a
          // felengedés üres területen történt, ami különben kitörölné a
          // kijelölést.
          if (isClickSuppressionActive()) return
          useHighlightStore.getState().setSelectedId(null)
        }}
      >
        <Suspense fallback={null}>
          <Scene
            config={config}
            cameraPosition={cameraPos}
            cameraTarget={cameraTarget}
            cameraFov={cameraFov}
            onCameraChange={onCameraChange}
            showViewCube={showCameraControls}
          />
        </Suspense>
      </Canvas>
      {showCameraControls && <CameraPanPad step={panStep} />}
    </div>
  )
}

const TubeBenderVisualizationV2 = memo(TubeBenderVisualizationV2Inner)
export default TubeBenderVisualizationV2
