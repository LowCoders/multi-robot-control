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
  Activity,
  CheckCircle,
  XCircle,
  SkipForward,
  Loader2,
  X,
  Gauge,
  Zap,
  Target,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Terminal,
} from 'lucide-react'
import { useDeviceStore } from '../stores/deviceStore'
import PositionDisplay from '../components/devices/PositionDisplay'
import JogControl from '../components/devices/JogControl'
import StatusBadge from '../components/common/StatusBadge'
import MdiConsole from '../components/devices/MdiConsole'
import { VisualizationPanel, GcodePanel } from '../components/visualization'
import { useMachineConfig } from '../hooks/useMachineConfig'

// Diagnosztika típusok
interface DiagTestResult {
  name: string
  passed: boolean
  message: string
  details: Record<string, unknown>
  duration_ms: number
  skipped: boolean
}

interface DiagReport {
  timestamp: string
  port: string
  firmware_info: string
  tests: DiagTestResult[]
  total_tests: number
  passed_tests: number
  failed_tests: number
  skipped_tests: number
  overall_passed: boolean
}

// =========================================
// Motor Hangolás típusok
// =========================================

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

// =========================================
// Teszt Progress Log entry
// =========================================

interface LogEntry {
  t: number
  type: string  // info | cmd | result | progress | warn | error
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
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [lastTotal, setLastTotal] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-scroll detection
  const handleScroll = () => {
    if (!logRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logRef.current
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40
  }

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScrollRef.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [entries])

  // Polling
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
        // Stop polling if test ended
        if (!data.running && data.total === lastTotal) {
          // One final check
        }
      } catch {
        // ignore
      }
    }

    // Reset on new test start
    if (running && entries.length === 0) {
      setLastTotal(0)
    }

    pollRef.current = setInterval(poll, 500)
    poll() // immediate first call

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, deviceId, lastTotal])

  // Reset when a new test starts
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

  // Find latest pct
  const latestPct = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].pct !== undefined) return entries[i].pct
    }
    return 0
  })()

  if (entries.length === 0 && !running) return null

  return (
    <div className="mt-3 border border-steel-700 rounded-lg overflow-hidden">
      {/* Header with progress bar */}
      <div className="bg-steel-800/80 px-3 py-1.5 flex items-center justify-between border-b border-steel-700">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-steel-400" />
          <span className="text-xs text-steel-400 font-medium">Teszt folyamat</span>
          <span className="text-xs text-steel-500">{entries.length} bejegyzés</span>
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

      {/* Log entries */}
      <div
        ref={logRef}
        onScroll={handleScroll}
        className="max-h-[280px] overflow-y-auto bg-steel-900/50 font-mono text-xs p-2 space-y-0.5"
      >
        {entries.map((entry, i) => (
          <div key={i} className="flex items-start gap-1.5 py-0.5 leading-relaxed">
            {/* Timestamp */}
            <span className="text-steel-600 w-12 flex-shrink-0 text-right tabular-nums">
              {entry.t.toFixed(1)}s
            </span>

            {/* Icon */}
            <span className="w-3.5 flex-shrink-0 flex items-center justify-center mt-px">
              {getEntryIcon(entry.type)}
            </span>

            {/* Content */}
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
            <span>Folyamatban...</span>
          </div>
        )}
      </div>
    </div>
  )
}

// =========================================
// Motor Tuning Panel
// =========================================

