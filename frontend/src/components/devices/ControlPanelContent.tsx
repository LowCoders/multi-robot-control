import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Play,
  Pause,
  Square,
  Home,
  RotateCcw,
  FileCode,
  Box,
  Maximize2,
  Minimize2,
  Code,
  GripVertical,
  MousePointer2,
  Repeat,
} from 'lucide-react'
import PositionDisplay from './PositionDisplay'
import JogControl, { type JogMode } from './JogControl'
import MdiConsole from './MdiConsole'
import { VisualizationPanel, GcodePanel } from '../visualization'
import type { Device, DeviceCapabilities } from '../../types/device'
import type { MachineConfig } from '../../types/machine-config'

interface ControlPanelContentProps {
  device: Device
  machineConfig: MachineConfig | null
  configLoading: boolean
  sendCommand: (deviceId: string, command: string, params?: Record<string, unknown>) => void
  jogStop: (deviceId: string) => void
  capabilities?: DeviceCapabilities
}

export default function ControlPanelContent({
  device,
  machineConfig,
  configLoading,
  sendCommand,
  jogStop,
  capabilities,
}: ControlPanelContentProps) {
  const [vizExpanded, setVizExpanded] = useState(false)
  const [showGcode, setShowGcode] = useState(true)
  const [gcodeCollapsed, setGcodeCollapsed] = useState(false)
  const [gcodeWidthPercent, setGcodeWidthPercent] = useState(40)
  const [jogMode, setJogMode] = useState<JogMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`jog-mode-${device.id}`)
      if (saved === 'step' || saved === 'continuous') {
        return saved
      }
    }
    return 'continuous'
  })
  const [feedRate, setFeedRate] = useState(() => {
    const isRobotArm = device.type === 'robot_arm'
    const defaultRate = isRobotArm ? 50 : 1000
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`jog-settings-${device.id}`)
      if (saved) {
        try {
          const settings = JSON.parse(saved)
          if (typeof settings.feedRate === 'number' && settings.feedRate > 0) {
            return settings.feedRate
          }
        } catch {}
      }
    }
    return defaultRate
  })
  const [useSoftLimits, setUseSoftLimits] = useState(true)
  const supportsSoftLimits = capabilities?.supports_soft_limits === true

  // Soft limits állapot betöltése és szinkronizálása a backenddel
  useEffect(() => {
    const loadSoftLimitsState = async () => {
      if (!supportsSoftLimits) return
      try {
        const response = await fetch(`/api/devices/${device.id}/soft-limits`)
        if (response.ok) {
          const data = await response.json()
          setUseSoftLimits(data.soft_limits_enabled)
        }
      } catch {
        // Hiba esetén marad az alapértelmezett
      }
    }
    loadSoftLimitsState()
  }, [device.id, supportsSoftLimits])

  const handleSoftLimitsChange = async (enabled: boolean) => {
    if (!supportsSoftLimits) return
    setUseSoftLimits(enabled)
    try {
      const response = await fetch(`/api/devices/${device.id}/soft-limits?enabled=${enabled}`, {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error('Soft limits update failed')
      }
      const data = await response.json()
      if (typeof data.soft_limits_enabled === 'boolean') {
        setUseSoftLimits(data.soft_limits_enabled)
      }
    } catch {
      // Hiba esetén visszaállítjuk az előző állapotot
      setUseSoftLimits(!enabled)
    }
  }

  const axisLimits = useMemo(() => {
    // Dinamikus limitek preferálása a státuszból (valós idejű értékek)
    if (device.status?.dynamic_limits) {
      return device.status.dynamic_limits
    }
    // Fallback a statikus konfigurációra
    if (!machineConfig?.axes) return undefined
    const limits: Record<string, { min: number; max: number }> = {}
    for (const axis of machineConfig.axes) {
      limits[axis.name.toUpperCase()] = { min: axis.min, max: axis.max }
    }
    return limits
  }, [device.status?.dynamic_limits, machineConfig])

  // Save jogMode to local storage
  useEffect(() => {
    localStorage.setItem(`jog-mode-${device.id}`, jogMode)
  }, [jogMode, device.id])

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
      setGcodeWidthPercent((prev) => Math.min(60, Math.max(25, prev - deltaPercent)))
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

  const handleCommand = (command: string) => {
    if (command === 'home') {
      sendCommand(device.id, command, { feedRate })
    } else {
      sendCommand(device.id, command)
    }
  }

  const isRunning = device.state === 'running'
  const isPaused = device.state === 'paused'
  const isIdle = device.state === 'idle'
  const isAlarm = device.state === 'alarm'
  const isJog = device.state === 'jog'

  const handleStop = () => {
    const hasActiveProgram = device.status?.current_file && (device.status?.progress ?? 0) > 0
    if (isJog || (isRunning && !hasActiveProgram)) {
      jogStop(device.id)
    } else {
      sendCommand(device.id, 'stop')
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Status & Position */}
        <div className="space-y-4">
          {/* Status Card */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <span className="font-medium">Állapot</span>
              {supportsSoftLimits && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useSoftLimits}
                    onChange={(e) => handleSoftLimitsChange(e.target.checked)}
                    className="w-3 h-3 accent-machine-500"
                  />
                  <span className="text-xs text-steel-500">Limit</span>
                </label>
              )}
            </div>
            <div className="card-body space-y-4">
              {device.status && (
                <>
                  {isAlarm && (
                    <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {device.status.error_message || 'Alarm aktív, részletek nem érhetők el.'}
                    </div>
                  )}

                  <PositionDisplay 
                    position={device.status.work_position} 
                    machineConfig={machineConfig}
                    showLimits={useSoftLimits}
                    axisLimits={axisLimits}
                  />

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
                            <span>
                              Sor {device.status.current_line} / {device.status.total_lines}
                            </span>
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
                          <div className="text-steel-100">
                            {device.status.spindle_speed.toFixed(0)} RPM
                          </div>
                        </div>
                        <div className="bg-steel-800/50 rounded p-2">
                          <div className="text-steel-400 text-xs">Spindle Override</div>
                          <div className="text-steel-100">
                            {device.status.spindle_override.toFixed(0)}%
                          </div>
                        </div>
                      </>
                    )}
                  </div>

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
                  disabled={isRunning || (!isIdle && !isPaused) || !device.status?.current_file}
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
                  onClick={handleStop}
                  disabled={!isRunning && !isPaused && !isJog}
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
          <div className="card-header flex items-center justify-between flex-wrap gap-2">
            <span className="font-medium">Kézi Vezérlés (Jog)</span>
            <div className="flex gap-1">
              <button
                onClick={() => setJogMode('step')}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  jogMode === 'step'
                    ? 'bg-machine-600 text-white'
                    : 'bg-steel-700 text-steel-300 hover:bg-steel-600'
                }`}
              >
                <MousePointer2 className="w-3 h-3" />
                Lépésköz
              </button>
              <button
                onClick={() => setJogMode('continuous')}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  jogMode === 'continuous'
                    ? 'bg-machine-600 text-white'
                    : 'bg-steel-700 text-steel-300 hover:bg-steel-600'
                }`}
              >
                <Repeat className="w-3 h-3" />
                Folyamatos
              </button>
            </div>
          </div>
          <div className="card-body">
            <JogControl 
              deviceId={device.id} 
              deviceType={device.type} 
              status={device.status} 
              capabilities={capabilities}
              useSoftLimits={useSoftLimits}
              jogMode={jogMode}
              onJogModeChange={setJogMode}
              feedRate={feedRate}
              onFeedRateChange={setFeedRate}
            />
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
              {vizExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
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
                  position={device.status?.work_position}
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
