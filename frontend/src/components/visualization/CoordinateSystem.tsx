import { Line, Text } from '@react-three/drei'

interface Props {
  size?: number
  showLabels?: boolean
}

export default function CoordinateSystem({ size = 50, showLabels = true }: Props) {
  const axisConfig = [
    { axis: 'X', color: '#ef4444', direction: [1, 0, 0] as [number, number, number] },
    { axis: 'Y', color: '#22c55e', direction: [0, 1, 0] as [number, number, number] },
    { axis: 'Z', color: '#3b82f6', direction: [0, 0, 1] as [number, number, number] },
  ]

  return (
    <group>
      {axisConfig.map(({ axis, color, direction }) => {
        const end = direction.map(d => d * size) as [number, number, number]
        const labelPos = direction.map(d => d * (size + 10)) as [number, number, number]
        
        return (
          <group key={axis}>
            <Line
              points={[[0, 0, 0], end]}
              color={color}
              lineWidth={2}
            />
            {/* Arrow head */}
            <mesh position={end}>
              <coneGeometry args={[2, 6, 8]} />
              <meshStandardMaterial color={color} />
            </mesh>
            {showLabels && (
              <Text
                position={labelPos}
                fontSize={8}
                color={color}
                anchorX="center"
                anchorY="middle"
              >
                {axis}
              </Text>
            )}
          </group>
        )
      })}
    </group>
  )
}
