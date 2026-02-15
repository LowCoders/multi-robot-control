import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { 
  ArrowUp, 
  ArrowDown, 
  ArrowLeft, 
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Home,
  AlertTriangle,
} from 'lucide-react'
import { useDeviceStore } from '../../stores/deviceStore'
import type { DeviceType, DeviceStatus } from '../../types/device'

interface Props {
  deviceId: string
  deviceType?: DeviceType
  /** Current device status (for endstop_blocked) */
  status?: DeviceStatus
}

const stepSizes = [0.1, 1, 10, 100]

// ============================================================
// JogButton - MODUL SZINTU komponens (NEM a renderben!)
// Ha a renderben lenne, minden rendernel uj fuggvenyreferenciat
// kapna, es a React unmountolna/remountolna -> villogas.
// ============================================================

interface JogButtonProps {
  onJog: (axis: string, direction: number) => void
  axis: string
  direction: number
  icon: React.ComponentType<{ className?: string }>
  title: string
  isBlocked: boolean
}

function JogButton({ onJog, axis, direction, icon: Icon, title, isBlocked }: JogButtonProps) {
  return (
    <button
      onClick={() => !isBlocked && onJog(axis, direction)}
      disabled={isBlocked}
      className={`btn-icon p-3 ${
        isBlocked 
          ? 'bg-red-900/30 text-red-400/50 cursor-not-allowed border border-red-500/20' 
          : 'bg-steel-800 hover:bg-steel-700'
      }`}
      title={isBlocked ? `${title} - ENDSTOP` : title}
    >
      <Icon className="w-5 h-5" />
    </button>
  )
}

// ============================================================
// JogControl
// ============================================================

