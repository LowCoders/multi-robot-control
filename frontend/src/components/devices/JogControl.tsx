import { useState, useCallback, useEffect, useRef } from 'react'
import { 
  ArrowUp, 
  ArrowDown, 
  ArrowLeft, 
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Home,
} from 'lucide-react'
import { useDeviceStore } from '../../stores/deviceStore'

interface Props {
  deviceId: string
}

const stepSizes = [0.1, 1, 10, 100]

export default function JogControl({ deviceId }: Props) {
  const { jog, jogStop, sendCommand } = useDeviceStore()
  const [stepSize, setStepSize] = useState(10)
  const [feedRate, setFeedRate] = useState(1000)
  const [isActive, setIsActive] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  
  const handleJog = useCallback((axis: string, direction: number) => {
    const distance = stepSize * direction
    jog(deviceId, axis, distance, feedRate)
  }, [deviceId, stepSize, feedRate, jog])
  
  const handleHome = useCallback(() => {
    sendCommand(deviceId, 'home')
  }, [deviceId, sendCommand])
  
  // Track focus state for keyboard control
  const handleFocus = useCallback(() => setIsActive(true), [])
  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Only deactivate if focus moves outside the container
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsActive(false)
    }
  }, [])
  
  // Keyboard support - only when this component is active
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle keys when this jog control is active
      if (!isActive) return
      
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          handleJog('Y', 1)
          break
        case 'ArrowDown':
          e.preventDefault()
          handleJog('Y', -1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          handleJog('X', -1)
          break
        case 'ArrowRight':
          e.preventDefault()
          handleJog('X', 1)
          break
        case 'PageUp':
          e.preventDefault()
          handleJog('Z', 1)
          break
        case 'PageDown':
          e.preventDefault()
          handleJog('Z', -1)
          break
        case 'Escape':
          e.preventDefault()
          jogStop(deviceId)
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleJog, jogStop, deviceId, isActive])
  
  return (
    <div 
      ref={containerRef}
      className={`space-y-4 p-2 rounded-lg transition-colors ${isActive ? 'ring-2 ring-machine-500/50 bg-steel-800/30' : ''}`}
      tabIndex={0}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={handleFocus}
    >
      {/* XY Controls */}
      <div className="flex items-center gap-8">
        {/* XY Pad */}
        <div className="grid grid-cols-3 gap-1">
          <div />
          <button
            onClick={() => handleJog('Y', 1)}
            className="btn-icon bg-steel-800 hover:bg-steel-700 p-3"
            title="Y+ (Arrow Up)"
          >
            <ArrowUp className="w-5 h-5" />
          </button>
          <div />
          
          <button
            onClick={() => handleJog('X', -1)}
            className="btn-icon bg-steel-800 hover:bg-steel-700 p-3"
            title="X- (Arrow Left)"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            onClick={handleHome}
            className="btn-icon bg-machine-600/20 hover:bg-machine-600/30 text-machine-400 p-3"
            title="Home"
          >
            <Home className="w-5 h-5" />
          </button>
          <button
            onClick={() => handleJog('X', 1)}
            className="btn-icon bg-steel-800 hover:bg-steel-700 p-3"
            title="X+ (Arrow Right)"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          
          <div />
          <button
            onClick={() => handleJog('Y', -1)}
            className="btn-icon bg-steel-800 hover:bg-steel-700 p-3"
            title="Y- (Arrow Down)"
          >
            <ArrowDown className="w-5 h-5" />
          </button>
          <div />
        </div>
        
        {/* Z Controls */}
        <div className="flex flex-col gap-1">
          <button
            onClick={() => handleJog('Z', 1)}
            className="btn-icon bg-steel-800 hover:bg-steel-700 p-3"
            title="Z+ (Page Up)"
          >
            <ChevronUp className="w-5 h-5" />
          </button>
          <div className="px-3 py-2 bg-steel-800/50 rounded text-center text-sm text-steel-400">
            Z
          </div>
          <button
            onClick={() => handleJog('Z', -1)}
            className="btn-icon bg-steel-800 hover:bg-steel-700 p-3"
            title="Z- (Page Down)"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      {/* Step Size */}
      <div className="space-y-2">
        <label className="text-sm text-steel-400">Lépésköz</label>
        <div className="flex gap-2">
          {stepSizes.map((size) => (
            <button
              key={size}
              onClick={() => setStepSize(size)}
              className={`
                flex-1 py-2 rounded-md text-sm font-medium transition-colors
                ${stepSize === size 
                  ? 'bg-machine-600 text-white' 
                  : 'bg-steel-800 text-steel-300 hover:bg-steel-700'
                }
              `}
            >
              {size} mm
            </button>
          ))}
        </div>
      </div>
      
      {/* Feed Rate */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-steel-400">Sebesség</label>
          <span className="text-sm text-steel-300">{feedRate} mm/min</span>
        </div>
        <input
          type="range"
          min="100"
          max="5000"
          step="100"
          value={feedRate}
          onChange={(e) => setFeedRate(Number(e.target.value))}
          className="w-full h-2 bg-steel-800 rounded-lg appearance-none cursor-pointer"
        />
      </div>
      
      {/* Keyboard hints */}
      <div className="text-xs text-steel-500 space-y-1">
        {isActive ? (
          <>
            <p className="text-machine-400">✓ Billentyűzet aktív</p>
            <p>← → ↑ ↓ XY mozgás, Page Up/Down Z mozgás</p>
            <p>ESC: Leállítás</p>
          </>
        ) : (
          <p>Kattints ide a billentyűzet vezérlés aktiválásához</p>
        )}
      </div>
    </div>
  )
}