function MotorTuningPanel({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  // Tabs
  const [activeTab, setActiveTab] = useState<'microstepping' | 'firmware' | 'motion' | 'endstop'>('microstepping')
  
  // Firmware probe
  const [probeRunning, setProbeRunning] = useState(false)
  const [probeReport, setProbeReport] = useState<ProbeReport | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [showAllCommands, setShowAllCommands] = useState(false)

  // Motion test
  const [motionRunning, setMotionRunning] = useState(false)
  const [motionReport, setMotionReport] = useState<MotionReport | null>(null)
  const [motionError, setMotionError] = useState<string | null>(null)
  const [testAngle, setTestAngle] = useState(30)

  // Endstop test
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

  const tabs = [
    { id: 'microstepping' as const, label: 'Microstepping', icon: Zap },
    { id: 'firmware' as const, label: 'Firmware', icon: Settings },
    { id: 'motion' as const, label: 'Sebesség', icon: Gauge },
    { id: 'endstop' as const, label: 'Végállás', icon: Target },
  ]

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-amber-400" />
          <span className="font-medium">Motor Hangolás</span>
        </div>
        <button onClick={onClose} className="btn-icon hover:bg-steel-700">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="border-b border-steel-700 flex">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-machine-500 text-machine-400'
                : 'border-transparent text-steel-400 hover:text-steel-200'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="card-body">
        {/* ===================== MICROSTEPPING TAB ===================== */}
        {activeTab === 'microstepping' && (
          <div className="space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-amber-300">Microstepping beallitas (hardver)</h4>
                  <p className="text-sm text-steel-300 mt-1">
                    A CNC Shield V3 microstepping jumperei a stepper driver modulok <strong>alatt</strong> talalhatoak.
                    A jumperek MS1, MS2, MS3 jelolesuek. A beallitastol fugg a motor zajszintje es a mozgas simasaga.
                  </p>
                </div>
              </div>
            </div>

            <h4 className="font-medium text-steel-200">A4988 Driver konfiguracio</h4>
            <div className="overflow-hidden rounded-lg border border-steel-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-steel-800">
                    <th className="text-left px-3 py-2 text-steel-400">MS1</th>
                    <th className="text-left px-3 py-2 text-steel-400">MS2</th>
                    <th className="text-left px-3 py-2 text-steel-400">MS3</th>
                    <th className="text-left px-3 py-2 text-steel-400">Lepes mod</th>
                    <th className="text-left px-3 py-2 text-steel-400">Minoseg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-steel-700">
                  <tr className="hover:bg-steel-800/50">
                    <td className="px-3 py-2 text-red-400">-</td>
                    <td className="px-3 py-2 text-red-400">-</td>
                    <td className="px-3 py-2 text-red-400">-</td>
                    <td className="px-3 py-2 text-steel-200">Full step (1/1)</td>
                    <td className="px-3 py-2 text-red-400">Zajos, rangatos</td>
                  </tr>
                  <tr className="hover:bg-steel-800/50">
                    <td className="px-3 py-2 text-amber-400">ON</td>
                    <td className="px-3 py-2 text-red-400">-</td>
                    <td className="px-3 py-2 text-red-400">-</td>
                    <td className="px-3 py-2 text-steel-200">Half step (1/2)</td>
                    <td className="px-3 py-2 text-amber-400">Kozepesen zajos</td>
                  </tr>
                  <tr className="hover:bg-steel-800/50">
                    <td className="px-3 py-2 text-amber-400">ON</td>
                    <td className="px-3 py-2 text-amber-400">ON</td>
                    <td className="px-3 py-2 text-red-400">-</td>
                    <td className="px-3 py-2 text-steel-200">Quarter step (1/4)</td>
                    <td className="px-3 py-2 text-amber-400">Elfogadhato</td>
                  </tr>
                  <tr className="hover:bg-steel-800/50">
                    <td className="px-3 py-2 text-amber-400">ON</td>
                    <td className="px-3 py-2 text-amber-400">ON</td>
                    <td className="px-3 py-2 text-red-400">-</td>
                    <td className="px-3 py-2 text-steel-200">Eighth step (1/8)</td>
                    <td className="px-3 py-2 text-green-400">Jo</td>
                  </tr>
                  <tr className="bg-green-500/5 hover:bg-green-500/10">
                    <td className="px-3 py-2 text-green-400 font-bold">ON</td>
                    <td className="px-3 py-2 text-green-400 font-bold">ON</td>
                    <td className="px-3 py-2 text-green-400 font-bold">ON</td>
                    <td className="px-3 py-2 text-green-300 font-bold">Sixteenth step (1/16)</td>
                    <td className="px-3 py-2 text-green-400 font-bold">Legjobb - AJANLOTT</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h4 className="font-medium text-steel-200 mt-4">DRV8825 Driver konfiguracio</h4>
            <div className="overflow-hidden rounded-lg border border-steel-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-steel-800">
                    <th className="text-left px-3 py-2 text-steel-400">MS1</th>
                    <th className="text-left px-3 py-2 text-steel-400">MS2</th>
                    <th className="text-left px-3 py-2 text-steel-400">MS3</th>
                    <th className="text-left px-3 py-2 text-steel-400">Lepes mod</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-steel-700">
                  <tr className="bg-green-500/5 hover:bg-green-500/10">
                    <td className="px-3 py-2 text-green-400 font-bold">ON</td>
                    <td className="px-3 py-2 text-green-400 font-bold">ON</td>
                    <td className="px-3 py-2 text-green-400 font-bold">ON</td>
                    <td className="px-3 py-2 text-green-300 font-bold">1/32 step - AJANLOTT</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mt-4">
              <p className="text-sm text-blue-300">
                <strong>Teendo:</strong> Huzd ki a stepper driver modulokat a CNC Shield-bol, 
                rakj jumpereket mindharom MS1/MS2/MS3 pin-pare <strong>minden tengelyre</strong> (X, Y, Z),
                majd helyezd vissza a drivereket. Ez jelentosen csokkenti a zajt es javitja a mozgasminosget.
              </p>
            </div>

            <div className="bg-steel-800/50 border border-steel-700 rounded-lg p-3 mt-2">
              <h5 className="text-sm font-medium text-steel-200 mb-2">VREF (aramlimit) beallitas</h5>
              <p className="text-xs text-steel-400">
                A stepper driver-ek tetejen levo potenciometerrel allithatod az aramerosseg-hatart.
                Multimeterrel merd meg a VREF feszultseget a potenciometer es GND kozott.
                A4988 eseten: <span className="text-amber-300">VREF = Imax x 8 x Rsense</span>.
                Tipikus ertek: 0.5V-0.8V kozott.
                Ne allitsd tul magasra, mert tumelgedhet a driver!
              </p>
            </div>
          </div>
        )}

        {/* ===================== FIRMWARE TAB ===================== */}
        {activeTab === 'firmware' && (
          <div className="space-y-4">
            <p className="text-sm text-steel-400">
              Firmware parameter felderites: kulonbozo GRBL, Marlin es egyedi parancsokat probalkozik,
              hogy kideruljun milyen beallitasok leteznek a firmware-ben.
            </p>

            {!probeReport && !probeRunning && (
              <button
                onClick={runFirmwareProbe}
                disabled={isAnyRunning}
                className="btn btn-primary flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Firmware felderites inditasa
              </button>
            )}

            {probeRunning && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-machine-400 animate-spin" />
                    <span className="text-steel-300 text-sm">Firmware felderítés folyamatban...</span>
                  </div>
                  <button
                    onClick={cancelTest}
                    className="btn btn-danger text-sm flex items-center gap-2"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Leállítás
                  </button>
                </div>
                <TestProgressLog deviceId={deviceId} running={probeRunning} />
              </div>
            )}

            {probeError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
                <p className="text-sm text-red-400">Hiba: {probeError}</p>
                <button onClick={runFirmwareProbe} className="btn btn-secondary text-sm mt-2">
                  Ujra
                </button>
              </div>
            )}

            {probeReport && (
              <div className="space-y-3">
                <div className="bg-steel-800/50 rounded-lg p-3 border border-steel-700">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-steel-400 text-xs">Firmware tipus</div>
                      <div className="text-steel-100 font-mono">{probeReport.summary.firmware_type}</div>
                    </div>
                    <div>
                      <div className="text-steel-400 text-xs">Felismert parancsok</div>
                      <div className="text-green-400">{probeReport.summary.recognized} / {probeReport.summary.total_commands}</div>
                    </div>
                    <div>
                      <div className="text-steel-400 text-xs">Konfiguralhato param.</div>
                      <div className="text-steel-100">{Object.keys(probeReport.summary.configurable_params).length}</div>
                    </div>
                  </div>
                </div>

                {/* Configurable params */}
                {Object.keys(probeReport.summary.configurable_params).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-steel-200 mb-2">Konfiguralhato parameterek</h4>
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

                {/* Recognized commands */}
                <div>
                  <button
                    onClick={() => setShowAllCommands(!showAllCommands)}
                    className="flex items-center gap-1 text-sm text-steel-300 hover:text-steel-100"
                  >
                    {showAllCommands ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    Felismert parancsok ({probeReport.recognized_commands.length})
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
                  Ujrafuttatas
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===================== MOTION TAB ===================== */}
        {activeTab === 'motion' && (
          <div className="space-y-4">
            <p className="text-sm text-steel-400">
              Kulonbozo sebessegekkel (F5-F100) teszteli a mozgas minosegjet. Meri az ido-igenyjet es megallpitja az optimalis F erteket.
            </p>

            {!motionReport && !motionRunning && (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <label className="text-sm text-steel-300">Teszt szog:</label>
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
                  Sebessegteszt inditasa
                </button>
              </div>
            )}

            {motionRunning && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-machine-400 animate-spin" />
                    <span className="text-steel-300 text-sm">Mozgásteszt folyamatban...</span>
                  </div>
                  <button
                    onClick={cancelTest}
                    className="btn btn-danger text-sm flex items-center gap-2"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Leállítás
                  </button>
                </div>
                <TestProgressLog deviceId={deviceId} running={motionRunning} />
              </div>
            )}

            {motionError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
                <p className="text-sm text-red-400">Hiba: {motionError}</p>
                <button onClick={runMotionTest} className="btn btn-secondary text-sm mt-2">Ujra</button>
              </div>
            )}

            {motionReport && (
              <div className="space-y-3">
                {/* Recommended speed */}
                {motionReport.recommended_speed && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <div>
                      <div className="text-green-300 font-medium">Ajanlott sebesseg: F{motionReport.recommended_speed}</div>
                      <div className="text-xs text-steel-400">
                        Idotartam: {motionReport.duration_seconds.toFixed(1)} mp
                      </div>
                    </div>
                  </div>
                )}

                {/* Speed summary table */}
                <div className="overflow-hidden rounded-lg border border-steel-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-steel-800">
                        <th className="text-left px-3 py-2 text-steel-400">Sebesseg</th>
                        <th className="text-left px-3 py-2 text-steel-400">Atlag ido</th>
                        <th className="text-left px-3 py-2 text-steel-400">Min</th>
                        <th className="text-left px-3 py-2 text-steel-400">Max</th>
                        <th className="text-left px-3 py-2 text-steel-400">Status</th>
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
                              <span className="ml-2 text-xs text-green-400">AJANLOTT</span>
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
                  Ujrafuttatas
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===================== ENDSTOP TAB ===================== */}
        {activeTab === 'endstop' && (
          <div className="space-y-4">
            <p className="text-sm text-steel-400">
              Vegigmozgatja az osszes kart a vegallasokig mindket iranyba, es megmeri a teljes mozgastartomanyt fokokban.
            </p>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-300">
                  <strong>Figyelem:</strong> Ez a teszt fizikailag vegig mozgatja a robotkart!
                  Gyozodj meg rola, hogy a munkaterulet szabad es a robotkar nem utkozhet semmibe.
                </p>
              </div>
            </div>

            {!endstopReport && !endstopRunning && (
              <div className="space-y-3">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-steel-300">Lepesmeret:</label>
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
                    <label className="text-sm text-steel-300">Sebesseg:</label>
                    <select
                      value={searchSpeed}
                      onChange={(e) => setSearchSpeed(Number(e.target.value))}
                      className="bg-steel-800 text-steel-200 text-sm rounded px-2 py-1 border border-steel-600"
                    >
                      <option value={10}>F10 (lassab)</option>
                      <option value={15}>F15 (alap)</option>
                      <option value={20}>F20 (gyorsabb)</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={runEndstopTest}
                  disabled={isAnyRunning}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <Target className="w-4 h-4" />
                  Vegallas teszt inditasa
                </button>
              </div>
            )}

            {endstopRunning && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-machine-400 animate-spin" />
                    <span className="text-steel-300 text-sm">Végállás teszt folyamatban...</span>
                  </div>
                  <button
                    onClick={cancelTest}
                    className="btn btn-danger text-sm flex items-center gap-2"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Leállítás
                  </button>
                </div>
                <TestProgressLog deviceId={deviceId} running={endstopRunning} />
              </div>
            )}

            {endstopError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
                <p className="text-sm text-red-400">Hiba: {endstopError}</p>
                <button onClick={runEndstopTest} className="btn btn-secondary text-sm mt-2">Ujra</button>
              </div>
            )}

            {endstopReport && (
              <div className="space-y-3">
                {endstopReport.completed ? (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <span className="text-green-300 font-medium">
                      Vegallas teszt befejezve ({endstopReport.duration_seconds.toFixed(1)} mp)
                    </span>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <p className="text-sm text-red-400">Teszt nem fejezodott be: {endstopReport.error}</p>
                  </div>
                )}

                {/* Axis results */}
                <div className="space-y-3">
                  {endstopReport.axes.map((ax) => (
                    <div key={ax.axis} className="bg-steel-800/50 rounded-lg p-4 border border-steel-700">
                      <h4 className="font-medium text-steel-200 mb-2">
                        {ax.axis} tengely - {ax.axis_name}
                      </h4>

                      {/* Visual range bar */}
                      <div className="relative h-8 bg-steel-900 rounded-full overflow-hidden mb-3">
                        {ax.negative_limit !== null && ax.positive_limit !== null && (
                          <>
                            {/* Range bar */}
                            <div
                              className="absolute h-full bg-gradient-to-r from-blue-500/40 to-machine-500/40 rounded-full"
                              style={{
                                left: `${Math.max(0, 50 + (ax.negative_limit / 400) * 100)}%`,
                                width: `${Math.min(100, ((ax.positive_limit - ax.negative_limit) / 400) * 100)}%`,
                              }}
                            />
                            {/* Center marker */}
                            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-steel-500" />
                            {/* Labels */}
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
                          <span className="text-steel-400 text-xs">Negativ hatar</span>
                          <div className="font-mono">
                            {ax.negative_limit !== null ? `${ax.negative_limit.toFixed(1)}°` : 'N/A'}
                            {ax.negative_endstop_hit && <span className="text-green-400 text-xs ml-1">(endstop)</span>}
                            {ax.negative_max_reached && <span className="text-amber-400 text-xs ml-1">(max limit)</span>}
                          </div>
                        </div>
                        <div>
                          <span className="text-steel-400 text-xs">Pozitiv hatar</span>
                          <div className="font-mono">
                            {ax.positive_limit !== null ? `+${ax.positive_limit.toFixed(1)}°` : 'N/A'}
                            {ax.positive_endstop_hit && <span className="text-green-400 text-xs ml-1">(endstop)</span>}
                            {ax.positive_max_reached && <span className="text-amber-400 text-xs ml-1">(max limit)</span>}
                          </div>
                        </div>
                        <div>
                          <span className="text-steel-400 text-xs">Teljes tartomany</span>
                          <div className="font-mono font-bold text-machine-400">
                            {ax.total_range !== null ? `${ax.total_range.toFixed(1)}°` : 'N/A'}
                          </div>
                        </div>
                      </div>

                      {ax.error && (
                        <div className="mt-2 text-xs text-red-400">Hiba: {ax.error}</div>
                      )}
                    </div>
                  ))}
                </div>

                <button onClick={runEndstopTest} className="btn btn-secondary text-sm flex items-center gap-2">
                  <RotateCcw className="w-3 h-3" />
                  Ujrafuttatas
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DiagnosticsPanel({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<DiagReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moveTest, setMoveTest] = useState(false)

  const runDiagnostics = async () => {
    setRunning(true)
    setError(null)
    setReport(null)
    try {
      const resp = await fetch(`/api/devices/${deviceId}/diagnostics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ move_test: moveTest }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      const data: DiagReport = await resp.json()
      setReport(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          <span className="font-medium">Board Diagnosztika</span>
        </div>
        <button onClick={onClose} className="btn-icon hover:bg-steel-700">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="card-body space-y-4">
        {/* Indítás */}
        {!report && !running && (
          <div className="space-y-3">
            <p className="text-sm text-steel-400">
              Átfogó hardver diagnosztika: soros kapcsolat, firmware, tengelyek, gripper, endstopok, szívópumpa, latencia.
            </p>
            <label className="flex items-center gap-2 text-sm text-steel-300 cursor-pointer">
              <input
                type="checkbox"
                checked={moveTest}
                onChange={(e) => setMoveTest(e.target.checked)}
                className="rounded border-steel-600 bg-steel-800 text-machine-500 focus:ring-machine-500"
              />
              Mozgásteszt engedélyezése (kis szögű mozgatás)
            </label>
            <button
              onClick={runDiagnostics}
              className="btn btn-primary flex items-center gap-2"
            >
              <Activity className="w-4 h-4" />
              Diagnosztika indítása
            </button>
          </div>
        )}

        {/* Futás jelzés */}
        {running && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <Loader2 className="w-6 h-6 text-machine-400 animate-spin" />
            <span className="text-steel-300">Diagnosztika folyamatban...</span>
          </div>
        )}

        {/* Hiba */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
            <p className="text-sm text-red-400">Hiba: {error}</p>
            <button
              onClick={runDiagnostics}
              className="btn btn-secondary text-sm mt-2"
            >
              Újrapróbálás
            </button>
          </div>
        )}

        {/* Eredmények */}
        {report && (
          <div className="space-y-3">
            {/* Összesítés */}
            <div className={`rounded-lg p-3 border ${
              report.overall_passed 
                ? 'bg-green-500/10 border-green-500/30' 
                : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className="flex items-center gap-2">
                {report.overall_passed 
                  ? <CheckCircle className="w-5 h-5 text-green-400" />
                  : <XCircle className="w-5 h-5 text-red-400" />
                }
                <span className={`font-medium ${report.overall_passed ? 'text-green-400' : 'text-red-400'}`}>
                  {report.overall_passed ? 'Minden teszt sikeres' : 'Hibák találhatók'}
                </span>
              </div>
              <div className="text-sm text-steel-400 mt-1">
                {report.passed_tests}/{report.total_tests} OK
                {report.skipped_tests > 0 && `, ${report.skipped_tests} kihagyva`}
                {report.failed_tests > 0 && `, ${report.failed_tests} hibás`}
              </div>
              {report.firmware_info && (
                <div className="text-xs text-steel-500 mt-1 font-mono truncate">
                  {report.firmware_info}
                </div>
              )}
            </div>

            {/* Teszt lista */}
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {report.tests.map((test, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-steel-800/50">
                  {test.skipped ? (
                    <SkipForward className="w-4 h-4 text-steel-500 mt-0.5 flex-shrink-0" />
                  ) : test.passed ? (
                    <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm text-steel-200 font-medium">{test.name}</div>
                    <div className="text-xs text-steel-400 break-words">{test.message}</div>
                    {test.duration_ms > 0 && (
                      <div className="text-xs text-steel-600">{test.duration_ms.toFixed(0)} ms</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Újra futtatás */}
            <button
              onClick={runDiagnostics}
              className="btn btn-secondary text-sm flex items-center gap-2"
            >
              <RotateCcw className="w-3 h-3" />
              Újrafuttatás
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DeviceDetail() {
  const { deviceId } = useParams<{ deviceId: string }>()
  const { devices, sendCommand } = useDeviceStore()
  const [vizExpanded, setVizExpanded] = useState(false)
  const [showGcode, setShowGcode] = useState(true)
  const [gcodeCollapsed, setGcodeCollapsed] = useState(false)
  const [gcodeWidthPercent, setGcodeWidthPercent] = useState(40)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [showMotorTuning, setShowMotorTuning] = useState(false)
  
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
          {device.type === 'robot_arm' && (
            <>
              <button
                onClick={() => setShowMotorTuning(!showMotorTuning)}
                className={`btn flex items-center gap-2 ${showMotorTuning ? 'btn-primary' : 'btn-secondary'}`}
              >
                <Gauge className="w-4 h-4" />
                Motor Hangolas
              </button>
              <button
                onClick={() => setShowDiagnostics(!showDiagnostics)}
                className={`btn flex items-center gap-2 ${showDiagnostics ? 'btn-primary' : 'btn-secondary'}`}
              >
                <Activity className="w-4 h-4" />
                Diagnosztika
              </button>
            </>
          )}
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
            <JogControl 
              deviceId={device.id} 
              deviceType={device.type}
              status={device.status}
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
      
      {/* Motor Tuning Panel */}
      {showMotorTuning && device.type === 'robot_arm' && (
        <MotorTuningPanel
          deviceId={device.id}
          onClose={() => setShowMotorTuning(false)}
        />
      )}

      {/* Diagnostics Panel */}
      {showDiagnostics && device.type === 'robot_arm' && (
        <DiagnosticsPanel
          deviceId={device.id}
          onClose={() => setShowDiagnostics(false)}
        />
      )}

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
