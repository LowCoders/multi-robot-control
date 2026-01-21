import { useMemo, useRef, useEffect, memo, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { AxisConfig, AxisName } from '../../types/machine-config'
import type { Position } from '../../types/device'

interface AxisCarriageProps {
  config: AxisConfig
  targetPosition: number
  children?: React.ReactNode
}

const AxisCarriage = memo(function AxisCarriage({ config, targetPosition, children }: AxisCarriageProps) {
  const groupRef = useRef<THREE.Group>(null)
  // Use ref to track animated position - start at 0, will animate to target
  const animatedPositionRef = useRef(0)
  const isFirstRender = useRef(true)
  
  // Default dimensions if not specified
  const dims = config.dimensions ?? { width: 60, height: 40, depth: 60 }
  
  // Get rail length based on axis limits
  const railLength = useMemo(() => {
    const range = config.max - config.min
    return Math.max(range + 50, 100)
  }, [config.max, config.min])

  // Carriage material
  const carriageMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: config.color,
      metalness: 0.6,
      roughness: 0.4,
    })
  }, [config.color])

  // Rail material (dark steel)
  const railMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#2a2a2a',
      metalness: 0.8,
      roughness: 0.3,
    })
  }, [])

  // Edge materials - memoized
  const edgesMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: '#444' }), [])
  const colorEdgesMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: config.color }), [config.color])

  // Geometries - memoized
  const carriageGeometry = useMemo(() => 
    new THREE.BoxGeometry(dims.width, dims.depth, dims.height),
    [dims.width, dims.depth, dims.height]
  )
  const carriageEdgesGeometry = useMemo(() => 
    new THREE.EdgesGeometry(carriageGeometry),
    [carriageGeometry]
  )

  const railGeometry = useMemo(() => 
    new THREE.BoxGeometry(20, 20, railLength),
    [railLength]
  )
  const railEdgesGeometry = useMemo(() => 
    new THREE.EdgesGeometry(railGeometry),
    [railGeometry]
  )

  const indicatorGeometry = useMemo(() => new THREE.SphereGeometry(3, 8, 8), [])
  const indicatorMaterial = useMemo(() => 
    new THREE.MeshStandardMaterial({ 
      color: config.color, 
      emissive: config.color, 
      emissiveIntensity: 0.5 
    }),
    [config.color]
  )

  // On first render, set initial position immediately (no animation)
  useEffect(() => {
    if (isFirstRender.current) {
      animatedPositionRef.current = targetPosition
      isFirstRender.current = false
      
      // Apply initial position immediately
      if (groupRef.current) {
        applyPosition(groupRef.current, animatedPositionRef.current)
      }
    }
  }, [targetPosition])

  // Cleanup: dispose geometries and materials on unmount
  useEffect(() => {
    return () => {
      carriageGeometry.dispose()
      carriageEdgesGeometry.dispose()
      railGeometry.dispose()
      railEdgesGeometry.dispose()
      indicatorGeometry.dispose()
      carriageMaterial.dispose()
      railMaterial.dispose()
      edgesMaterial.dispose()
      colorEdgesMaterial.dispose()
      indicatorMaterial.dispose()
    }
  }, [
    carriageGeometry, carriageEdgesGeometry, railGeometry, railEdgesGeometry, indicatorGeometry,
    carriageMaterial, railMaterial, edgesMaterial, colorEdgesMaterial, indicatorMaterial
  ])

  // Apply position to group based on axis type
  const applyPosition = (group: THREE.Group, pos: number) => {
    if (config.type === 'linear') {
      // Reset all positions first
      group.position.set(0, 0, 0)
      switch (config.name) {
        case 'X':
          group.position.x = pos
          break
        case 'Y':
          group.position.y = pos
          break
        case 'Z':
          group.position.z = pos
          break
      }
    } else if (config.type === 'rotary') {
      // Reset all rotations first
      group.rotation.set(0, 0, 0)
      const radians = THREE.MathUtils.degToRad(pos)
      switch (config.name) {
        case 'A':
          group.rotation.x = radians
          break
        case 'B':
          group.rotation.y = radians
          break
        case 'C':
          group.rotation.z = radians
          break
      }
    }
  }

  // Smooth animation toward target position
  useFrame((_, delta) => {
    if (groupRef.current) {
      // Calculate distance to target
      const distance = Math.abs(targetPosition - animatedPositionRef.current)
      
      // If very close, snap to target
      if (distance < 0.001) {
        animatedPositionRef.current = targetPosition
      } else {
        // Lerp toward target with speed based on distance
        const lerpSpeed = 8
        animatedPositionRef.current = THREE.MathUtils.lerp(
          animatedPositionRef.current,
          targetPosition,
          Math.min(1, lerpSpeed * delta)
        )
      }
      
      applyPosition(groupRef.current, animatedPositionRef.current)
    }
  })

  // Get rail position offset - memoized
  const railOffset = useMemo((): [number, number, number] => {
    const midpoint = (config.max + config.min) / 2
    switch (config.name) {
      case 'X': return [midpoint, 0, -dims.height / 2 - 10]
      case 'Y': return [0, midpoint, -dims.height / 2 - 10]
      case 'Z': return [0, 0, (config.max + config.min) / 2]
      default: return [0, 0, 0]
    }
  }, [config.max, config.min, config.name, dims.height])

  // Get rail rotation - memoized
  const railRotation = useMemo((): [number, number, number] => {
    switch (config.name) {
      case 'X': return [0, Math.PI / 2, 0]
      case 'Y': return [Math.PI / 2, 0, 0]
      case 'Z': return [0, 0, 0]
      default: return [0, 0, 0]
    }
  }, [config.name])

  return (
    <group ref={groupRef}>
      {/* Linear rail/guide (static, shown behind the carriage) */}
      {config.type === 'linear' && (
        <group position={railOffset} rotation={railRotation}>
          {/* Rail beam */}
          <mesh material={railMaterial} geometry={railGeometry} />
          {/* Rail edges */}
          <lineSegments geometry={railEdgesGeometry} material={edgesMaterial} />
        </group>
      )}

      {/* Carriage/slider block */}
      <mesh material={carriageMaterial} geometry={carriageGeometry} />
      
      {/* Edge highlight */}
      <lineSegments geometry={carriageEdgesGeometry} material={colorEdgesMaterial} />

      {/* Axis label */}
      <mesh 
        position={[dims.width / 2 + 5, 0, dims.height / 2]}
        geometry={indicatorGeometry}
        material={indicatorMaterial}
      />
      
      {/* Children (nested axes or tool head) */}
      {children}
    </group>
  )
})

