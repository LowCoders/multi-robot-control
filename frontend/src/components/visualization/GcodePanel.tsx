import { useState, useEffect, useRef, useMemo } from 'react'
import { FileCode, Loader2, ChevronUp, ChevronDown, X } from 'lucide-react'
import type { DeviceStatus } from '../../types/device'

interface GcodeData {
  lines: string[]
  filename: string
}

interface Props {
  deviceId: string
  filepath?: string  // Direct file path for loading G-code
  status?: DeviceStatus
  collapsed?: boolean
  onToggle?: () => void
  onClose?: () => void
  showHeader?: boolean
  className?: string
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
  const [gcode, setGcode] = useState<GcodeData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentLineRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  const currentLine = status?.current_line ?? 0
  const totalLines = status?.total_lines ?? 0
  const currentFile = status?.current_file ?? filepath ?? null
  const isRunning = status?.state === 'running'
  const progress = status?.progress ?? 0

  // Load G-code when file changes, filepath provided, or when running starts
  useEffect(() => {
    // If filepath is provided, always try to load it
    const hasFileToLoad = filepath || currentFile || (totalLines > 0) || isRunning
    
    if (!hasFileToLoad) {
      setGcode(null)
      return
    }

    const loadGcode = async () => {
      setIsLoading(true)
      setError(null)
      
      try {
        // If filepath is provided, use the file endpoint
        const endpoint = filepath 
          ? `/api/gcode/file?path=${encodeURIComponent(filepath)}`
          : `/api/devices/${deviceId}/gcode`
        
        const response = await fetch(endpoint)
        
        if (response.ok) {
          const data = await response.json()
          setGcode({
            lines: data.lines || [],
            filename: data.filename || filepath?.split('/').pop() || currentFile?.split('/').pop() || 'program.nc',
          })
        } else {
          // Fallback - try to show something useful
          const filename = filepath?.split('/').pop() || currentFile?.split('/').pop() || 'program.nc'
          setError(`Nem sikerült betölteni: ${filename}`)
          setGcode(null)
        }
      } catch (err) {
        console.error('Failed to load G-code:', err)
        const filename = filepath?.split('/').pop() || currentFile?.split('/').pop() || 'program.nc'
        setError(`Hiba a betöltéskor: ${filename}`)
        setGcode(null)
      } finally {
        setIsLoading(false)
      }
    }

    loadGcode()
  }, [deviceId, filepath, currentFile, totalLines, isRunning])

  // Auto-scroll to current line
  useEffect(() => {
    if (currentLineRef.current && containerRef.current && !collapsed) {
      currentLineRef.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      })
    }
  }, [currentLine, collapsed])

  // Get syntax highlighting color for G-code line
  const getLineColor = (line: string): string => {
    const trimmed = line.trim()
    if (trimmed.startsWith(';') || trimmed.startsWith('(')) return 'text-green-500'
    if (/^[Gg]\d/.test(trimmed)) return 'text-blue-400'
    if (/^[Mm]\d/.test(trimmed)) return 'text-orange-400'
    if (/^[Ff]\d/.test(trimmed)) return 'text-yellow-400'
    if (/^[Ss]\d/.test(trimmed)) return 'text-purple-400'
    if (/^[Xx]|^[Yy]|^[Zz]/i.test(trimmed)) return 'text-cyan-400'
    return 'text-steel-300'
  }

  // Calculate visible lines
  const visibleLines = useMemo(() => {
    if (!gcode?.lines.length) return []
    
    return gcode.lines.map((line, idx) => ({
      lineNumber: idx + 1,
      content: line,
      isCurrent: idx + 1 === currentLine,
      isPast: idx + 1 < currentLine,
    }))
  }, [gcode?.lines, currentLine])

  // No file loaded state
  if (!currentFile && !isRunning && totalLines === 0) {
    return (
      <div className={`bg-steel-900 border border-steel-700 rounded-lg ${className}`}>
        {showHeader && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-steel-700">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-steel-500" />
              <span className="text-sm text-steel-500">G-code</span>
            </div>
            {onClose && (
              <button onClick={onClose} className="text-steel-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        <div className="p-4 text-center text-steel-500 text-sm">
          Nincs betöltött G-code fájl
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-steel-900 border border-steel-700 rounded-lg overflow-hidden flex flex-col ${className}`}>
      {/* Header bar */}
      {showHeader && (
        <div 
          className={`flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-steel-700 ${onToggle ? 'cursor-pointer hover:bg-steel-800/50' : ''}`}
          onClick={onToggle}
        >
          <div className="flex items-center gap-3">
            <FileCode className="w-4 h-4 text-machine-400" />
            <span className="text-sm font-medium text-steel-200">
              {gcode?.filename || 'G-code'}
            </span>
            {totalLines > 0 && (
              <span className="text-xs text-steel-500">
                Sor {currentLine} / {totalLines}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {/* Progress bar */}
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
            
            {/* Collapse toggle */}
            {onToggle && (
              <button className="text-steel-400 hover:text-white" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
                {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
            )}
            
            {/* Close button */}
            {onClose && (
              <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-steel-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* G-code lines */}
      {!collapsed && (
        <div 
          ref={containerRef}
          className="flex-1 min-h-0 overflow-y-auto font-mono text-xs"
        >
          {isLoading ? (
            <div className="p-4 text-center text-steel-400">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              G-code betöltése...
            </div>
          ) : error ? (
            <div className="p-4 text-center text-red-400 text-xs">
              {error}
            </div>
          ) : visibleLines.length > 0 ? (
            visibleLines.map(({ lineNumber, content, isCurrent, isPast }) => (
              <div
                key={lineNumber}
                ref={isCurrent ? currentLineRef : null}
                className={`
                  px-3 py-0.5 flex gap-3 transition-colors
                  ${isCurrent ? 'bg-yellow-500/20 border-l-2 border-yellow-500' : ''}
                  ${isPast ? 'opacity-40' : ''}
                `}
              >
                <span className="text-steel-600 w-8 text-right select-none tabular-nums">
                  {lineNumber}
                </span>
                <span className={getLineColor(content)}>
                  {content || ' '}
                </span>
              </div>
            ))
          ) : (
            <div className="p-4 text-center text-steel-500 text-xs">
              Nincs betöltött G-code
            </div>
          )}
        </div>
      )}
      
      {/* Collapsed mini view */}
      {collapsed && visibleLines.length > 0 && (
        <div className="px-3 py-2 font-mono text-xs flex gap-3">
          {visibleLines.filter(l => l.isCurrent).slice(0, 1).map(({ lineNumber, content }) => (
            <div key={lineNumber} className="flex gap-2 flex-1 items-center">
              <span className="text-yellow-500 font-medium">→</span>
              <span className="text-steel-500 tabular-nums">{lineNumber}:</span>
              <span className={`truncate ${getLineColor(content)}`}>{content}</span>
            </div>
          ))}
          {visibleLines.filter(l => l.isCurrent).length === 0 && (
            <span className="text-steel-500">Várakozás...</span>
          )}
        </div>
      )}
    </div>
  )
}
