import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Settings,
  Gauge,
  Target,
  CheckCircle,
  XCircle,
  Loader2,
  RotateCcw,
  Square,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Terminal,
} from 'lucide-react'
import { Tabs, TabPanel } from '../common/Tabs'
import type { DeviceCapabilities } from '../../types/device'

interface ProbeResult {
  command: string
  description: string
  response: string
  recognized: boolean
  duration_ms: number
}

interface ProbeReport {
  timestamp: string
  port: string
  firmware_type: string
  recognized_commands: ProbeResult[]
  unrecognized_commands: ProbeResult[]
  all_results: ProbeResult[]
  summary: {
    total_commands: number
    recognized: number
    unrecognized: number
    firmware_type: string
    configurable_params: Record<string, unknown>
  }
}

interface AxisRange {
  axis: string
  axis_name: string
  positive_limit: number | null
  negative_limit: number | null
  total_range: number | null
  positive_endstop_hit: boolean
  negative_endstop_hit: boolean
  positive_max_reached: boolean
  negative_max_reached: boolean
  error: string | null
  steps_positive: number
  steps_negative: number
}

interface EndstopReport {
  timestamp: string
  port: string
  step_size: number
  speed: number
  max_search_angle: number
  axes: AxisRange[]
  completed: boolean
  error: string | null
  duration_seconds: number
}

interface SpeedResult {
  speed: number
  axis: string
  angle: number
  move_time_ms: number
  return_time_ms: number
  avg_time_ms: number
  response_ok: boolean
}

interface MotionReport {
  timestamp: string
  port: string
  test_angle: number
  speeds_tested: number[]
  results: SpeedResult[]
  recommended_speed: number | null
  speed_summary: Record<string, {
    avg_time_ms: number
    min_time_ms: number
    max_time_ms: number
    all_ok: boolean
    tests: number
  }>
  completed: boolean
  error: string | null
  duration_seconds: number
}

interface LogEntry {
  t: number
  type: string
  msg: string
  gcode?: string
  response?: string
  axis?: string
  pct?: number
  ms?: number
  ok?: boolean
  recognized?: boolean
}

