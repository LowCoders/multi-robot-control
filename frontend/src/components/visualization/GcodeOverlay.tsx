import { useState, useEffect, useRef, useMemo } from 'react'
import { FileCode, Loader2, ChevronUp, ChevronDown } from 'lucide-react'
import type { DeviceStatus } from '../../types/device'

interface GcodeData {
  lines: string[]
  filename: string
}

interface Props {
  deviceId: string
  status?: DeviceStatus
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export default function GcodeOverlay({ 
  deviceId, 
  status,
  collapsed = false,
  onToggleCollapse 
}: Props) {
  const [gcode, setGcode] = useState<GcodeData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentLineRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  const currentLine = status?.current_line ?? 0
  const totalLines = status?.total_lines ?? 0
  const currentFile = status?.current_file ?? null
  const isRunning = status?.state === 'running'
  const progress = status?.progress ?? 0

  // Load G-code when file changes or when running starts
  useEffect(() => {
    // Don't load if there's nothing to load
    if (!currentFile && totalLines === 0 && !isRunning) {
      setGcode(null)
      return
    }

    const loadGcode = async () => {
      setIsLoading(true)
      setError(null)
      
      try {
        // Try to load G-code from API
        const response = await fetch(`/api/devices/${deviceId}/gcode`)
        
        if (response.ok) {
          const data = await response.json()
          setGcode({
            lines: data.lines || [],
            filename: data.filename || currentFile?.split('/').pop() || 'program.nc',
          })
        } else {
          // Fallback: create placeholder lines based on total_lines
          if (totalLines > 0) {
            const placeholderLines = Array.from(
              { length: Math.min(totalLines, 1000) }, 
              (_, i) => `; Line ${i + 1}`
            )
            setGcode({
              lines: placeholderLines,
              filename: currentFile?.split('/').pop() || 'program.nc',
            })
          } else if (isRunning) {
            // Running but no file info - show minimal placeholder
            setGcode({
              lines: ['G-code futtatás folyamatban...'],
              filename: 'program.nc',
            })
          }
        }
      } catch (err) {
        console.error('Failed to load G-code:', err)
        // Even on error, show something if running
        if (isRunning || totalLines > 0) {
          setGcode({
            lines: totalLines > 0 
              ? Array.from({ length: Math.min(totalLines, 100) }, (_, i) => `; Line ${i + 1}`)
              : ['G-code futtatás...'],
            filename: currentFile?.split('/').pop() || 'program.nc',
          })
        } else {
          setError('Nem sikerült betölteni a G-code-ot')
        }
      } finally {
        setIsLoading(false)
      }
    }

    loadGcode()
  }, [deviceId, currentFile, totalLines, isRunning])

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

  // Calculate visible window around current line
  const visibleLines = useMemo(() => {
    if (!gcode?.lines.length) return []
    
    const windowSize = collapsed ? 3 : 15 // Show fewer lines when collapsed
    const halfWindow = Math.floor(windowSize / 2)
    const startIdx = Math.max(0, currentLine - halfWindow - 1)
    const endIdx = Math.min(gcode.lines.length, currentLine + halfWindow)
    
    return gcode.lines.slice(startIdx, endIdx).map((line, idx) => ({
      lineNumber: startIdx + idx + 1,
      content: line,
      isCurrent: startIdx + idx + 1 === currentLine,
      isPast: startIdx + idx + 1 < currentLine,
    }))
  }, [gcode?.lines, currentLine, collapsed])

  if (!currentFile && !isRunning) {
    return null
  }

  return (
    <div className="bg-steel-900/95 backdrop-blur border-b border-steel-700">
      {/* Header bar */}
      <div 
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-steel-800/50"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-3">
          <FileCode className="w-4 h-4 text-steel-400" />
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
              <div className="w-32 h-1.5 bg-steel-700 rounded-full overflow-hidden">
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
          <button className="text-steel-400 hover:text-white">
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>
      
      {/* G-code lines */}
      {!collapsed && (
        <div 
          ref={containerRef}
          className="max-h-40 overflow-y-auto font-mono text-xs border-t border-steel-800"
        >
          {isLoading ? (
            <div className="p-3 text-center text-steel-400">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              G-code betöltése...
            </div>
          ) : error ? (
            <div className="p-3 text-center text-red-400 text-xs">
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
            <div className="p-3 text-center text-steel-500 text-xs">
              Nincs betöltött G-code
            </div>
          )}
        </div>
      )}
      
      {/* Collapsed mini view - just show current line */}
      {collapsed && visibleLines.length > 0 && (
        <div className="px-3 py-1 font-mono text-xs border-t border-steel-800 flex gap-3">
          {visibleLines.filter(l => l.isCurrent).map(({ lineNumber, content }) => (
            <div key={lineNumber} className="flex gap-2 flex-1">
              <span className="text-yellow-500 font-medium">→</span>
              <span className="text-steel-500 tabular-nums">{lineNumber}:</span>
              <span className={getLineColor(content)}>{content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