export default function JogControl({ deviceId, deviceType, status }: Props) {
  const { jog, jogStop, sendCommand } = useDeviceStore()
  
  const isRobotArm = deviceType === 'robot_arm'
  
  // Robot arm: fok (°), feed rate 1-100
  // CNC/lézer: mm, feed rate 100-5000 mm/min
  const unit = isRobotArm ? '°' : ' mm'
  const feedRateMin = isRobotArm ? 1 : 100
  const feedRateMax = isRobotArm ? 100 : 5000
  const feedRateStep = isRobotArm ? 1 : 100
  const feedRateUnit = isRobotArm ? '' : ' mm/min'
  
  const [stepSize, setStepSize] = useState(10)
  const [feedRate, setFeedRate] = useState(isRobotArm ? 50 : 1000)
  const [isActive, setIsActive] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Endstop-based blocking: only block when a real endstop signal was triggered.
  // endstop_blocked comes from the driver (via M119 after each jog).
  // Format: { 'Y': 'positive', 'X': 'negative', ... }
  const blocked = useMemo(() => {
    const eb = status?.endstop_blocked
    if (!eb) {
      return { xPlus: false, xMinus: false, yPlus: false, yMinus: false, zPlus: false, zMinus: false }
    }
    return {
      xPlus:  eb['X'] === 'positive',
      xMinus: eb['X'] === 'negative',
      yPlus:  eb['Y'] === 'positive',
      yMinus: eb['Y'] === 'negative',
      zPlus:  eb['Z'] === 'positive',
      zMinus: eb['Z'] === 'negative',
    }
  }, [status?.endstop_blocked])
  
  // Any axis at endstop?
  const anyBlocked = Object.values(blocked).some(v => v)
  
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
          if (!blocked.yPlus) handleJog('Y', 1)
          break
        case 'ArrowDown':
          e.preventDefault()
          if (!blocked.yMinus) handleJog('Y', -1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (!blocked.xMinus) handleJog('X', -1)
          break
        case 'ArrowRight':
          e.preventDefault()
          if (!blocked.xPlus) handleJog('X', 1)
          break
        case 'PageUp':
          e.preventDefault()
          if (!blocked.zPlus) handleJog('Z', 1)
          break
        case 'PageDown':
          e.preventDefault()
          if (!blocked.zMinus) handleJog('Z', -1)
          break
        case 'Escape':
          e.preventDefault()
          jogStop(deviceId)
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleJog, jogStop, deviceId, isActive, blocked])
  
  return (
    <div 
      ref={containerRef}
      className={`space-y-4 p-2 rounded-lg transition-colors ${isActive ? 'ring-2 ring-machine-500/50 bg-steel-800/30' : ''}`}
      tabIndex={0}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={handleFocus}
    >
      {/* Endstop warning */}
      {anyBlocked && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-md">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-300">
            Endstop aktiv:{' '}
            {[
              blocked.xPlus || blocked.xMinus ? `${isRobotArm ? 'J1' : 'X'}` : null,
              blocked.yPlus || blocked.yMinus ? `${isRobotArm ? 'J2' : 'Y'}` : null,
              blocked.zPlus || blocked.zMinus ? `${isRobotArm ? 'J3' : 'Z'}` : null,
            ].filter(Boolean).join(', ')}
          </span>
        </div>
      )}
      
      {/* XY Controls */}
      <div className="flex items-center gap-8">
        {/* XY Pad */}
        <div className="grid grid-cols-3 gap-1">
          <div />
          <JogButton
            onJog={handleJog}
            axis="Y"
            direction={1}
            icon={ArrowUp}
            title={`Y+ (Arrow Up)${isRobotArm ? ' - J2 vall' : ''}`}
            isBlocked={blocked.yPlus}
          />
          <div />
          
          <JogButton
            onJog={handleJog}
            axis="X"
            direction={-1}
            icon={ArrowLeft}
            title={`X- (Arrow Left)${isRobotArm ? ' - J1 bazis' : ''}`}
            isBlocked={blocked.xMinus}
          />
          <button
            onClick={handleHome}
            className="btn-icon bg-machine-600/20 hover:bg-machine-600/30 text-machine-400 p-3"
            title="Home"
          >
            <Home className="w-5 h-5" />
          </button>
          <JogButton
            onJog={handleJog}
            axis="X"
            direction={1}
            icon={ArrowRight}
            title={`X+ (Arrow Right)${isRobotArm ? ' - J1 bazis' : ''}`}
            isBlocked={blocked.xPlus}
          />
          
          <div />
          <JogButton
            onJog={handleJog}
            axis="Y"
            direction={-1}
            icon={ArrowDown}
            title={`Y- (Arrow Down)${isRobotArm ? ' - J2 vall' : ''}`}
            isBlocked={blocked.yMinus}
          />
          <div />
        </div>
        
        {/* Z Controls */}
        <div className="flex flex-col gap-1">
          <JogButton
            onJog={handleJog}
            axis="Z"
            direction={1}
            icon={ChevronUp}
            title={`Z+ (Page Up)${isRobotArm ? ' - J3 konyok' : ''}`}
            isBlocked={blocked.zPlus}
          />
          <div className="px-3 py-2 bg-steel-800/50 rounded text-center text-sm text-steel-400">
            {isRobotArm ? 'J3' : 'Z'}
          </div>
          <JogButton
            onJog={handleJog}
            axis="Z"
            direction={-1}
            icon={ChevronDown}
            title={`Z- (Page Down)${isRobotArm ? ' - J3 konyok' : ''}`}
            isBlocked={blocked.zMinus}
          />
        </div>
      </div>
      
      {/* Step Size */}
      <div className="space-y-2">
        <label className="text-sm text-steel-400">Lepeskoz</label>
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
              {size}{unit}
            </button>
          ))}
        </div>
      </div>
      
      {/* Feed Rate */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-steel-400">Sebesseg</label>
          <span className="text-sm text-steel-300">{feedRate}{feedRateUnit}</span>
        </div>
        <input
          type="range"
          min={feedRateMin}
          max={feedRateMax}
          step={feedRateStep}
          value={feedRate}
          onChange={(e) => setFeedRate(Number(e.target.value))}
          className="w-full h-2 bg-steel-800 rounded-lg appearance-none cursor-pointer"
        />
      </div>
      
      {/* Keyboard hints */}
      <div className="text-xs text-steel-500 space-y-1">
        {isActive ? (
          <>
            <p className="text-machine-400">Billentyuzet aktiv</p>
            <p>&#8592; &#8594; &#8593; &#8595; {isRobotArm ? 'J1/J2' : 'XY'} mozgas, Page Up/Down {isRobotArm ? 'J3' : 'Z'} mozgas</p>
            <p>ESC: Leallitas</p>
          </>
        ) : (
          <p>Kattints ide a billentyuzet vezerles aktivalasahoz</p>
        )}
      </div>
    </div>
  )
}