function TestProgressLog({ deviceId, running }: { deviceId: string; running: boolean }) {
  const { t } = useTranslation('devices')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [lastTotal, setLastTotal] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleScroll = () => {
    if (!logRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logRef.current
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40
  }

  useEffect(() => {
    if (autoScrollRef.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [entries])

  useEffect(() => {
    if (!running && lastTotal === 0) return

    const poll = async () => {
      try {
        const resp = await fetch(`/api/devices/${deviceId}/test-progress?after=${lastTotal}`)
        if (!resp.ok) return
        const data = await resp.json()
        if (data.entries && data.entries.length > 0) {
          setEntries(prev => [...prev, ...data.entries])
          setLastTotal(data.total)
        }
      } catch {
        // ignore
      }
    }

    if (running && entries.length === 0) {
      setLastTotal(0)
    }

    pollRef.current = setInterval(poll, 500)
    poll()

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, deviceId, lastTotal])

  useEffect(() => {
    if (running) {
      setEntries([])
      setLastTotal(0)
      autoScrollRef.current = true
    }
  }, [running])

  const getEntryIcon = (type: string) => {
    switch (type) {
      case 'cmd': return <span className="text-amber-400 font-mono text-[10px]">{'>'}</span>
      case 'info': return <span className="text-blue-400 text-[10px]">i</span>
      case 'result': return <CheckCircle className="w-3 h-3 text-green-400" />
      case 'warn': return <AlertTriangle className="w-3 h-3 text-amber-400" />
      case 'error': return <XCircle className="w-3 h-3 text-red-400" />
      case 'progress': return <span className="text-steel-500 text-[10px]">...</span>
      default: return null
    }
  }

  const getEntryClass = (type: string) => {
    switch (type) {
      case 'cmd': return 'text-steel-300'
      case 'info': return 'text-blue-300'
      case 'result': return 'text-green-300'
      case 'warn': return 'text-amber-300'
      case 'error': return 'text-red-400'
      case 'progress': return 'text-steel-500'
      default: return 'text-steel-400'
    }
  }

  const latestPct = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].pct !== undefined) return entries[i].pct
    }
    return 0
  })()

  if (entries.length === 0 && !running) return null

  return (
    <div className="mt-3 border border-steel-700 rounded-lg overflow-hidden">
      <div className="bg-steel-800/80 px-3 py-1.5 flex items-center justify-between border-b border-steel-700">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-steel-400" />
          <span className="text-xs text-steel-400 font-medium">{t('motor_tuning.test_log_title')}</span>
          <span className="text-xs text-steel-500">{t('motor_tuning.test_log_entries', { count: entries.length })}</span>
        </div>
        {running && latestPct !== undefined && latestPct > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 bg-steel-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-machine-500 transition-all duration-300"
                style={{ width: `${Math.min(100, latestPct)}%` }}
              />
            </div>
            <span className="text-xs text-steel-400 font-mono">{latestPct}%</span>
          </div>
        )}
      </div>

      <div
        ref={logRef}
        onScroll={handleScroll}
        className="max-h-[280px] overflow-y-auto bg-steel-900/50 font-mono text-xs p-2 space-y-0.5"
      >
        {entries.map((entry, i) => (
          <div key={i} className="flex items-start gap-1.5 py-0.5 leading-relaxed">
            <span className="text-steel-600 w-12 flex-shrink-0 text-right tabular-nums">
              {entry.t.toFixed(1)}s
            </span>
            <span className="w-3.5 flex-shrink-0 flex items-center justify-center mt-px">
              {getEntryIcon(entry.type)}
            </span>
            <div className="min-w-0 flex-1">
              {entry.type === 'cmd' ? (
                <div>
                  <span className="text-amber-300">{entry.gcode || entry.msg}</span>
                  {entry.response && (
                    <span className="text-steel-500 ml-2">
                      → {entry.response.replace(/\n/g, ' | ').substring(0, 80)}
                    </span>
                  )}
                  {entry.ms !== undefined && (
                    <span className="text-steel-600 ml-1">({entry.ms}ms)</span>
                  )}
                </div>
              ) : (
                <span className={getEntryClass(entry.type)}>
                  {entry.msg}
                  {entry.type === 'result' && entry.ms !== undefined && (
                    <span className="text-steel-500 ml-1">({entry.ms}ms)</span>
                  )}
                </span>
              )}
            </div>
          </div>
        ))}

        {running && (
          <div className="flex items-center gap-2 py-1 text-steel-500">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{t('motor_tuning.test_running')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

interface MotorTuningPanelProps {
  deviceId: string
  capabilities?: DeviceCapabilities
  embedded?: boolean
}

export default function MotorTuningPanel({ 
  deviceId, 
  capabilities,
  embedded = false 
}: MotorTuningPanelProps) {
  const { t } = useTranslation('devices')
  const hasEndstops = capabilities?.has_endstops !== false

  const [activeTab, setActiveTab] = useState<'firmware' | 'motion' | 'endstop'>('firmware')
  
  const [probeRunning, setProbeRunning] = useState(false)
  const [probeReport, setProbeReport] = useState<ProbeReport | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [showAllCommands, setShowAllCommands] = useState(false)

  const [motionRunning, setMotionRunning] = useState(false)
  const [motionReport, setMotionReport] = useState<MotionReport | null>(null)
  const [motionError, setMotionError] = useState<string | null>(null)
  const [testAngle, setTestAngle] = useState(30)

  const [endstopRunning, setEndstopRunning] = useState(false)
  const [endstopReport, setEndstopReport] = useState<EndstopReport | null>(null)
  const [endstopError, setEndstopError] = useState<string | null>(null)
  const [stepSize, setStepSize] = useState(5)
  const [searchSpeed, setSearchSpeed] = useState(15)

  const cancelTest = async () => {
    try {
      await fetch(`/api/devices/${deviceId}/cancel-test`, { method: 'POST' })
    } catch {
      // ignore errors
    }
  }

  const runFirmwareProbe = async () => {
    setProbeRunning(true)
    setProbeError(null)
    setProbeReport(null)
    try {
      const resp = await fetch(`/api/devices/${deviceId}/firmware-probe`, { method: 'POST' })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      setProbeReport(await resp.json())
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : String(e))
    } finally {
      setProbeRunning(false)
    }
  }

  const runMotionTest = async () => {
    setMotionRunning(true)
    setMotionError(null)
    setMotionReport(null)
    try {
      const resp = await fetch(`/api/devices/${deviceId}/motion-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_angle: testAngle }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      setMotionReport(await resp.json())
    } catch (e) {
      setMotionError(e instanceof Error ? e.message : String(e))
    } finally {
      setMotionRunning(false)
    }
  }

  const runEndstopTest = async () => {
    setEndstopRunning(true)
    setEndstopError(null)
    setEndstopReport(null)
    try {
      const resp = await fetch(`/api/devices/${deviceId}/endstop-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_size: stepSize, speed: searchSpeed, max_angle: 200 }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      setEndstopReport(await resp.json())
    } catch (e) {
      setEndstopError(e instanceof Error ? e.message : String(e))
    } finally {
      setEndstopRunning(false)
    }
  }

  const isAnyRunning = probeRunning || motionRunning || endstopRunning

  const tabs = useMemo(
    () => [
      { id: 'firmware' as const, label: t('motor_tuning.tab_firmware'), icon: Settings },
      { id: 'motion' as const, label: t('motor_tuning.tab_motion'), icon: Gauge },
      ...(hasEndstops ? [{ id: 'endstop' as const, label: t('motor_tuning.tab_endstop'), icon: Target }] : []),
    ],
    [t, hasEndstops],
  )

  const content = (
    <>
      <Tabs 
        tabs={tabs} 
        activeTab={activeTab} 
        onTabChange={(id) => setActiveTab(id as typeof activeTab)} 
      />

      <div className={embedded ? 'pt-4' : 'card-body'}>
        {/* FIRMWARE TAB */}
        <TabPanel isActive={activeTab === 'firmware'}>
          <div className="space-y-4">
            <p className="text-sm text-steel-400">{t('motor_tuning.firmware_intro')}</p>

            {!probeReport && !probeRunning && (
              <button
                onClick={runFirmwareProbe}
                disabled={isAnyRunning}
                className="btn btn-primary flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                {t('motor_tuning.start_firmware_probe')}
              </button>
            )}

            {probeRunning && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-machine-400 animate-spin" />
                    <span className="text-steel-300 text-sm">{t('motor_tuning.firmware_probe_running')}</span>
                  </div>
                  <button
                    onClick={cancelTest}
                    className="btn btn-danger text-sm flex items-center gap-2"
                  >
                    <Square className="w-3.5 h-3.5" />
                    {t('motor_tuning.stop')}
                  </button>
                </div>
                <TestProgressLog deviceId={deviceId} running={probeRunning} />
              </div>
            )}

            {probeError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
                <p className="text-sm text-red-400">{t('motor_tuning.error_prefix')} {probeError}</p>
                <button onClick={runFirmwareProbe} className="btn btn-secondary text-sm mt-2">
                  {t('motor_tuning.retry')}
                </button>
              </div>
            )}

            {probeReport && (
              <div className="space-y-3">
                <div className="bg-steel-800/50 rounded-lg p-3 border border-steel-700">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-steel-400 text-xs">{t('motor_tuning.firmware_type')}</div>
                      <div className="text-steel-100 font-mono">{probeReport.summary.firmware_type}</div>
                    </div>
                    <div>
                      <div className="text-steel-400 text-xs">{t('motor_tuning.recognized_commands')}</div>
                      <div className="text-green-400">{probeReport.summary.recognized} / {probeReport.summary.total_commands}</div>
                    </div>
                    <div>
                      <div className="text-steel-400 text-xs">{t('motor_tuning.configurable_params_short')}</div>
                      <div className="text-steel-100">{Object.keys(probeReport.summary.configurable_params).length}</div>
                    </div>
                  </div>
                </div>

                {Object.keys(probeReport.summary.configurable_params).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-steel-200 mb-2">{t('motor_tuning.configurable_params_heading')}</h4>
                    <div className="bg-steel-800/50 rounded-lg p-3 border border-steel-700 font-mono text-xs space-y-1 max-h-40 overflow-y-auto">
                      {Object.entries(probeReport.summary.configurable_params).map(([key, val]) => (
                        <div key={key} className="flex justify-between">
                          <span className="text-amber-300">{key}</span>
                          <span className="text-steel-300">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <button
                    onClick={() => setShowAllCommands(!showAllCommands)}
                    className="flex items-center gap-1 text-sm text-steel-300 hover:text-steel-100"
                  >
                    {showAllCommands ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    {t('motor_tuning.recognized_commands_expand', { count: probeReport.recognized_commands.length })}
                  </button>

                  {showAllCommands && (
                    <div className="mt-2 space-y-1 max-h-[300px] overflow-y-auto">
                      {probeReport.recognized_commands.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 py-1 px-2 rounded hover:bg-steel-800/50 text-xs">
                          <CheckCircle className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
                          <span className="text-amber-300 font-mono w-24 flex-shrink-0">{r.command}</span>
                          <span className="text-steel-400 truncate">{r.response.substring(0, 80) || r.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button onClick={runFirmwareProbe} className="btn btn-secondary text-sm flex items-center gap-2">
                  <RotateCcw className="w-3 h-3" />
                  {t('motor_tuning.rerun')}
                </button>
              </div>
            )}
          </div>
        </TabPanel>

        {/* MOTION TAB */}
        <TabPanel isActive={activeTab === 'motion'}>
          <div className="space-y-4">
            <p className="text-sm text-steel-400">{t('motor_tuning.motion_intro')}</p>

            {!motionReport && !motionRunning && (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <label className="text-sm text-steel-300">{t('motor_tuning.test_angle')}</label>
                  <input
                    type="range"
                    min="10"
                    max="60"
                    step="5"
                    value={testAngle}
                    onChange={(e) => setTestAngle(Number(e.target.value))}
                    className="w-32 h-2 bg-steel-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-sm text-steel-300 font-mono w-12">{testAngle}°</span>
                </div>
                <button
                  onClick={runMotionTest}
                  disabled={isAnyRunning}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <Gauge className="w-4 h-4" />
                  {t('motor_tuning.start_speed_test')}
                </button>
              </div>
            )}

            {motionRunning && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-machine-400 animate-spin" />
                    <span className="text-steel-300 text-sm">{t('motor_tuning.motion_test_running')}</span>
                  </div>
                  <button
                    onClick={cancelTest}
                    className="btn btn-danger text-sm flex items-center gap-2"
                  >
                    <Square className="w-3.5 h-3.5" />
                    {t('motor_tuning.stop')}
                  </button>
                </div>
                <TestProgressLog deviceId={deviceId} running={motionRunning} />
              </div>
            )}

            {motionError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
                <p className="text-sm text-red-400">{t('motor_tuning.error_prefix')} {motionError}</p>
                <button onClick={runMotionTest} className="btn btn-secondary text-sm mt-2">{t('motor_tuning.retry')}</button>
              </div>
            )}

            {motionReport && (
              <div className="space-y-3">
                {motionReport.recommended_speed && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <div>
                      <div className="text-green-300 font-medium">{t('motor_tuning.recommended_feed', { speed: motionReport.recommended_speed })}</div>
                      <div className="text-xs text-steel-400">
                        {t('motor_tuning.duration_seconds', { seconds: motionReport.duration_seconds.toFixed(1) })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="overflow-hidden rounded-lg border border-steel-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-steel-800">
                        <th className="text-left px-3 py-2 text-steel-400">{t('motor_tuning.col_speed')}</th>
                        <th className="text-left px-3 py-2 text-steel-400">{t('motor_tuning.col_avg_time')}</th>
                        <th className="text-left px-3 py-2 text-steel-400">{t('motor_tuning.col_min')}</th>
                        <th className="text-left px-3 py-2 text-steel-400">{t('motor_tuning.col_max')}</th>
                        <th className="text-left px-3 py-2 text-steel-400">{t('motor_tuning.col_status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-steel-700">
                      {Object.entries(motionReport.speed_summary).map(([speed, summary]) => (
                        <tr
                          key={speed}
                          className={Number(speed) === motionReport.recommended_speed
                            ? 'bg-green-500/5'
                            : 'hover:bg-steel-800/50'
                          }
                        >
                          <td className="px-3 py-2 font-mono">
                            F{speed}
                            {Number(speed) === motionReport.recommended_speed && (
                              <span className="ml-2 text-xs text-green-400">{t('motor_tuning.recommended_chip')}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono">{summary.avg_time_ms.toFixed(0)} ms</td>
                          <td className="px-3 py-2 font-mono text-steel-400">{summary.min_time_ms.toFixed(0)} ms</td>
                          <td className="px-3 py-2 font-mono text-steel-400">{summary.max_time_ms.toFixed(0)} ms</td>
                          <td className="px-3 py-2">
                            {summary.all_ok
                              ? <CheckCircle className="w-4 h-4 text-green-400" />
                              : <XCircle className="w-4 h-4 text-red-400" />
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button onClick={runMotionTest} className="btn btn-secondary text-sm flex items-center gap-2">
                  <RotateCcw className="w-3 h-3" />
                  {t('motor_tuning.rerun')}
                </button>
              </div>
            )}
          </div>
        </TabPanel>

        {/* ENDSTOP TAB */}
        {hasEndstops && (
          <TabPanel isActive={activeTab === 'endstop'}>
            <div className="space-y-4">
              <p className="text-sm text-steel-400">{t('motor_tuning.endstop_intro')}</p>

              <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-300">
                    <strong>{t('motor_tuning.warning_title')}</strong> {t('motor_tuning.warning_body')}
                  </p>
                </div>
              </div>

              {!endstopReport && !endstopRunning && (
                <div className="space-y-3">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-steel-300">{t('motor_tuning.step_size')}</label>
                      <select
                        value={stepSize}
                        onChange={(e) => setStepSize(Number(e.target.value))}
                        className="bg-steel-800 text-steel-200 text-sm rounded px-2 py-1 border border-steel-600"
                      >
                        <option value={2}>2°</option>
                        <option value={5}>5°</option>
                        <option value={10}>10°</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-steel-300">{t('motor_tuning.speed')}</label>
                      <select
                        value={searchSpeed}
                        onChange={(e) => setSearchSpeed(Number(e.target.value))}
                        className="bg-steel-800 text-steel-200 text-sm rounded px-2 py-1 border border-steel-600"
                      >
                        <option value={10}>{t('motor_tuning.speed_f10')}</option>
                        <option value={15}>{t('motor_tuning.speed_f15')}</option>
                        <option value={20}>{t('motor_tuning.speed_f20')}</option>
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={runEndstopTest}
                    disabled={isAnyRunning}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    <Target className="w-4 h-4" />
                    {t('motor_tuning.start_endstop_test')}
                  </button>
                </div>
              )}

              {endstopRunning && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 text-machine-400 animate-spin" />
                      <span className="text-steel-300 text-sm">{t('motor_tuning.endstop_test_running')}</span>
                    </div>
                    <button
                      onClick={cancelTest}
                      className="btn btn-danger text-sm flex items-center gap-2"
                    >
                      <Square className="w-3.5 h-3.5" />
                      {t('motor_tuning.stop')}
                    </button>
                  </div>
                  <TestProgressLog deviceId={deviceId} running={endstopRunning} />
                </div>
              )}

              {endstopError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
                  <p className="text-sm text-red-400">{t('motor_tuning.error_prefix')} {endstopError}</p>
                  <button onClick={runEndstopTest} className="btn btn-secondary text-sm mt-2">{t('motor_tuning.retry')}</button>
                </div>
              )}

              {endstopReport && (
                <div className="space-y-3">
                  {endstopReport.completed ? (
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <span className="text-green-300 font-medium">
                        {t('motor_tuning.endstop_done', { seconds: endstopReport.duration_seconds.toFixed(1) })}
                      </span>
                    </div>
                  ) : (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <p className="text-sm text-red-400">{t('motor_tuning.test_not_finished')} {endstopReport.error}</p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {endstopReport.axes.map((ax) => (
                      <div key={ax.axis} className="bg-steel-800/50 rounded-lg p-4 border border-steel-700">
                        <h4 className="font-medium text-steel-200 mb-2">
                          {t('motor_tuning.axis_heading', { id: ax.axis, name: ax.axis_name })}
                        </h4>

                        <div className="relative h-8 bg-steel-900 rounded-full overflow-hidden mb-3">
                          {ax.negative_limit !== null && ax.positive_limit !== null && (
                            <>
                              <div
                                className="absolute h-full bg-gradient-to-r from-blue-500/40 to-machine-500/40 rounded-full"
                                style={{
                                  left: `${Math.max(0, 50 + (ax.negative_limit / 400) * 100)}%`,
                                  width: `${Math.min(100, ((ax.positive_limit - ax.negative_limit) / 400) * 100)}%`,
                                }}
                              />
                              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-steel-500" />
                              <div className="absolute inset-0 flex items-center justify-between px-3 text-xs font-mono">
                                <span className={ax.negative_endstop_hit ? 'text-green-400' : 'text-amber-400'}>
                                  {ax.negative_limit?.toFixed(0)}°
                                </span>
                                <span className="text-steel-400">0°</span>
                                <span className={ax.positive_endstop_hit ? 'text-green-400' : 'text-amber-400'}>
                                  +{ax.positive_limit?.toFixed(0)}°
                                </span>
                              </div>
                            </>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <span className="text-steel-400 text-xs">{t('motor_tuning.neg_limit')}</span>
                            <div className="font-mono">
                              {ax.negative_limit !== null ? `${ax.negative_limit.toFixed(1)}°` : 'N/A'}
                              {ax.negative_endstop_hit && <span className="text-green-400 text-xs ml-1">{t('motor_tuning.tag_endstop')}</span>}
                              {ax.negative_max_reached && <span className="text-amber-400 text-xs ml-1">{t('motor_tuning.tag_max_limit')}</span>}
                            </div>
                          </div>
                          <div>
                            <span className="text-steel-400 text-xs">{t('motor_tuning.pos_limit')}</span>
                            <div className="font-mono">
                              {ax.positive_limit !== null ? `+${ax.positive_limit.toFixed(1)}°` : 'N/A'}
                              {ax.positive_endstop_hit && <span className="text-green-400 text-xs ml-1">{t('motor_tuning.tag_endstop')}</span>}
                              {ax.positive_max_reached && <span className="text-amber-400 text-xs ml-1">{t('motor_tuning.tag_max_limit')}</span>}
                            </div>
                          </div>
                          <div>
                            <span className="text-steel-400 text-xs">{t('motor_tuning.total_range')}</span>
                            <div className="font-mono font-bold text-machine-400">
                              {ax.total_range !== null ? `${ax.total_range.toFixed(1)}°` : 'N/A'}
                            </div>
                          </div>
                        </div>

                        {ax.error && (
                          <div className="mt-2 text-xs text-red-400">{t('motor_tuning.axis_error')} {ax.error}</div>
                        )}
                      </div>
                    ))}
                  </div>

                  <button onClick={runEndstopTest} className="btn btn-secondary text-sm flex items-center gap-2">
                    <RotateCcw className="w-3 h-3" />
                    {t('motor_tuning.rerun')}
                  </button>
                </div>
              )}
            </div>
          </TabPanel>
        )}
      </div>
    </>
  )

  if (embedded) {
    return content
  }

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Gauge className="w-4 h-4 text-amber-400" />
        <span className="font-medium">{t('motor_tuning.panel_title')}</span>
      </div>
      {content}
    </div>
  )
}
