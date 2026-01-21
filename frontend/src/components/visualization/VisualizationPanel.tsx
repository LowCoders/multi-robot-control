import { AlertCircle, FileCode } from 'lucide-react'
import type { MachineConfig } from '../../types/machine-config'
import type { DeviceStatus, Position } from '../../types/device'
import MachineVisualization from './MachineVisualization'

interface Props {
  config: MachineConfig
  position?: Position
  status?: DeviceStatus
  className?: string
  showDebugInfo?: boolean
  showHeader?: boolean
  headerExtra?: React.ReactNode
}

export default function VisualizationPanel({
  config,
  position,
  status,
  className = '',
  showDebugInfo = false,
  showHeader = true,
  headerExtra,
}: Props) {
  const currentFile = status?.current_file
  const filename = currentFile?.split('/').pop()

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header with program name */}
      {showHeader && (
        <div className="bg-steel-900/95 backdrop-blur border-b border-steel-700 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <FileCode className="w-4 h-4 text-steel-400" />
            {filename ? (
              <span className="text-steel-200 font-medium">{filename}</span>
            ) : (
              <span className="text-steel-500">Nincs futó program</span>
            )}
            {status?.state === 'running' && (
              <span className="ml-2 px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">
                Fut
              </span>
            )}
            {status?.state === 'paused' && (
              <span className="ml-2 px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded">
                Szünet
              </span>
            )}
          </div>
          {headerExtra}
        </div>
      )}
      
      {/* 3D Visualization */}
      <div className="flex-1 min-h-0 relative">
        <MachineVisualization
          config={config}
          position={position}
          status={status}
        />
        
        {/* Debug overlay - show position updates */}
        {showDebugInfo && (
          <div className="absolute top-2 left-2 bg-black/80 text-xs font-mono p-2 rounded text-green-400">
            <div>POS: X={position?.x?.toFixed(2) ?? '?'} Y={position?.y?.toFixed(2) ?? '?'} Z={position?.z?.toFixed(2) ?? '?'}</div>
            <div>STATE: {status?.state ?? 'unknown'}</div>
            <div>LINE: {status?.current_line ?? 0} / {status?.total_lines ?? 0}</div>
            <div>FILE: {status?.current_file?.split('/').pop() ?? 'none'}</div>
          </div>
        )}
      </div>
      
      {/* Status bar at bottom */}
      <div className="bg-steel-900/95 backdrop-blur border-t border-steel-700 px-3 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          {/* Position display */}
          <div className="flex items-center gap-3 font-mono">
            <span className="text-red-400">
              X: {(position?.x ?? 0).toFixed(3)}
            </span>
            <span className="text-green-400">
              Y: {(position?.y ?? 0).toFixed(3)}
            </span>
            <span className="text-blue-400">
              Z: {(position?.z ?? 0).toFixed(3)}
            </span>
            {position?.a !== undefined && (
              <span className="text-amber-400">
                A: {position.a.toFixed(2)}°
              </span>
            )}
            {position?.b !== undefined && (
              <span className="text-purple-400">
                B: {position.b.toFixed(2)}°
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-4 text-steel-400">
          {/* Feed rate */}
          {status && (
            <span>F: {status.feed_rate?.toFixed(0) ?? 0} mm/min</span>
          )}
          
          {/* Spindle */}
          {status && status.spindle_speed > 0 && (
            <span>S: {status.spindle_speed.toFixed(0)} RPM</span>
          )}
          
          {/* Connection indicator */}
          {!status && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertCircle className="w-3 h-3" />
              Nincs kapcsolat
            </span>
          )}
          
          {/* State indicator */}
          {status && (
            <span className={`
              px-2 py-0.5 rounded text-xs font-medium
              ${status.state === 'running' ? 'bg-blue-500/20 text-blue-400' : ''}
              ${status.state === 'idle' ? 'bg-green-500/20 text-green-400' : ''}
              ${status.state === 'paused' ? 'bg-amber-500/20 text-amber-400' : ''}
              ${status.state === 'alarm' ? 'bg-red-500/20 text-red-400' : ''}
              ${status.state === 'disconnected' ? 'bg-gray-500/20 text-gray-400' : ''}
              ${status.state === 'homing' ? 'bg-cyan-500/20 text-cyan-400' : ''}
              ${status.state === 'jog' ? 'bg-purple-500/20 text-purple-400' : ''}
            `}>
              {status.state?.toUpperCase() ?? 'UNKNOWN'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
