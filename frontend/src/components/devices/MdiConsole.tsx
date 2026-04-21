import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  Send,
  Plus,
  Terminal,
  Code2,
  MessageSquare,
  FileText,
  Bug,
  Circle,
  CircleDot,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDeviceStore } from '../../stores/deviceStore'
import { useGcodeBufferStore } from '../../stores/gcodeBufferStore'
import { useMdiViewStore, ALL_LAYERS, type MdiLayer, type CaptureMode } from '../../stores/mdiViewStore'
import type { Position } from '../../types/device'

interface Props {
  deviceId: string
}

type EntryKind = 'mdi' | 'jog' | 'jog-stop' | 'jog-continuous'

interface DebugInfo {
  protocol?: string | null
  stateBefore?: string | null
  [key: string]: unknown
}

interface JogParams {
  axis: string
  distance: number
  feedRate: number
}

interface HistoryEntry {
  command: string
  raw: string
  response: string
  detailed: string
  debug: DebugInfo
  timestamp: Date
  kind: EntryKind
  continuous?: boolean
  // Structured params for jog kinds (used to recompute absolute form on the fly).
  jogParams?: JogParams
  // Position snapshot at completion (used to render absolute form).
  endPos?: Position | null
  // Position snapshot at start (used by continuous jog for delta).
  startPos?: Position | null
}

interface MdiResultPayload {
  deviceId: string
  command?: string
  raw?: string
  response: string
  detailed?: string
  debug?: DebugInfo
  jogParams?: JogParams
  // Legacy
  gcode?: string
  protocol?: string
  stateBefore?: string
  kind?: EntryKind
  continuous?: boolean
}

const POS_KEY: Record<string, keyof Position> = { X: 'x', Y: 'y', Z: 'z', A: 'a', B: 'b', C: 'c' }

function formatNum(n: number): string {
  // Strip trailing zeros while keeping at most 3 decimals.
  return Number.isFinite(n) ? Number(n.toFixed(3)).toString() : '0'
}

function formatDebug(debug: DebugInfo): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(debug)) {
    if (value === null || value === undefined || value === '') continue
    parts.push(`${key}=${String(value)}`)
  }
  return parts.join(', ')
}

/**
 * Header controls for the MDI console (REC button + REL/ABS capture mode).
 * Rendered separately from the body so the parent panel header can host
 * these without doubling them inside the console itself.
 */
