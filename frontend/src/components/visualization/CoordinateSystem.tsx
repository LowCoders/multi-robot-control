/**
 * Koordináta-rendszer gizmo a scene origójában.
 *
 * A V2 vizualizáció CAD Z-up konvenciót használ (lásd `v2/types.ts`):
 *   - X (piros)  = csőelőtolás iránya
 *   - Y (zöld)   = operátor felé (mélység)
 *   - Z (kék)    = függőlegesen FEL (magasság)
 *
 * A gizmo a tengelyek IRÁNYÁT mutatja a world-koordinátákban; a renderer
 * Z-up beállítása miatt a Z nyíl felfelé mutat.
 *
 * # Felirat-orientáció (Z-up)
 *
 * A drei `<Text>` lokális +Y tengelye = karakter "fel"-iránya. Default
 * (rotation [0,0,0]) esetén a karakterek a world XY síkban fekszenek és
 * a karakter-fel = world +Y. Ez Z-up világban "lefektetett" felirat —
 * mintha a feliratok a base tetején hevernének, és csak a tetejüket
 * látnánk élben. Ezért `rotation = [Math.PI/2, 0, 0]`-val elforgatjuk:
 * Text local +Y → world +Z (karakterek függőlegesen állnak), Text local
 * +Z → world -Y (azaz a felirat NORMÁLISA -Y irányba mutat, így az
 * operátor felől nézve olvasható).
 *
 * Emellett a felirat-pozíciót +`fontSize` Z-eltolással emeljük, hogy a
 * Base lap teteje ne takarja el (a Base ~50 mm magas, a label a tengely
 * végénél van; az X / Y feliratok pl. (90, 0, 0) ill. (0, 90, 0) helyett
 * Z-emelten (90, 0, fontSize) ill. (0, 90, fontSize) jelennek meg).
 */
import { Line, Text } from '@react-three/drei'

interface Props {
  size?: number
  showLabels?: boolean
}

const FONT_SIZE = 8

export default function CoordinateSystem({ size = 50, showLabels = true }: Props) {
  const axisConfig = [
    { axis: 'X', color: '#ef4444', direction: [1, 0, 0] as [number, number, number] },
    { axis: 'Y', color: '#22c55e', direction: [0, 1, 0] as [number, number, number] },
    { axis: 'Z', color: '#3b82f6', direction: [0, 0, 1] as [number, number, number] },
  ]

  return (
    <group>
      {axisConfig.map(({ axis, color, direction }) => {
        const end = direction.map((d) => d * size) as [number, number, number]
        const labelBase = direction.map((d) => d * (size + 10)) as [number, number, number]
        // Z-eltolás a sormagasság értékével — így a Base teteje fölé kerül.
        const labelPos: [number, number, number] = [
          labelBase[0],
          labelBase[1],
          labelBase[2] + FONT_SIZE,
        ]

        return (
          <group key={axis}>
            <Line points={[[0, 0, 0], end]} color={color} lineWidth={2} />
            {/* Arrow head */}
            <mesh position={end}>
              <coneGeometry args={[2, 6, 8]} />
              <meshStandardMaterial color={color} />
            </mesh>
            {showLabels && (
              <Text
                position={labelPos}
                rotation={[Math.PI / 2, 0, 0]}
                fontSize={FONT_SIZE}
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
