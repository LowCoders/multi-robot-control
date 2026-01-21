import { useRef, useMemo, memo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface Props {
  spindleDiameter?: number
  spindleLength?: number
  toolDiameter?: number
  toolLength?: number
  isSpinning?: boolean
  rpm?: number
}

const ToolHead = memo(function ToolHead({
  spindleDiameter = 52,
  spindleLength = 80,
  toolDiameter = 6,
  toolLength = 30,
  isSpinning = false,
  rpm = 0,
}: Props) {
  const toolRef = useRef<THREE.Group>(null)
  
  // Derived dimensions
  const motorHousingLength = spindleLength * 0.6
  const spindleBodyLength = spindleLength * 0.4
  const colletLength = 15
  const colletDiameter = spindleDiameter * 0.45

  // Spindle motor housing (dark gray)
  const housingMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#1a1a1a',
      metalness: 0.7,
      roughness: 0.4,
    })
  }, [])

  // Spindle body (aluminum)
  const spindleMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#3a3a3a',
      metalness: 0.85,
      roughness: 0.25,
    })
  }, [])

  // Collet/nut (brass-like)
  const colletMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#b08d57',
      metalness: 0.9,
      roughness: 0.2,
    })
  }, [])
  
  // Tool material (carbide - shiny silver)
  const toolMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#c0c0c0',
      metalness: 0.95,
      roughness: 0.1,
    })
  }, [])

  // Spinning indicator (glow when active)
  const spinIndicatorMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: isSpinning ? '#22c55e' : '#1a1a1a',
      emissive: isSpinning ? '#22c55e' : '#000000',
      emissiveIntensity: isSpinning ? 0.5 : 0,
      metalness: 0.5,
      roughness: 0.5,
    })
  }, [isSpinning])

  // Edge material - memoized
  const edgesMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: '#444' }), [])

  // Memoized geometries
  const spindleBodyGeometry = useMemo(() => 
    new THREE.CylinderGeometry(spindleDiameter / 2, spindleDiameter / 2, spindleBodyLength, 20),
    [spindleDiameter, spindleBodyLength]
  )
  const spindleEdgesGeometry = useMemo(() => 
    new THREE.EdgesGeometry(spindleBodyGeometry),
    [spindleBodyGeometry]
  )

  // Cleanup: dispose geometries and materials on unmount
  useEffect(() => {
    return () => {
      spindleBodyGeometry.dispose()
      spindleEdgesGeometry.dispose()
      housingMaterial.dispose()
      spindleMaterial.dispose()
      colletMaterial.dispose()
      toolMaterial.dispose()
      spinIndicatorMaterial.dispose()
      edgesMaterial.dispose()
    }
  }, [
    spindleBodyGeometry, spindleEdgesGeometry,
    housingMaterial, spindleMaterial, colletMaterial, toolMaterial, spinIndicatorMaterial, edgesMaterial
  ])

  // Animate tool rotation
  useFrame((_, delta) => {
    if (toolRef.current && isSpinning && rpm > 0) {
      // Convert RPM to radians per second
      const radiansPerSecond = (rpm / 60) * Math.PI * 2
      // Cap the visual rotation speed for performance (max ~30 rad/s visual)
      const visualSpeed = Math.min(radiansPerSecond, 30) * delta
      toolRef.current.rotation.z += visualSpeed
    }
  })

  return (
    <group>
      {/* Spindle motor housing (top part) */}
      <mesh 
        position={[0, 0, motorHousingLength / 2 + spindleBodyLength]} 
        material={housingMaterial}
      >
        <cylinderGeometry args={[spindleDiameter / 2 + 5, spindleDiameter / 2 + 5, motorHousingLength, 20]} />
      </mesh>

      {/* Motor housing top cap */}
      <mesh 
        position={[0, 0, motorHousingLength + spindleBodyLength + 5]} 
        material={housingMaterial}
      >
        <cylinderGeometry args={[spindleDiameter / 3, spindleDiameter / 2 + 5, 10, 20]} />
      </mesh>

      {/* Cable exit */}
      <mesh 
        position={[0, spindleDiameter / 2 + 10, motorHousingLength + spindleBodyLength - 10]} 
        rotation={[Math.PI / 2, 0, 0]}
        material={housingMaterial}
      >
        <cylinderGeometry args={[8, 8, 20, 8]} />
      </mesh>

      {/* Spindle body (middle section) */}
      <mesh 
        position={[0, 0, spindleBodyLength / 2]} 
        material={spindleMaterial}
      >
        <cylinderGeometry args={[spindleDiameter / 2, spindleDiameter / 2, spindleBodyLength, 20]} />
      </mesh>

      {/* Spindle nose / taper */}
      <mesh 
        position={[0, 0, -colletLength / 2]} 
        material={spindleMaterial}
      >
        <cylinderGeometry args={[colletDiameter + 5, spindleDiameter / 2, colletLength, 20]} />
      </mesh>

      {/* Status indicator ring */}
      <mesh 
        position={[0, 0, spindleBodyLength - 5]} 
        material={spinIndicatorMaterial}
      >
        <torusGeometry args={[spindleDiameter / 2 + 2, 2, 8, 24]} />
      </mesh>

      {/* Rotating parts group */}
      <group ref={toolRef}>
        {/* Collet nut */}
        <mesh 
          position={[0, 0, -colletLength - 5]} 
          material={colletMaterial}
        >
          <cylinderGeometry args={[colletDiameter, colletDiameter + 3, 10, 6]} />
        </mesh>

        {/* Tool shank (inserted part) */}
        <mesh 
          position={[0, 0, -colletLength - 10 - 10]} 
          material={toolMaterial}
        >
          <cylinderGeometry args={[toolDiameter / 2 + 1, toolDiameter / 2 + 1, 20, 12]} />
        </mesh>
        
        {/* Tool cutting part */}
        <mesh 
          position={[0, 0, -colletLength - 30 - toolLength / 2]} 
          material={toolMaterial}
        >
          <cylinderGeometry args={[toolDiameter / 2, toolDiameter / 2, toolLength, 12]} />
        </mesh>

        {/* Cutting flutes visualization (simplified helical grooves) */}
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            position={[
              Math.cos((i * Math.PI) / 2) * toolDiameter * 0.3,
              Math.sin((i * Math.PI) / 2) * toolDiameter * 0.3,
              -colletLength - 30 - toolLength / 2,
            ]}
            material={toolMaterial}
          >
            <boxGeometry args={[1, 1, toolLength * 0.9]} />
          </mesh>
        ))}
        
        {/* Tool tip (flat endmill) */}
        <mesh 
          position={[0, 0, -colletLength - 30 - toolLength]} 
          material={toolMaterial}
        >
          <cylinderGeometry args={[toolDiameter / 2, toolDiameter / 2, 1, 12]} />
        </mesh>
      </group>

      {/* Edges for spindle body */}
      <lineSegments 
        position={[0, 0, spindleBodyLength / 2]}
        geometry={spindleEdgesGeometry}
        material={edgesMaterial}
      />
    </group>
  )
})

export default ToolHead