export function MdiConsoleHeaderControls({ deviceId }: Props) {
  const { t } = useTranslation('devices')
  const captureMode = useMdiViewStore((s) => s.captureMode[deviceId]) ?? 'relative'
  const recording = Boolean(useMdiViewStore((s) => s.recording[deviceId]))
  const setCaptureMode = useMdiViewStore((s) => s.setCaptureMode)
  const toggleRecording = useMdiViewStore((s) => s.toggleRecording)

  return (
    <div className="flex items-center gap-2 flex-1">
      <button
        type="button"
        onClick={() => toggleRecording(deviceId)}
        title={recording ? t('mdi_console.rec_on_title') : t('mdi_console.rec_off_title')}
        aria-pressed={recording}
        className={
          'flex items-center gap-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border transition-colors ' +
          (recording
            ? 'bg-red-500/20 border-red-400 text-red-200 animate-pulse'
            : 'bg-steel-900 border-steel-700 text-steel-500 hover:text-steel-300')
        }
      >
        {recording ? <CircleDot className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
        REC
      </button>

      <div className="flex items-center gap-1 ml-auto">
        <span className="text-[10px] uppercase tracking-wide text-steel-500 mr-1">{t('mdi_console.mode_heading')}</span>
        {(['relative', 'absolute'] as CaptureMode[]).map((mode) => {
          const active = captureMode === mode
          const label = mode === 'relative' ? 'REL' : 'ABS'
          const title =
            mode === 'relative'
              ? t('mdi_console.capture_relative_title')
              : t('mdi_console.capture_absolute_title')
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setCaptureMode(deviceId, mode)}
              title={title}
              aria-pressed={active}
              className={
                'px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border transition-colors ' +
                (active
                  ? 'bg-machine-500/20 border-machine-400 text-machine-200'
                  : 'bg-steel-900 border-steel-700 text-steel-500 hover:text-steel-300')
              }
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function buildAbsoluteCommand(axis: string, target: number, feedRate: number): string {
  return `G90 G0 ${axis}${formatNum(target)} F${formatNum(feedRate)}`
}

function buildRelativeCommand(axis: string, distance: number, feedRate: number): string {
  return `G91 G0 ${axis}${formatNum(distance)} F${formatNum(feedRate)}`
}

function getAxisValue(pos: Position | null | undefined, axis: string): number | null {
  if (!pos) return null
  const key = POS_KEY[axis.toUpperCase()]
  if (!key) return null
  const value = pos[key]
  return typeof value === 'number' ? value : null
}

/**
 * Compute the displayable command string for an entry given the current
 * capture mode. Falls back to the stored command when conversion isn't
 * possible (e.g. missing position snapshot).
 */
function commandForMode(entry: HistoryEntry, mode: CaptureMode): string {
  if (!entry.jogParams) return entry.command
  const { axis, distance, feedRate } = entry.jogParams
  if (mode === 'absolute') {
    const target = getAxisValue(entry.endPos, axis)
    if (target !== null) return buildAbsoluteCommand(axis, target, feedRate)
    return entry.command
  }
  // Relative
  if (entry.kind === 'jog-continuous' && entry.startPos && entry.endPos) {
    const start = getAxisValue(entry.startPos, axis)
    const end = getAxisValue(entry.endPos, axis)
    if (start !== null && end !== null) {
      return buildRelativeCommand(axis, end - start, feedRate)
    }
  }
  return buildRelativeCommand(axis, distance, feedRate)
}

export default function MdiConsole({ deviceId }: Props) {
  const { t } = useTranslation('devices')
  const { sendMDI, socket, devices, consumeJogSession } = useDeviceStore()
  const appendLineFromMdi = useGcodeBufferStore((s) => s.appendLineFromMdi)

  const layerConfig = useMdiViewStore((s) => s.layers[deviceId])
  const captureModeState = useMdiViewStore((s) => s.captureMode[deviceId])
  const recordingState = useMdiViewStore((s) => s.recording[deviceId])
  const toggleLayer = useMdiViewStore((s) => s.toggleLayer)
  const getLayers = useMdiViewStore((s) => s.getLayers)
  const getCaptureMode = useMdiViewStore((s) => s.getCaptureMode)

  const layers = useMemo(() => getLayers(deviceId), [getLayers, deviceId, layerConfig])
  const captureMode = useMemo(
    () => getCaptureMode(deviceId),
    [getCaptureMode, deviceId, captureModeState]
  )
  const recording = Boolean(recordingState)

  const layerMeta = useMemo(
    () =>
      ({
        command: { label: t('mdi_console.layer_command'), title: t('mdi_console.layer_command_title'), Icon: Terminal },
        raw: { label: t('mdi_console.layer_raw'), title: t('mdi_console.layer_raw_title'), Icon: Code2 },
        response: { label: t('mdi_console.layer_response'), title: t('mdi_console.layer_response_title'), Icon: MessageSquare },
        detailed: { label: t('mdi_console.layer_detailed'), title: t('mdi_console.layer_detailed_title'), Icon: FileText },
        debug: { label: t('mdi_console.layer_debug'), title: t('mdi_console.layer_debug_title'), Icon: Bug },
      }) as Record<MdiLayer, { label: string; title: string; Icon: typeof Terminal }>,
    [t],
  )

  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const historyRef = useRef<HTMLDivElement>(null)
  const device = devices.find((d) => d.id === deviceId)
  const isRunning = device?.state === 'running'

  // Keep the latest values reachable from socket handlers without re-binding.
  const captureModeRef = useRef(captureMode)
  const recordingRef = useRef(recording)
  const isRunningRef = useRef(isRunning)
  useEffect(() => {
    captureModeRef.current = captureMode
  }, [captureMode])
  useEffect(() => {
    recordingRef.current = recording
  }, [recording])
  useEffect(() => {
    isRunningRef.current = isRunning
  }, [isRunning])

  const handleAddToGcode = useCallback(
    (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return
      appendLineFromMdi(deviceId, trimmed, { running: isRunning })
    },
    [appendLineFromMdi, deviceId, isRunning]
  )

  const recordIfEnabled = useCallback(
    (line: string) => {
      if (!recordingRef.current) return
      const trimmed = line.trim()
      if (!trimmed) return
      appendLineFromMdi(deviceId, trimmed, { running: isRunningRef.current })
    },
    [appendLineFromMdi, deviceId]
  )

  // Listen for MDI / jog / jog-stop responses
  useEffect(() => {
    if (!socket) return

    const handleMdiResult = (data: MdiResultPayload) => {
      if (data.deviceId !== deviceId) return
      const cmdRaw = data.command ?? data.gcode ?? ''
      const raw = data.raw ?? cmdRaw
      const response = data.response ?? ''
      const detailed = data.detailed ?? response
      const debug: DebugInfo = data.debug ?? {}
      if (data.protocol && debug.protocol === undefined) debug.protocol = data.protocol
      if (data.stateBefore && debug.stateBefore === undefined) debug.stateBefore = data.stateBefore

      // For incremental jog: snapshot the *current* work position (which is
      // now the target after the move) so we can render absolute coords.
      const isJog = data.kind === 'jog'
      const endPos = isJog
        ? (() => {
            const dev = useDeviceStore.getState().devices.find((d) => d.id === deviceId)
            return dev?.status?.work_position ?? dev?.status?.position ?? null
          })()
        : null

      const entry: HistoryEntry = {
        command: cmdRaw,
        raw,
        response,
        detailed,
        debug,
        timestamp: new Date(),
        kind: data.kind ?? 'mdi',
        continuous: data.continuous,
        jogParams: data.jogParams,
        endPos,
      }
      setHistory((prev) => [...prev, entry])

      // Auto-record if recording is on. Use the mode-aware command form.
      const displayed =
        entry.kind === 'jog' || entry.kind === 'jog-continuous'
          ? commandForMode(entry, captureModeRef.current)
          : entry.command
      if (displayed) recordIfEnabled(displayed)
    }

    const handleJogStopResult = (data: { deviceId: string; success?: boolean }) => {
      if (data.deviceId !== deviceId) return
      // Pull any pending continuous-jog session and synthesize an entry so the
      // user can see (and optionally record) the actual moved delta.
      const session = consumeJogSession(deviceId)
      if (!session) return
      const dev = useDeviceStore.getState().devices.find((d) => d.id === deviceId)
      const endPos = dev?.status?.work_position ?? dev?.status?.position ?? null
      const startVal = getAxisValue(session.startPos, session.axis)
      const endVal = getAxisValue(endPos, session.axis)
      const delta =
        startVal !== null && endVal !== null
          ? endVal - startVal
          : 0
      const command = buildRelativeCommand(session.axis, delta, session.feedRate)

      const entry: HistoryEntry = {
        command,
        raw: command,
        response: data.success === false ? 'error' : 'ok',
        detailed: '',
        debug: {},
        timestamp: new Date(),
        kind: 'jog-continuous',
        continuous: true,
        jogParams: {
          axis: session.axis,
          distance: delta,
          feedRate: session.feedRate,
        },
        startPos: session.startPos,
        endPos,
      }
      setHistory((prev) => [...prev, entry])

      const displayed = commandForMode(entry, captureModeRef.current)
      if (displayed) recordIfEnabled(displayed)
    }

    socket.on('device:mdi:result', handleMdiResult)
    socket.on('device:jog:stop:result', handleJogStopResult)
    return () => {
      socket.off('device:mdi:result', handleMdiResult)
      socket.off('device:jog:stop:result', handleJogStopResult)
    }
  }, [socket, deviceId, consumeJogSession, recordIfEnabled])

  // Auto scroll
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    }
  }, [history])

  // Recallable entries (skip jog-stop and any with empty command).
  const recallable = useMemo(
    () =>
      history.filter((e) => {
        if (e.kind === 'jog-stop') return false
        const display = commandForMode(e, captureMode)
        return ((display || e.raw) ?? '').trim().length > 0
      }),
    [history, captureMode]
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!command.trim()) return
      sendMDI(deviceId, command.trim())
      setCommand('')
      setHistoryIndex(-1)
    },
    [command, deviceId, sendMDI]
  )

  const recallText = useCallback(
    (entry: HistoryEntry) => commandForMode(entry, captureMode) || entry.raw,
    [captureMode]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (historyIndex < recallable.length - 1) {
          const newIndex = historyIndex + 1
          setHistoryIndex(newIndex)
          const entry = recallable[recallable.length - 1 - newIndex]
          setCommand(entry ? recallText(entry) : '')
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1
          setHistoryIndex(newIndex)
          const entry = recallable[recallable.length - 1 - newIndex]
          setCommand(entry ? recallText(entry) : '')
        } else if (historyIndex === 0) {
          setHistoryIndex(-1)
          setCommand('')
        }
      }
    },
    [recallable, historyIndex, recallText]
  )

  return (
    <div className="flex flex-col h-full min-h-[20rem]">
      {/* Toolbar: layer toggles. The REC button and capture-mode (REL/ABS)
          selectors live in the parent panel header (see ControlPanelContent
          → MdiConsoleHeaderControls). */}
      <div className="flex items-center gap-2 mb-2 text-steel-400 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide mr-1">{t('mdi_console.layers_heading')}</span>
          {ALL_LAYERS.map((layer) => {
            const { label, title, Icon } = layerMeta[layer]
            const active = layers[layer]
            return (
              <button
                key={layer}
                type="button"
                onClick={() => toggleLayer(deviceId, layer)}
                title={title}
                aria-pressed={active}
                className={
                  'flex items-center gap-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border transition-colors ' +
                  (active
                    ? 'bg-machine-500/20 border-machine-400 text-machine-200'
                    : 'bg-steel-900 border-steel-700 text-steel-500 hover:text-steel-300')
                }
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* History */}
      <div
        ref={historyRef}
        className="flex-1 min-h-0 overflow-auto bg-steel-950 rounded-lg p-3 mb-3 font-mono text-sm border border-steel-800"
      >
        {history.length === 0 ? (
          <p className="text-steel-500 text-center py-4">
            {t('mdi_console.empty_hint_1')}
            <br />
            {t('mdi_console.empty_hint_2')}
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((entry, i) => {
              const isJog = entry.kind === 'jog' || entry.kind === 'jog-continuous'
              const isJogStop = entry.kind === 'jog-stop'
              const displayCommand = isJog ? commandForMode(entry, captureMode) : entry.command
              const canAdd = !isJogStop && (displayCommand || entry.raw).trim().length > 0
              const debugLine = formatDebug(entry.debug)
              const showCommand = layers.command
              const showRaw = layers.raw && entry.raw && entry.raw !== displayCommand
              const showResponse = layers.response && entry.response
              const showDetailed = layers.detailed && entry.detailed && entry.detailed !== entry.response
              const showDebug = layers.debug && debugLine

              const badge = isJogStop
                ? t('mdi_console.badge_jog_stop')
                : entry.kind === 'jog-continuous'
                ? t('mdi_console.badge_jog_cont')
                : entry.continuous
                ? t('mdi_console.badge_jog_cont')
                : isJog
                ? t('mdi_console.badge_jog')
                : null
              const badgeTitle = isJogStop
                ? t('mdi_console.badge_jog_stop_title')
                : entry.kind === 'jog-continuous'
                ? t('mdi_console.badge_jog_cont_title')
                : entry.continuous
                ? t('mdi_console.badge_jog_cont_simple_title')
                : t('mdi_console.badge_jog_step_title')

              return (
                <div key={i} className="group">
                  {showCommand && (
                    <div className="flex items-start gap-2">
                      <span className="text-machine-400">&gt;</span>
                      {badge && (
                        <span
                          className="text-[10px] uppercase tracking-wide bg-steel-800 text-machine-300 px-1.5 py-0.5 rounded shrink-0"
                          title={badgeTitle}
                        >
                          {badge}
                        </span>
                      )}
                      <span className="text-steel-100 flex-1 whitespace-pre-wrap break-all">
                        {displayCommand || (isJogStop ? '' : entry.raw)}
                      </span>
                      {canAdd && (
                        <button
                          type="button"
                          onClick={() => handleAddToGcode(displayCommand || entry.raw)}
                          title={t('mdi_console.add_line_title')}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded hover:bg-steel-700 text-steel-400 hover:text-machine-400"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                  {showRaw && (
                    <div className="pl-4 text-steel-500 whitespace-pre-wrap break-all">
                      <span className="text-steel-600">{t('mdi_console.trace_raw')}</span> {entry.raw}
                    </div>
                  )}
                  {showResponse && (
                    <div className="pl-4 text-steel-400 whitespace-pre-wrap break-all">
                      {entry.response}
                    </div>
                  )}
                  {showDetailed && (
                    <div className="pl-4 text-steel-500 whitespace-pre-wrap break-all">
                      <span className="text-steel-600">detail:</span> {entry.detailed}
                    </div>
                  )}
                  {showDebug && (
                    <div className="pl-4 text-[11px] text-steel-500">
                      <span className="text-steel-600">{t('mdi_console.trace_debug')}</span> {debugLine}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          placeholder={t('mdi_console.placeholder')}
          className="input flex-1 font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={!command.trim()}
          className="btn btn-primary"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* Quick commands */}
      <div className="flex flex-wrap gap-1 mt-2">
        {['G0 X0 Y0', 'G28', 'M3 S12000', 'M5', 'M30'].map((cmd) => (
          <button
            key={cmd}
            type="button"
            onClick={() => sendMDI(deviceId, cmd)}
            className="btn btn-secondary btn-xs font-mono"
          >
            {cmd}
          </button>
        ))}
      </div>
    </div>
  )
}
