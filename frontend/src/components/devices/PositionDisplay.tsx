import type { Position } from '../../types/device'
import type { MachineConfig } from '../../types/machine-config'

interface Props {
  position: Position
  machineConfig?: MachineConfig | null
  showLabels?: boolean
  compact?: boolean
}

export default function PositionDisplay({ 
  position, 
  machineConfig,
  showLabels = true,
  compact = false 
}: Props) {
  const formatNumber = (n: number) => n.toFixed(3)
  
  const getAxisUnit = (axisName: string): string => {
    if (!machineConfig?.axes) return 'mm'
    const axis = machineConfig.axes.find(a => a.name.toUpperCase() === axisName.toUpperCase())
    return axis?.type === 'rotary' ? '°' : 'mm'
  }
  
  const axes = [
    { key: 'x', label: 'X', value: position.x, color: 'text-red-400', unit: getAxisUnit('X') },
    { key: 'y', label: 'Y', value: position.y, color: 'text-green-400', unit: getAxisUnit('Y') },
    { key: 'z', label: 'Z', value: position.z, color: 'text-blue-400', unit: getAxisUnit('Z') },
  ]
  
  if (compact) {
    return (
      <div className="flex items-center gap-4 font-mono text-sm">
        {axes.map(({ key, label, value, color, unit }) => (
          <div key={key} className="flex items-center gap-1">
            <span className={color}>{label}:</span>
            <span className="text-steel-200 tabular-nums">{formatNumber(value)}{unit}</span>
          </div>
        ))}
      </div>
    )
  }
  
  return (
    <div className="grid grid-cols-3 gap-2">
      {axes.map(({ key, label, value, color, unit }) => (
        <div 
          key={key}
          className="bg-steel-800/50 rounded-md p-2 text-center"
        >
          {showLabels && (
            <div className={`text-xs font-medium ${color} mb-1`}>{label}</div>
          )}
          <div className="font-mono text-lg text-steel-100 tabular-nums">
            {formatNumber(value)}
          </div>
          <div className="text-xs text-steel-500">{unit}</div>
        </div>
      ))}
    </div>
  )
}
