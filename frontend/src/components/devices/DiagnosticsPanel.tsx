import { useState } from 'react'
import {
  Activity,
  CheckCircle,
  XCircle,
  SkipForward,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import type { DeviceCapabilities } from '../../types/device'

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

interface DiagnosticsPanelProps {
  deviceId: string
  capabilities?: DeviceCapabilities
  embedded?: boolean
}

export default function DiagnosticsPanel({ 
  deviceId,
  capabilities,
  embedded = false 
}: DiagnosticsPanelProps) {
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<DiagReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moveTest, setMoveTest] = useState(false)

  const hasGripper = capabilities?.has_gripper ?? false
  const hasSucker = capabilities?.has_sucker ?? false

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

  const getTestDescription = () => {
    const parts = ['soros kapcsolat', 'firmware', 'tengelyek']
    if (hasGripper) parts.push('gripper')
    if (hasSucker) parts.push('szívópumpa')
    parts.push('endstopok', 'latencia')
    return parts.join(', ')
  }

  const content = (
    <div className="space-y-4">
      {/* Indítás */}
      {!report && !running && (
        <div className="space-y-3">
          <p className="text-sm text-steel-400">
            Átfogó hardver diagnosztika: {getTestDescription()}.
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
  )

  if (embedded) {
    return content
  }

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Activity className="w-4 h-4 text-blue-400" />
        <span className="font-medium">Board Diagnosztika</span>
      </div>
      <div className="card-body">
        {content}
      </div>
    </div>
  )
}