interface AxisRendererProps {
  axes: AxisConfig[]
  position: Position
  children?: React.ReactNode
}

const AxisRenderer = memo(function AxisRenderer({ axes, position, children }: AxisRendererProps) {
  // Get position value for an axis from the Position object
  const getPositionValue = useCallback((axisName: AxisName): number => {
    const key = axisName.toLowerCase() as keyof Position
    return (position[key] as number) ?? 0
  }, [position])

  // Build tree structure for axes based on parent relationships - memoized
  const axisTree = useMemo(() => {
    // Find root axes (no parent)
    const rootAxes = axes.filter(a => !a.parent)
    
    const renderAxis = (axis: AxisConfig): React.ReactNode => {
      const childAxes = axes.filter(a => a.parent === axis.name)
      const targetPos = getPositionValue(axis.name)
      
      return (
        <AxisCarriage
          key={axis.name}
          config={axis}
          targetPosition={targetPos}
        >
          {childAxes.map(childAxis => renderAxis(childAxis))}
          {/* If this is a leaf axis (no children), render the tool/children */}
          {childAxes.length === 0 && children}
        </AxisCarriage>
      )
    }

    return rootAxes.map(axis => renderAxis(axis))
  }, [axes, getPositionValue, children])

  return <group>{axisTree}</group>
})

export default AxisRenderer
