import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import {
  FileCode,
  Loader2,
  ChevronUp,
  ChevronDown,
  X,
  FolderOpen,
  Save,
  Pencil,
  Eye,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DeviceStatus } from '../../types/device'
import { useGcodeBufferStore } from '../../stores/gcodeBufferStore'
import OpenGcodeModal from './OpenGcodeModal'
import SaveGcodeAsModal from './SaveGcodeAsModal'

const GcodeMonacoEditor = lazy(() => import('./GcodeMonacoEditor'))

interface Props {
  deviceId: string
  filepath?: string
  status?: DeviceStatus
  collapsed?: boolean
  onToggle?: () => void
  onClose?: () => void
  showHeader?: boolean
  className?: string
}

function getLineColor(line: string): string {
  const trimmed = line.trim()
  if (trimmed.startsWith(';') || trimmed.startsWith('(')) return 'text-green-500'
  if (/^[Gg]\d/.test(trimmed)) return 'text-blue-400'
  if (/^[Mm]\d/.test(trimmed)) return 'text-orange-400'
  if (/^[Ff]\d/.test(trimmed)) return 'text-yellow-400'
  if (/^[Ss]\d/.test(trimmed)) return 'text-purple-400'
  if (/^[Xx]|^[Yy]|^[Zz]/i.test(trimmed)) return 'text-cyan-400'
  return 'text-steel-300'
}

