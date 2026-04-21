import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  Loader2,
} from 'lucide-react'
import PositionDisplay from './PositionDisplay'
import JogControl, { type JogMode } from './JogControl'
import MdiConsole, { MdiConsoleHeaderControls } from './MdiConsole'
import ExtraControlsPanel from './ExtraControlsPanel'
import { VisualizationPanel, GcodePanel } from '../visualization'
import { useGcodeBufferStore } from '../../stores/gcodeBufferStore'
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
  const { t } = useTranslation('devices')
  const { t: tPages } = useTranslation('pages')
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
      // Csak akkor adjuk hozzá a limitet, ha mindkét érték konkrétan meg van adva.
      // null = nincs limit, ezeket kihagyjuk.
      if (axis.min == null || axis.max == null) continue
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
  const supportsPanelController = capabilities?.supports_panel_controller === true
  const hostLockedByPanel = supportsPanelController && device.control?.owner === 'panel'

  // === Run flow integration with the in-memory G-code buffer ===
  //
  // A futtatáshoz a G-code ablak aktuális tartalmát egyetlen atomi backend
  // hívásban visszük át (`/api/devices/:id/run-buffer`):
  //   1. Egyedi (timestamp-pel ellátott) scratch fájlba menti a tartalmat
  //      a GCODE_ROOT/.scratch/ alatt.
  //   2. Régi scratch fájlokat takarítja erre az eszközre.
  //   3. Betölteti a scratch fájlt az eszközre (`loadFile`).
  //   4. Elindítja a futást (`run`).
  //
  // Az egyedi név megakadályozza, hogy a bridge/driver fájl-cache miatt a
  // korábbi (rövidebb) verziót futtassa. A felhasználó által nevesített
  // mentett fájl nem kerül felülírásra, mert a futtatás független scratch
  // útvonalon megy.
  const buffer = useGcodeBufferStore((s) => s.buffers[device.id])
  const setBufferEditing = useGcodeBufferStore((s) => s.setEditing)
  const hasGcodeContent = (buffer?.lines.length ?? 0) > 0
  const currentBackendFile = device.status?.current_file ?? null

  const [preparingRun, setPreparingRun] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  // Egyszerre csak egy Play folyamat fusson, akkor is ha a felhasználó
  // gyorsan többször klikkel.
  const runInFlightRef = useRef(false)

  const handlePlay = useCallback(async () => {
    if (runInFlightRef.current) return
    setRunError(null)

    if (isPaused) {
      sendCommand(device.id, 'resume')
      return
    }

    if (hasGcodeContent && buffer) {
      runInFlightRef.current = true
      setPreparingRun(true)
      // Optimisztikusan átkapcsolunk read-only/futási nézetre, hogy a
      // felhasználó azonnal lássa a sor-kiemelést — ne kelljen megvárni az
      // 500ms-os backend status pollingot. Ha a futás nem indul el, a
      // backend állapota később felülírja ezt.
      setBufferEditing(device.id, false)
      try {
        const content = buffer.lines.join('\n')
        const res = await fetch(`/api/devices/${device.id}/run-buffer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setRunError(data.error || t('control_panel.run_failed_http', { status: res.status }))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('control_panel.unknown_error')
        setRunError(t('control_panel.run_error_prefix', { detail: msg }))
      } finally {
        runInFlightRef.current = false
        setPreparingRun(false)
      }
      return
    }

    // Fallback: nincs lokális tartalom, de a backend-en már be van töltve
    // valamilyen fájl — futtassuk azt.
    if (currentBackendFile) {
      sendCommand(device.id, 'run')
    }
  }, [
    isPaused,
    hasGcodeContent,
    buffer,
    currentBackendFile,
    device.id,
    sendCommand,
    setBufferEditing,
    t,
  ])

  // A Play gomb akkor aktív, ha (a) szüneteltetve van (Resume), (b) a
  // lokális G-code bufferben van futtatható tartalom, vagy (c) a backend-en
  // már be van töltve egy fájl.
  const canPlay =
    !isRunning &&
    (isPaused || isIdle) &&
    !hostLockedByPanel &&
    !preparingRun &&
    (hasGcodeContent || !!currentBackendFile)

  const playTitle = useMemo(() => {
    if (isPaused) return t('control_panel.resume')
    if (!canPlay) {
      if (hostLockedByPanel) return t('control_panel.start_blocked_panel')
      if (isRunning) return t('control_panel.start_blocked_running')
      if (!hasGcodeContent && !currentBackendFile) return t('control_panel.start_blocked_no_gcode')
      return t('control_panel.start')
    }
    return t('control_panel.start_from_editor')
  }, [
    isPaused,
    canPlay,
    hostLockedByPanel,
    isRunning,
    hasGcodeContent,
    currentBackendFile,
    t,
  ])

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
              <span className="font-medium">{t('control_panel.section_status')}</span>
              {supportsSoftLimits && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useSoftLimits}
                    onChange={(e) => handleSoftLimitsChange(e.target.checked)}
                    className="w-3 h-3 accent-machine-500"
                  />
                  <span className="text-xs text-steel-500">{t('control_panel.limit_short')}</span>
                </label>
              )}
            </div>
            <div className="card-body space-y-4">
              {device.status && (
                <>
                  {isAlarm && (
                    <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {device.status.error_message || t('control_panel.alarm_no_detail')}
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
                              {t('control_panel.line_row', {
                                current: device.status.current_line,
                                total: device.status.total_lines,
                              })}
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
                      <div className="text-steel-400 text-xs">{t('control_panel.feed_rate')}</div>
                      <div className="text-steel-100">{device.status.feed_rate.toFixed(0)} mm/min</div>
                    </div>
                    <div className="bg-steel-800/50 rounded p-2">
                      <div className="text-steel-400 text-xs">{t('control_panel.feed_override_lbl')}</div>
                      <div className="text-steel-100">{device.status.feed_override.toFixed(0)}%</div>
                    </div>
                    {device.status.spindle_speed > 0 && (
                      <>
                        <div className="bg-steel-800/50 rounded p-2">
                          <div className="text-steel-400 text-xs">{t('control_panel.spindle_lbl')}</div>
                          <div className="text-steel-100">
                            {device.status.spindle_speed.toFixed(0)} RPM
                          </div>
                        </div>
                        <div className="bg-steel-800/50 rounded p-2">
                          <div className="text-steel-400 text-xs">{t('control_panel.spindle_override_lbl')}</div>
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
              <span className="font-medium">{t('control_panel.section_control')}</span>
            </div>
            <div className="card-body">
              {supportsPanelController && (
                <div className="mb-3 rounded border border-steel-700 bg-steel-800/40 p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-steel-400">{t('control_panel.owner_label')}</span>
                    <span className="text-steel-200 uppercase">{device.control?.owner ?? 'none'}</span>
                  </div>
                  {!!device.control?.reason && (
                    <div className="mt-1 text-steel-300">
                      {t('control_panel.reason_label')} {device.control.reason}
                    </div>
                  )}
                  {device.control?.owner === 'host' && (
                    <div className="mt-2 text-emerald-300">{t('control_panel.host_active_panel')}</div>
                  )}
                  {device.control?.owner === 'none' && (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-steel-300">{t('control_panel.no_active_owner')}</span>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={!device.control?.can_take_control}
                        onClick={() => sendCommand(device.id, 'take_control', { owner: 'host' })}
                        title={
                          !device.control?.can_take_control
                            ? t('control_panel.host_takeover_denied_running')
                            : t('control_panel.host_takeover')
                        }
                      >
                        {t('control_panel.host_activate')}
                      </button>
                    </div>
                  )}
                  {hostLockedByPanel && (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-amber-300">{t('control_panel.panel_control_active')}</span>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={!device.control?.can_take_control}
                        onClick={() => sendCommand(device.id, 'take_control', { owner: 'host' })}
                        title={
                          !device.control?.can_take_control
                            ? t('control_panel.host_takeover_denied_running')
                            : t('control_panel.host_takeover')
                        }
                      >
                        {t('control_panel.reclaim_host')}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-5 gap-2">
                <button
                  onClick={() => handleCommand('home')}
                  disabled={!isIdle || hostLockedByPanel}
                  className="btn btn-secondary flex flex-col items-center gap-1 py-3"
                  title="Home"
                >
                  <Home className="w-5 h-5" />
                  <span className="text-xs">Home</span>
                </button>

                <button
                  onClick={handlePlay}
                  disabled={!canPlay}
                  className="btn btn-primary flex flex-col items-center gap-1 py-3"
                  title={playTitle}
                >
                  {preparingRun ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Play className="w-5 h-5" />
                  )}
                  <span className="text-xs">
                    {isPaused ? t('control_panel.btn_resume') : t('control_panel.btn_run')}
                  </span>
                </button>

                <button
                  onClick={() => handleCommand('pause')}
                  disabled={!isRunning || hostLockedByPanel}
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
              {runError && (
                <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
                  {runError}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Middle Column - Jog */}
        <div className="card">
          <div className="card-header flex items-center justify-between flex-wrap gap-2">
            <span className="font-medium">{t('control_panel.section_jog')}</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setJogMode('step')}
                aria-pressed={jogMode === 'step'}
                className={`btn btn-xs ${jogMode === 'step' ? 'btn-primary' : 'btn-secondary'}`}
              >
                <MousePointer2 className="w-3 h-3" />
                {t('control_panel.jog_step')}
              </button>
              <button
                type="button"
                onClick={() => setJogMode('continuous')}
                aria-pressed={jogMode === 'continuous'}
                className={`btn btn-xs ${jogMode === 'continuous' ? 'btn-primary' : 'btn-secondary'}`}
              >
                <Repeat className="w-3 h-3" />
                {t('control_panel.jog_continuous')}
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
        <div className="card flex flex-col h-full">
          <div className="card-header flex items-center gap-3">
            <span className="font-medium whitespace-nowrap">{t('control_panel.mdi_title')}</span>
            <MdiConsoleHeaderControls deviceId={device.id} />
          </div>
          <div className="card-body flex-1 flex flex-col min-h-0">
            <MdiConsole deviceId={device.id} />
          </div>
        </div>
      </div>

      {/* Extra vezérlés - eszköz-specifikus runtime gombok (capabilities alapján) */}
      <ExtraControlsPanel
        device={device}
        machineConfig={machineConfig}
        capabilities={capabilities}
      />

      {/* Visualization Section - 3D and G-code side by side */}
      <div className={`card ${vizExpanded ? 'fixed inset-4 z-50' : ''}`}>
        <div className="card-header flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Box className="w-4 h-4 text-blue-400" />
            <span className="font-medium">{t('control_panel.viz_title')}</span>
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
              title={
                showGcode ? t('control_panel.toggle_gcode_hide') : t('control_panel.toggle_gcode_show')
              }
            >
              <Code className="w-4 h-4" />
            </button>

            {/* Expand toggle */}
            <button
              onClick={() => setVizExpanded(!vizExpanded)}
              className="btn-icon hover:bg-steel-700"
              title={vizExpanded ? t('control_panel.collapse') : t('control_panel.fullscreen')}
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
                  <span>{tPages('job_manager.viz_loading_config')}</span>
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
                  <span>{tPages('job_manager.viz_no_config')}</span>
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
