import { useState, useCallback, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'
import { useDeviceStore } from '../../stores/deviceStore'

interface Props {
  deviceId: string
}

interface HistoryEntry {
  command: string
  response: string
  timestamp: Date
}

export default function MdiConsole({ deviceId }: Props) {
  const { sendMDI, socket } = useDeviceStore()
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const historyRef = useRef<HTMLDivElement>(null)
  
  // Listen for MDI responses
  useEffect(() => {
    if (!socket) return
    
    const handleMdiResult = (data: { deviceId: string; gcode: string; response: string }) => {
      if (data.deviceId === deviceId) {
        setHistory(prev => [...prev, {
          command: data.gcode,
          response: data.response,
          timestamp: new Date(),
        }])
      }
    }
    
    socket.on('device:mdi:result', handleMdiResult)
    return () => {
      socket.off('device:mdi:result', handleMdiResult)
    }
  }, [socket, deviceId])
  
  // Auto scroll
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    }
  }, [history])
  
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!command.trim()) return
    
    sendMDI(deviceId, command.trim())
    setCommand('')
    setHistoryIndex(-1)
  }, [command, deviceId, sendMDI])
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1
        setHistoryIndex(newIndex)
        setCommand(history[history.length - 1 - newIndex]?.command || '')
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setCommand(history[history.length - 1 - newIndex]?.command || '')
      } else if (historyIndex === 0) {
        setHistoryIndex(-1)
        setCommand('')
      }
    }
  }, [history, historyIndex])
  
  return (
    <div className="flex flex-col h-80">
      {/* History */}
      <div 
        ref={historyRef}
        className="flex-1 overflow-auto bg-steel-950 rounded-lg p-3 mb-3 font-mono text-sm"
      >
        {history.length === 0 ? (
          <p className="text-steel-500 text-center py-4">
            G-code parancsokat küldhet közvetlenül az eszköznek.
            <br />
            Pl: G0 X0 Y0, M3 S12000, stb.
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((entry, i) => (
              <div key={i}>
                <div className="flex items-start gap-2">
                  <span className="text-machine-400">&gt;</span>
                  <span className="text-steel-100">{entry.command}</span>
                </div>
                <div className="pl-4 text-steel-400">{entry.response}</div>
              </div>
            ))}
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
          placeholder="G-code parancs..."
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
            onClick={() => sendMDI(deviceId, cmd)}
            className="px-2 py-1 text-xs bg-steel-800 hover:bg-steel-700 rounded transition-colors"
          >
            {cmd}
          </button>
        ))}
      </div>
    </div>
  )
}
