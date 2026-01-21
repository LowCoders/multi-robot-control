import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { 
  ArrowLeft, 
  Play, 
  Pause, 
  Square, 
  Home, 
  RotateCcw,
  Settings,
  FileCode,
  Box,
  Maximize2,
  Minimize2,
  Wrench,
  Code,
  GripVertical,
} from 'lucide-react'
import { useDeviceStore } from '../stores/deviceStore'
import PositionDisplay from '../components/devices/PositionDisplay'
import JogControl from '../components/devices/JogControl'
import StatusBadge from '../components/common/StatusBadge'
import MdiConsole from '../components/devices/MdiConsole'
import { VisualizationPanel, GcodePanel } from '../components/visualization'
import { useMachineConfig } from '../hooks/useMachineConfig'

export default function DeviceDetail() {
  const { deviceId } = useParams<{ deviceId: string }>()
  const { devices, sendCommand } = useDeviceStore()
  const [vizExpanded, setVizExpanded] = useState(false)
  const [showGcode, setShowGcode] = useState(true)
  const [gcodeCollapsed, setGcodeCollapsed] = useState(false)
  const [gcodeWidthPercent, setGcodeWidthPercent] = useState(40)
  
  // Resize handling
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    lastPos.current = e.clientX
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      
      const containerWidth = containerRef.current.offsetWidth
      const delta = e.clientX - lastPos.current
      lastPos.current = e.clientX
      const deltaPercent = (delta / containerWidth) * 100
      setGcodeWidthPercent(prev => Math.min(60, Math.max(25, prev - deltaPercent)))
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])
  
  const device = devices.find(d => d.id === deviceId)
  const { config: machineConfig, loading: configLoading } = useMachineConfig(
    deviceId ?? '', 
    device?.type
  )
  
  if (!device) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-steel-400 mb-4">Eszköz nem található</p>
        <Link to="/" className="btn btn-primary">
          Vissza a Dashboard-ra
        </Link>
      </div>
    )
  }
  
  const handleCommand = (command: string) => {
    sendCommand(device.id, command)
  }
  
  const isRunning = device.state === 'running'
  const isPaused = device.state === 'paused'
  const isIdle = device.state === 'idle'
  const isAlarm = device.state === 'alarm'
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link 
            to="/"
            className="btn-icon hover:bg-steel-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">{device.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge state={device.state} />
              <span className="text-sm text-steel-400">{device.driver.toUpperCase()}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Link 
            to={`/device/${device.id}/config`}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Wrench className="w-4 h-4" />
            Gép Konfiguráció
          </Link>
          <button className="btn btn-secondary flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Beállítások
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Status & Position */}
        <div className="space-y-4">
          {/* Status Card */}
          <div className="card">
            <div className="card-header">
              <span className="font-medium">Állapot</span>
            </div>
            <div className="card-body space-y-4">
              {device.status && (
                <>
                  <PositionDisplay position={device.status.position} />
                  
                  {/* Progress */}
                  {device.status.current_file && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <FileCode className="w-4 h-4 text-steel-400" />
                        <span className="text-steel-300 truncate">
                          {device.status.current_file.split('/').pop()}
                        </span>
                      </div>
                      
                      {device.status.total_lines > 0 && (
                        <>
                          <div className="h-2 bg-steel-800 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-blue-500 to-machine-500"
                              style={{ width: `${device.status.progress}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-steel-400">
                            <span>Sor {device.status.current_line} / {device.status.total_lines}</span>
                            <span>{device.status.progress.toFixed(1)}%</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  
                  {/* Info Grid */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-steel-800/50 rounded p-2">
                      <div className="text-steel-400 text-xs">Feed Rate</div>
                      <div className="text-steel-100">{device.status.feed_rate.toFixed(0)} mm/min</div>
                    </div>
                    <div className="bg-steel-800/50 rounded p-2">
                      <div className="text-steel-400 text-xs">Feed Override</div>
                      <div className="text-steel-100">{device.status.feed_override.toFixed(0)}%</div>
                    </div>
                    {device.status.spindle_speed > 0 && (
                      <>
                        <div className="bg-steel-800/50 rounded p-2">
                          <div className="text-steel-400 text-xs">Spindle</div>
                          <div className="text-steel-100">{device.status.spindle_speed.toFixed(0)} RPM</div>
                        </div>
                        <div className="bg-steel-800/50 rounded p-2">
                          <div className="text-steel-400 text-xs">Spindle Override</div>
                          <div className="text-steel-100">{device.status.spindle_override.toFixed(0)}%</div>
                        </div>
                      </>
                    )}
                  </div>
                  
                  {/* Error */}
                  {isAlarm && device.status.error_message && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
                      <p className="text-sm text-red-400">{device.status.error_message}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          
          {/* Control Buttons */}
          <div className="card">
            <div className="card-header">
              <span className="font-medium">Vezérlés</span>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-5 gap-2">
                <button
                  onClick={() => handleCommand('home')}
                  disabled={!isIdle}
                  className="btn btn-secondary flex flex-col items-center gap-1 py-3"
                  title="Home"
                >
                  <Home className="w-5 h-5" />
                  <span className="text-xs">Home</span>
                </button>
                
                <button
                  onClick={() => handleCommand(isPaused ? 'resume' : 'run')}
                  disabled={isRunning || (!isIdle && !isPaused)}
                  className="btn btn-primary flex flex-col items-center gap-1 py-3"
                  title={isPaused ? 'Resume' : 'Run'}
                >
                  <Play className="w-5 h-5" />
                  <span className="text-xs">{isPaused ? 'Resume' : 'Run'}</span>
                </button>
                
                <button
                  onClick={() => handleCommand('pause')}
                  disabled={!isRunning}
                  className="btn btn-warning flex flex-col items-center gap-1 py-3"
                  title="Pause"
                >
                  <Pause className="w-5 h-5" />
                  <span className="text-xs">Pause</span>
                </button>
                
                <button
                  onClick={() => handleCommand('stop')}
                  disabled={!isRunning && !isPaused}
                  className="btn btn-danger flex flex-col items-center gap-1 py-3"
                  title="Stop"
                >
                  <Square className="w-5 h-5" />
                  <span className="text-xs">Stop</span>
                </button>
                
                <button
                  onClick={() => handleCommand('reset')}
                  disabled={!isAlarm}
                  className="btn btn-secondary flex flex-col items-center gap-1 py-3"
                  title="Reset"
                >
                  <RotateCcw className="w-5 h-5" />
                  <span className="text-xs">Reset</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        
        {/* Middle Column - Jog */}
        <div className="card">
          <div className="card-header">
            <span className="font-medium">Kézi Vezérlés (Jog)</span>
          </div>
          <div className="card-body">
            <JogControl deviceId={device.id} />
          </div>
        </div>
        
        {/* Right Column - MDI */}
        <div className="card">
          <div className="card-header">
            <span className="font-medium">MDI Konzol</span>
          </div>
          <div className="card-body">
            <MdiConsole deviceId={device.id} />
          </div>
        </div>
      </div>
      
      {/* Visualization Section - 3D and G-code side by side */}
      <div className={`card ${vizExpanded ? 'fixed inset-4 z-50' : ''}`}>
        <div className="card-header flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Box className="w-4 h-4 text-blue-400" />
            <span className="font-medium">Vizualizáció</span>
            {device.status?.current_file && (
              <span className="text-sm text-steel-400">
                — {device.status.current_file.split('/').pop()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* G-code toggle */}
            <button
              onClick={() => setShowGcode(!showGcode)}
              className={`btn-icon hover:bg-steel-700 ${showGcode ? 'text-machine-400' : 'text-steel-500'}`}
              title={showGcode ? 'G-code elrejtése' : 'G-code megjelenítése'}
            >
              <Code className="w-4 h-4" />
            </button>
            
            {/* Expand toggle */}
            <button
              onClick={() => setVizExpanded(!vizExpanded)}
              className="btn-icon hover:bg-steel-700"
              title={vizExpanded ? 'Összecsukás' : 'Teljes képernyő'}
            >
              {vizExpanded ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
        
        <div className={`card-body p-0 ${vizExpanded ? 'h-[calc(100%-60px)]' : 'h-[500px]'}`}>
          <div ref={containerRef} className="flex h-full">
            {/* 3D Visualization - takes remaining space */}
            <div className="flex-1 min-w-0 h-full overflow-hidden">
              {configLoading ? (
                <div className="flex items-center justify-center h-full text-steel-400">
                  <span>Konfiguráció betöltése...</span>
                </div>
              ) : machineConfig ? (
                <VisualizationPanel
                  config={machineConfig}
                  position={device.status?.position}
                  status={device.status}
                  className="h-full"
                  showHeader={false}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-steel-400">
                  <span>Nincs elérhető konfiguráció</span>
                </div>
              )}
            </div>
            
            {/* Resize handle */}
            {showGcode && (
              <div
                onMouseDown={handleMouseDown}
                className="w-1.5 flex-shrink-0 bg-steel-700 hover:bg-machine-500 cursor-col-resize flex items-center justify-center group transition-colors"
              >
                <GripVertical className="w-3 h-3 text-steel-600 group-hover:text-white" />
              </div>
            )}
            
            {/* G-code Panel - right side */}
            {showGcode && (
              <div 
                className="flex-shrink-0 h-full overflow-hidden"
                style={{ width: `${gcodeWidthPercent}%` }}
              >
                <GcodePanel
                  deviceId={device.id}
                  status={device.status}
                  collapsed={gcodeCollapsed}
                  onToggle={() => setGcodeCollapsed(!gcodeCollapsed)}
                  onClose={() => setShowGcode(false)}
                  className="h-full rounded-none border-0"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
