import { useMemo, memo, useEffect } from 'react'
import * as THREE from 'three'

interface Props {
  width: number
  height: number
  depth: number
  position?: [number, number, number]
}

const Workpiece = memo(function Workpiece({ 
  width, 
  height, 
  depth, 
  position = [0, 0, 0] 
}: Props) {
  // Create workpiece with aluminum-like material
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#a3a3a3',
      metalness: 0.6,
      roughness: 0.4,
    })
  }, [])

  // Edge material - memoized
  const edgesMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: '#525252' }), [])

  // Memoized geometry
  const boxGeometry = useMemo(() => 
    new THREE.BoxGeometry(width, depth, height),
    [width, depth, height]
  )
  const edgesGeometry = useMemo(() => 
    new THREE.EdgesGeometry(boxGeometry),
    [boxGeometry]
  )

  // Position the workpiece centered on X/Y, sitting on Z=0
  const adjustedPosition: [number, number, number] = useMemo(() => [
    position[0] + width / 2,
    position[1] + depth / 2,
    position[2] - height / 2,
  ], [position, width, depth, height])

  // Cleanup: dispose geometries and materials on unmount
  useEffect(() => {
    return () => {
      boxGeometry.dispose()
      edgesGeometry.dispose()
      material.dispose()
      edgesMaterial.dispose()
    }
  }, [boxGeometry, edgesGeometry, material, edgesMaterial])

  return (
    <group>
      {/* Main workpiece */}
      <mesh position={adjustedPosition} material={material} geometry={boxGeometry} />
      
      {/* Work surface outline */}
      <lineSegments position={adjustedPosition} geometry={edgesGeometry} material={edgesMaterial} />
    </group>
  )
})

export default Workpiece