export default function GcodePanel({
  deviceId,
  filepath,
  status,
  collapsed = false,
  onToggle,
  onClose,
  showHeader = true,
  className = '',
}: Props) {
  const { t } = useTranslation('visualization')
  const buffer = useGcodeBufferStore((s) => s.buffers[deviceId])
  const loadFromServer = useGcodeBufferStore((s) => s.loadFromServer)
  const setLines = useGcodeBufferStore((s) => s.setLines)
  const saveToServer = useGcodeBufferStore((s) => s.saveToServer)
  const setEditing = useGcodeBufferStore((s) => s.setEditing)
  const loadFromText = useGcodeBufferStore((s) => s.loadFromText)

  const currentLineRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [openModalOpen, setOpenModalOpen] = useState(false)
  const [saveAsModalOpen, setSaveAsModalOpen] = useState(false)
  // Line the user clicked in the read-only DOM view; consumed by Monaco on
  // mount/value-change to position the caret and reveal it.
  const [pendingCursorLine, setPendingCursorLine] = useState<number | null>(null)

  const currentLine = status?.current_line ?? 0
  const totalLines = status?.total_lines ?? 0
  const statusFile = status?.current_file ?? null
  const isRunning = status?.state === 'running'
  const progress = status?.progress ?? 0
  // "Look-ahead" pointer: the line the firmware will execute next. Once the
  // last line is being executed, this overflows by one — handled visually as
  // an end-of-program marker rendered after the last line.
  const pointerLine = currentLine > 0 ? currentLine + 1 : 0
  const pointerOverflow = currentLine > 0 && pointerLine > totalLines

  // Determine which file we should be loading from server
  const desiredServerFile = filepath ?? statusFile

  // Load from server when (a) explicit filepath/currentFile changes, or
  // (b) the buffer doesn't yet reflect that file. Avoid clobbering local edits.
  useEffect(() => {
    if (!desiredServerFile) return
    if (buffer?.dirty) return
    if (buffer?.filepath === desiredServerFile && buffer?.originalLines.length > 0) return
    void loadFromServer(deviceId, desiredServerFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, desiredServerFile])

  // Force-exit edit mode when running starts
  useEffect(() => {
    if (isRunning && buffer?.editing) {
      setEditing(deviceId, false)
    }
  }, [isRunning, buffer?.editing, deviceId, setEditing])

  // Auto-scroll the read-only DOM view to the look-ahead pointer line
  useEffect(() => {
    if (buffer?.editing) return
    if (currentLineRef.current && containerRef.current && !collapsed) {
      currentLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentLine, pointerLine, collapsed, buffer?.editing])

  const visibleLines = useMemo(() => {
    if (!buffer?.lines.length) return []
    return buffer.lines.map((line, idx) => ({
      lineNumber: idx + 1,
      content: line,
      // The "next to execute" line carries the prominent highlight.
      isNext: idx + 1 === pointerLine,
      // Currently executing line gets a subtle hint instead of the main marker.
      isExecuting: idx + 1 === currentLine && idx + 1 !== pointerLine,
      // Past = strictly before the currently executing line.
      isPast: idx + 1 < currentLine,
      isNew: buffer.newLineSet.has(idx),
    }))
  }, [buffer?.lines, buffer?.newLineSet, currentLine, pointerLine])

  const hasContent = (buffer?.lines.length ?? 0) > 0
  const hasFileToShow = !!desiredServerFile || hasContent || isRunning || totalLines > 0

  const handleSaveClick = async () => {
    if (!buffer || !buffer.dirty || isRunning) return
    if (buffer.filepath) {
      const result = await saveToServer(deviceId, buffer.filepath, true)
      if (!result.ok) {
        // The store also stores the error in buffer.error, but we surface
        // a quick alert for visibility.
        // eslint-disable-next-line no-alert
        alert(t('gcode_panel.save_failed', { detail: result.error }))
      }
    } else {
      setSaveAsModalOpen(true)
    }
  }

  const handleEditToggle = () => {
    if (isRunning) return
    setEditing(deviceId, !buffer?.editing)
  }

  const handleEditorChange = (text: string) => {
    setLines(deviceId, text.split('\n'))
  }

  // Click in the read-only DOM view → flip into edit mode and remember which
  // line was clicked so Monaco can park the caret there once it mounts.
  const enterEditAt = (lineNumber: number) => {
    if (isRunning) return
    setPendingCursorLine(lineNumber)
    if (!buffer?.editing) setEditing(deviceId, true)
  }

  const handlePickServerFile = async (path: string) => {
    await loadFromServer(deviceId, path)
  }

  const handlePickLocalFile = (filename: string, text: string) => {
    loadFromText(deviceId, filename, text)
    if (!isRunning) setEditing(deviceId, true)
  }

  const handleSaveAs = async (path: string, overwrite: boolean) => {
    const result = await saveToServer(deviceId, path, overwrite)
    return result
  }

  // Empty/no-file state
  if (!hasFileToShow) {
    return (
      <div className={`bg-steel-900 border border-steel-700 rounded-lg ${className}`}>
        {showHeader && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-steel-700">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-steel-500" />
              <span className="text-sm text-steel-500">{t('gcode_panel.label_short')}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setOpenModalOpen(true)}
                className="text-steel-400 hover:text-white p-1 rounded hover:bg-steel-800"
                title={t('gcode_panel.open_title')}
              >
                <FolderOpen className="w-4 h-4" />
              </button>
              {onClose && (
                <button
                  onClick={onClose}
                  className="text-steel-500 hover:text-white p-1 rounded hover:bg-steel-800"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="p-4 text-center text-steel-500 text-sm">{t('gcode_panel.empty')}</div>
        <OpenGcodeModal
          isOpen={openModalOpen}
          onClose={() => setOpenModalOpen(false)}
          onPickServerFile={handlePickServerFile}
          onPickLocalFile={handlePickLocalFile}
        />
      </div>
    )
  }

  const editing = !!buffer?.editing && !isRunning
  const editorValue = buffer?.lines.join('\n') ?? ''
  const dirty = !!buffer?.dirty
  const filename = buffer?.filename || desiredServerFile?.split('/').pop() || 'program.nc'

  return (
    <div
      className={`bg-steel-900 border border-steel-700 rounded-lg overflow-hidden flex flex-col ${className}`}
    >
      {showHeader && (
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-steel-700">
          <div
            className={`flex items-center gap-3 min-w-0 flex-1 ${onToggle ? 'cursor-pointer' : ''}`}
            onClick={onToggle}
          >
            <FileCode className="w-4 h-4 text-machine-400 flex-shrink-0" />
            <span className="text-sm font-medium text-steel-200 truncate" title={filename}>
              {filename}
              {dirty && <span className="text-amber-400 ml-1">•</span>}
            </span>
            {totalLines > 0 && (
              <span className="text-xs text-steel-500 flex-shrink-0">
                {t('gcode_panel.line_progress', { current: currentLine, total: totalLines })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {totalLines > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-steel-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-machine-500 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-xs text-steel-400 w-12 text-right">
                  {progress.toFixed(1)}%
                </span>
              </div>
            )}

            {/* Open */}
            <button
              onClick={() => setOpenModalOpen(true)}
              className="p-1 rounded text-steel-400 hover:text-white hover:bg-steel-800"
              title={t('gcode_panel.open_title')}
              disabled={isRunning}
            >
              <FolderOpen className="w-4 h-4" />
            </button>

            {/* Save */}
            <button
              onClick={handleSaveClick}
              className={`p-1 rounded ${
                dirty && !isRunning
                  ? 'text-machine-400 hover:text-white hover:bg-steel-800'
                  : 'text-steel-600 cursor-not-allowed'
              }`}
              title={
                isRunning
                  ? t('gcode_panel.save_running')
                  : dirty
                    ? t('gcode_panel.save_tooltip')
                    : t('gcode_panel.no_changes')
              }
              disabled={!dirty || isRunning || !!buffer?.saving}
            >
              {buffer?.saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
            </button>

            {/* Edit toggle */}
            <button
              onClick={handleEditToggle}
              className={`p-1 rounded ${
                isRunning
                  ? 'text-steel-600 cursor-not-allowed'
                  : editing
                    ? 'text-machine-400 hover:text-white hover:bg-steel-800'
                    : 'text-steel-400 hover:text-white hover:bg-steel-800'
              }`}
              title={
                isRunning
                  ? t('gcode_panel.edit_running')
                  : editing
                    ? t('gcode_panel.readonly_mode')
                    : t('gcode_panel.edit_mode')
              }
              disabled={isRunning}
            >
              {editing ? <Eye className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
            </button>

            {onToggle && (
              <button
                className="text-steel-400 hover:text-white p-1 rounded hover:bg-steel-800"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle()
                }}
                title={collapsed ? t('gcode_panel.expand') : t('gcode_panel.collapse')}
              >
                {collapsed ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
              </button>
            )}

            {onClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                className="text-steel-400 hover:text-white p-1 rounded hover:bg-steel-800"
                title="Bezárás"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {!collapsed && (
        <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden">
          {buffer?.loading ? (
            <div className="p-4 text-center text-steel-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              {t('gcode_panel.loading')}
            </div>
          ) : buffer?.error ? (
            <div className="p-4 text-center text-red-400 text-xs">{buffer.error}</div>
          ) : editing ? (
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full text-steel-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  {t('gcode_panel.editor_loading')}
                </div>
              }
            >
              <GcodeMonacoEditor
                value={editorValue}
                readOnly={isRunning}
                newLineSet={buffer?.newLineSet ?? new Set()}
                currentLine={currentLine}
                pointerLine={pointerLine}
                revision={buffer?.revision ?? 0}
                initialCursorLine={pendingCursorLine}
                onCursorConsumed={() => setPendingCursorLine(null)}
                onChange={handleEditorChange}
                onReadOnlyClick={enterEditAt}
              />
            </Suspense>
          ) : visibleLines.length > 0 ? (
            <div
              className={`h-full overflow-y-auto font-mono text-xs ${
                isRunning ? '' : 'cursor-text'
              }`}
              title={isRunning ? undefined : t('gcode_panel.click_to_edit')}
            >
              {visibleLines.map(({ lineNumber, content, isNext, isExecuting, isPast, isNew }) => (
                <div
                  key={lineNumber}
                  ref={isNext ? currentLineRef : null}
                  onClick={() => enterEditAt(lineNumber)}
                  className={`
                    px-3 py-0.5 flex gap-3 transition-colors
                    ${isNext ? 'bg-yellow-500/20 border-l-2 border-yellow-500' : ''}
                    ${isExecuting && !isNext ? 'bg-yellow-500/10 border-l-2 border-yellow-500/40' : ''}
                    ${isNew && !isNext && !isExecuting ? 'bg-green-500/10 border-l-2 border-green-500' : ''}
                    ${isPast ? 'opacity-40' : ''}
                    ${!isRunning ? 'hover:bg-steel-800/40' : ''}
                  `}
                >
                  <span className="text-steel-600 w-8 text-right select-none tabular-nums">
                    {lineNumber}
                  </span>
                  <span className={getLineColor(content)}>{content || ' '}</span>
                </div>
              ))}
              {pointerOverflow && (
                <div
                  ref={currentLineRef}
                  onClick={() => enterEditAt(visibleLines.length)}
                  className={`px-3 py-1 flex gap-3 items-center bg-yellow-500/10 border-l-2 border-yellow-500 border-t border-dashed border-yellow-500/50 ${
                    !isRunning ? 'cursor-text hover:bg-yellow-500/15' : ''
                  }`}
                  title={t('gcode_panel.eof_executing_title')}
                >
                  <span className="text-steel-600 w-8 text-right select-none tabular-nums">
                    {visibleLines.length + 1}
                  </span>
                  <span className="text-yellow-500">{t('gcode_panel.eof_marker')}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 text-center text-steel-500 text-xs">{t('gcode_panel.no_buffer')}</div>
          )}
        </div>
      )}

      {collapsed && visibleLines.length > 0 && (
        <div className="px-3 py-2 font-mono text-xs flex gap-3">
          {pointerOverflow ? (
            <div className="flex gap-2 flex-1 items-center">
              <span className="text-yellow-500 font-medium">▶</span>
              <span className="text-yellow-500">{t('gcode_panel.eof_plain')}</span>
            </div>
          ) : (
            <>
              {visibleLines
                .filter((l) => l.isNext)
                .slice(0, 1)
                .map(({ lineNumber, content }) => (
                  <div key={lineNumber} className="flex gap-2 flex-1 items-center">
                    <span className="text-yellow-500 font-medium">▶</span>
                    <span className="text-steel-500 tabular-nums">{lineNumber}:</span>
                    <span className={`truncate ${getLineColor(content)}`}>{content}</span>
                  </div>
                ))}
              {visibleLines.filter((l) => l.isNext).length === 0 && (
                <span className="text-steel-500">{t('gcode_panel.waiting')}</span>
              )}
            </>
          )}
        </div>
      )}

      <OpenGcodeModal
        isOpen={openModalOpen}
        onClose={() => setOpenModalOpen(false)}
        onPickServerFile={handlePickServerFile}
        onPickLocalFile={handlePickLocalFile}
      />

      <SaveGcodeAsModal
        isOpen={saveAsModalOpen}
        onClose={() => setSaveAsModalOpen(false)}
        defaultFilename={filename}
        defaultDir={
          buffer?.filepath ? buffer.filepath.split('/').slice(0, -1).join('/') : undefined
        }
        onConfirm={handleSaveAs}
      />
    </div>
  )
}
