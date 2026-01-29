import { Link } from 'react-router-dom'
import { 
  Play, 
  Pause, 
  Square, 
  Home,
  RotateCcw,
  Drill,
  Zap,
  Gamepad2,
  Plug,
} from 'lucide-react'
import type { Device } from '../../types/device'
import { useDeviceStore } from '../../stores/deviceStore'
import PositionDisplay from './PositionDisplay'
import StatusBadge from '../common/StatusBadge'

interface Props {
  device: Device
}

export default function DeviceCard({ device }: Props) {
  const { sendCommand } = useDeviceStore()
  
  const handleCommand = (command: string) => {
    sendCommand(device.id, command)
  }
  
  const isRunning = device.state === 'running'
  const isPaused = device.state === 'paused'
  const isIdle = device.state === 'idle'
  const isAlarm = device.state === 'alarm'
  
  const DeviceIcon = device.type === 'laser_cutter' || device.type === 'laser_engraver' 
    ? Zap 
    : Drill
  
  return (
    <div className={`
      card transition-all duration-300
      ${isRunning ? 'glow-blue border-blue-500/50' : ''}
      ${isAlarm ? 'glow-red border-red-500/50' : ''}
      ${isPaused ? 'glow-amber border-amber-500/50' : ''}
    `}>
      {/* Header */}
      <div className="card-header">
        <div className="flex items-center gap-3">
          <div className={`
            w-10 h-10 rounded-lg flex items-center justify-center
            ${device.type.includes('laser') 
              ? 'bg-purple-500/20 text-purple-400' 
              : 'bg-blue-500/20 text-blue-400'
            }
          `}>
            <DeviceIcon className="w-5 h-5" />
          </div>
          <div>
            <Link 
              to={`/device/${device.id}`}
              className="font-semibold text-white hover:text-machine-400 transition-colors"
            >
              {device.name}
            </Link>
            <div className="flex items-center gap-2 text-xs text-steel-400">
              <span>{device.driver.toUpperCase()}</span>
              {device.connectionInfo && !device.simulated && (
                <span className="flex items-center gap-1 text-steel-500">
                  <Plug className="w-3 h-3" />
                  {device.connectionInfo}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {device.simulated && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded">
              <Gamepad2 className="w-3 h-3" />
              SZIM
            </span>
          )}
          <StatusBadge state={device.state} />
        </div>
      </div>
      
      {/* Body */}
      <div className="card-body space-y-4">
        {/* Position */}
        {device.status && (
          <PositionDisplay position={device.status.position} />
        )}
        
        {/* Progress (if running) */}
        {isRunning && device.status && device.status.progress > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-steel-400">Haladás</span>
              <span className="text-steel-300">{device.status.progress.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-steel-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-machine-500 transition-all duration-300"
                style={{ width: `${device.status.progress}%` }}
              />
            </div>
          </div>
        )}
        
        {/* Feed/Speed info */}
        {device.status && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-steel-400">Feed: </span>
              <span className="text-steel-200">{device.status.feed_rate.toFixed(0)} mm/min</span>
            </div>
            {device.status.spindle_speed > 0 && (
              <div>
                <span className="text-steel-400">Spindle: </span>
                <span className="text-steel-200">{device.status.spindle_speed.toFixed(0)} RPM</span>
              </div>
            )}
            {device.status.laser_power > 0 && (
              <div>
                <span className="text-steel-400">Lézer: </span>
                <span className="text-steel-200">{device.status.laser_power.toFixed(0)}%</span>
              </div>
            )}
          </div>
        )}
        
        {/* Error message */}
        {(isAlarm && device.status?.error_message) || device.lastError ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-2">
            <p className="text-sm text-red-400">
              {device.status?.error_message || device.lastError}
            </p>
          </div>
        ) : null}
        
        {/* Controls */}
        <div className="flex items-center gap-2 pt-2 border-t border-steel-700">
          <button
            onClick={() => handleCommand('home')}
            disabled={!isIdle}
            className="btn-icon"
            title="Home"
          >
            <Home className="w-4 h-4" />
          </button>
          
          {!isRunning && !isPaused && (
            <button
              onClick={() => handleCommand('run')}
              disabled={!isIdle || !device.status?.current_file}
              className="btn-icon text-machine-400 hover:text-machine-300"
              title="Start"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          
          {isRunning && (
            <button
              onClick={() => handleCommand('pause')}
              className="btn-icon text-amber-400 hover:text-amber-300"
              title="Pause"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          
          {isPaused && (
            <button
              onClick={() => handleCommand('resume')}
              className="btn-icon text-machine-400 hover:text-machine-300"
              title="Resume"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          
          {(isRunning || isPaused) && (
            <button
              onClick={() => handleCommand('stop')}
              className="btn-icon text-red-400 hover:text-red-300"
              title="Stop"
            >
              <Square className="w-4 h-4" />
            </button>
          )}
          
          {isAlarm && (
            <button
              onClick={() => handleCommand('reset')}
              className="btn-icon text-amber-400 hover:text-amber-300"
              title="Reset"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          
          <Link
            to={`/device/${device.id}`}
            className="ml-auto text-sm text-steel-400 hover:text-machine-400 transition-colors"
          >
            Részletek →
          </Link>
        </div>
      </div>
    </div>
  )
}
