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
import type { DeviceType, DeviceStatus, DeviceCapabilities } from '../../types/device'

interface Props {
  deviceId: string
  deviceType?: DeviceType
  status?: DeviceStatus
  capabilities?: DeviceCapabilities
  useSoftLimits?: boolean
  jogMode?: JogMode
  onJogModeChange?: (mode: JogMode) => void
  feedRate?: number
  onFeedRateChange?: (rate: number) => void
}

export type JogMode = 'step' | 'continuous'
export type MotionMode = 'jog' | 'cartesian'

interface JogButtonProps {
  onJogStart: (axis: string, direction: number) => void
  onJogStop: () => void
  axis: string
  direction: number
  icon: React.ComponentType<{ className?: string }>
  title: string
  isBlocked: boolean
  jogMode: JogMode
}

function JogButton({ 
  onJogStart, 
  onJogStop, 
  axis, 
  direction, 
  icon: Icon, 
  title, 
  isBlocked,
  jogMode,
}: JogButtonProps) {
  // Track if THIS button is currently pressed (for continuous mode)
  const isPressedRef = useRef(false)

  // Step mode: simple click
  const handleClick = useCallback(() => {
    if (jogMode === 'step' && !isBlocked) {
      onJogStart(axis, direction)
    }
  }, [jogMode, axis, direction, isBlocked, onJogStart])

  // Continuous mode: mousedown starts movement
  const handleMouseDown = useCallback(() => {
    if (jogMode === 'continuous' && !isBlocked) {
      isPressedRef.current = true
      onJogStart(axis, direction)
    }
  }, [jogMode, axis, direction, isBlocked, onJogStart])

  // Continuous mode: mouseup stops movement only if THIS button was pressed
  const handleMouseUp = useCallback(() => {
    if (jogMode === 'continuous' && isPressedRef.current) {
      isPressedRef.current = false
      onJogStop()
    }
  }, [jogMode, onJogStop])

  // Continuous mode: mouseleave stops movement only if THIS button was pressed
  const handleMouseLeave = useCallback(() => {
    if (jogMode === 'continuous' && isPressedRef.current) {
      isPressedRef.current = false
      onJogStop()
    }
  }, [jogMode, onJogStop])

  return (
    <button
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
      disabled={isBlocked}
      tabIndex={-1}
      className={`btn-icon p-3 select-none ${
        isBlocked 
          ? 'bg-red-900/30 text-red-400/50 cursor-not-allowed border border-red-500/20' 
          : 'bg-steel-800 hover:bg-steel-700 active:bg-machine-600'
      }`}
      title={isBlocked ? `${title} - ENDSTOP` : title}
    >
      <Icon className="w-5 h-5" />
    </button>
  )
}

export default function JogControl({ 
  deviceId, 
  deviceType, 
  status, 
  capabilities,
  useSoftLimits = true,
  jogMode: controlledJogMode,
  onJogModeChange,
  feedRate: controlledFeedRate,
  onFeedRateChange,
}: Props) {
  const { jog, jogStart, jogBeat, jogStop, sendCommand } = useDeviceStore()
  
  const isRobotArm = deviceType === 'robot_arm'
  
  const [internalJogMode, setInternalJogMode] = useState<JogMode>('continuous')
  const jogMode = controlledJogMode ?? internalJogMode
  // Keep for uncontrolled mode support
  const _setJogMode = onJogModeChange ?? setInternalJogMode
  void _setJogMode
  const [motionMode, setMotionMode] = useState<MotionMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`jog-settings-${deviceId}`)
      if (saved) {
        try {
          const settings = JSON.parse(saved)
          if (settings.motionMode === 'jog' || settings.motionMode === 'cartesian') {
            return settings.motionMode
          }
        } catch {}
      }
    }
    return 'jog'
  })
  
  const unit = isRobotArm ? '°' : ' mm'
  const feedRateMin = isRobotArm ? 1 : 100
  const feedRateMax = capabilities?.max_feed_rate ?? (isRobotArm ? 100 : 5000)
  const feedRateStep = isRobotArm ? 1 : 100
  const feedRateUnit = isRobotArm ? '' : ' mm/min'
  
  const maxWorkEnvelope = Math.max(
    capabilities?.work_envelope?.x ?? 300,
    capabilities?.work_envelope?.y ?? 300,
    capabilities?.work_envelope?.z ?? 100
  )
  const stepSizeMax = Math.min(maxWorkEnvelope, isRobotArm ? 180 : 500)
  
  const [stepSize, setStepSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`jog-settings-${deviceId}`)
      if (saved) {
        try {
          const settings = JSON.parse(saved)
          if (typeof settings.stepSize === 'number' && settings.stepSize > 0) {
            return settings.stepSize
          }
        } catch {}
      }
    }
    return 10
  })
  const [internalFeedRate, setInternalFeedRate] = useState(() => {
    const defaultRate = isRobotArm ? 50 : 1000
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`jog-settings-${deviceId}`)
      if (saved) {
        try {
          const settings = JSON.parse(saved)
          if (typeof settings.feedRate === 'number' && settings.feedRate > 0) {
            return settings.feedRate
          }
        } catch {}
      }
    }
    return defaultRate
  })
  const feedRate = controlledFeedRate ?? internalFeedRate
  const setFeedRate = onFeedRateChange ?? setInternalFeedRate
  const [isActive, setIsActive] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // Track pressed keys for keyboard support - must persist across useEffect re-runs
  const activeKeysRef = useRef<Set<string>>(new Set())
  // Track active jogging axis for keyboard support
  
  // Save settings to local storage
  useEffect(() => {
    const settings = {
      motionMode: isRobotArm ? motionMode : undefined,
      feedRate,
      stepSize,
    }
    localStorage.setItem(`jog-settings-${deviceId}`, JSON.stringify(settings))
  }, [motionMode, feedRate, stepSize, deviceId, isRobotArm])
  const activeJogAxisRef = useRef<string | null>(null)
  const chunkTimerRef = useRef<number | null>(null)
  const heartbeatTimerRef = useRef<number | null>(null)
  const activeStreamingRef = useRef<boolean>(false)
  const activeDirectionRef = useRef<number>(0)
  const supportsStreamingJog = capabilities?.supports_streaming_jog === true
  const supportsHardJogStop = capabilities?.supports_hard_jog_stop === true
  
  // Endstop-based blocking
  const blocked = useMemo(() => {
    if (!useSoftLimits) {
      return { xPlus: false, xMinus: false, yPlus: false, yMinus: false, zPlus: false, zMinus: false }
    }
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
  }, [status?.endstop_blocked, useSoftLimits])
  
  const anyBlocked = Object.values(blocked).some(v => v)

  const getAxisLabels = useCallback(() => {
    if (!isRobotArm) {
      return { x: 'X', y: 'Y', z: 'Z' }
    }
    switch (motionMode) {
      case 'cartesian':
        return { x: 'X', y: 'Y', z: 'Z' }
      case 'jog':
      default:
        return { x: 'X', y: 'Y', z: 'Z' }
    }
  }, [isRobotArm, motionMode])

  const axisLabels = getAxisLabels()
  
  // Stop jog - sends actual stop command to backend
  const stopContinuousJog = useCallback(() => {
    if (!activeJogAxisRef.current && !activeStreamingRef.current) {
      return
    }
    const wasStreaming = activeStreamingRef.current
    if (chunkTimerRef.current !== null) {
      window.clearInterval(chunkTimerRef.current)
      chunkTimerRef.current = null
    }
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
    activeJogAxisRef.current = null
    activeDirectionRef.current = 0
    // Streaming jog végén normál stopot kérünk; hard stop csak nem-streaming fallbacknél marad.
    const useHardStop = !wasStreaming && supportsHardJogStop
    jogStop(deviceId, useHardStop)
    activeStreamingRef.current = false
  }, [deviceId, jogStop, supportsHardJogStop])
  
  // Start jog - handles both step and continuous modes
  const startJog = useCallback((axis: string, direction: number) => {
    const modeToSend = isRobotArm ? motionMode : undefined
    
    if (jogMode === 'step') {
      // Step mode: single small distance jog command
      const distance = stepSize * direction
      jog(deviceId, axis, distance, feedRate, modeToSend)
    } else {
      const beatMs = 80
      if (chunkTimerRef.current !== null) {
        window.clearInterval(chunkTimerRef.current)
        chunkTimerRef.current = null
      }
      if (heartbeatTimerRef.current !== null) {
        window.clearInterval(heartbeatTimerRef.current)
        heartbeatTimerRef.current = null
      }

      activeJogAxisRef.current = axis
      activeDirectionRef.current = direction
      activeStreamingRef.current = supportsStreamingJog

      if (supportsStreamingJog) {
        jogStart(deviceId, axis, direction, feedRate, modeToSend, 0.7, 70)
        heartbeatTimerRef.current = window.setInterval(() => {
          if (activeJogAxisRef.current !== axis || activeDirectionRef.current !== direction) return
          jogBeat(deviceId, axis, direction, feedRate, modeToSend)
        }, beatMs)
        return
      }

      // Fallback: slice-based jog for non-streaming firmware.
      const distancePerSecond = feedRate / 60
      const stepDistance = Math.max(0.2, Math.min(5, distancePerSecond * (beatMs / 1000)))

      const sendTick = () => {
        if (activeJogAxisRef.current !== axis || activeDirectionRef.current !== direction) return
        jog(deviceId, axis, stepDistance * direction, feedRate, modeToSend)
      }

      sendTick()
      chunkTimerRef.current = window.setInterval(sendTick, beatMs)
    }
  }, [
    deviceId,
    stepSize,
    feedRate,
    jog,
    jogStart,
    jogBeat,
    jogMode,
    isRobotArm,
    motionMode,
    supportsStreamingJog,
  ])
  
  const handleHome = useCallback(() => {
    sendCommand(deviceId, 'home')
  }, [deviceId, sendCommand])
  
  const handleFocus = useCallback(() => setIsActive(true), [])
  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsActive(false)
    }
  }, [])
  
  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      
      const key = e.key
      
      // In continuous mode: ignore key repeat events (one press = start, release = stop)
      // In step mode: allow key repeat for repeated steps (holding = repeated steps)
      if (jogMode === 'continuous') {
        if (e.repeat) return
        if (activeKeysRef.current.has(key)) return
      }
      
      switch (key) {
        case 'ArrowUp':
          e.preventDefault()
          if (!blocked.yPlus) {
            activeKeysRef.current.add(key)
            startJog('Y', 1)
          }
          break
        case 'ArrowDown':
          e.preventDefault()
          if (!blocked.yMinus) {
            activeKeysRef.current.add(key)
            startJog('Y', -1)
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (!blocked.xMinus) {
            activeKeysRef.current.add(key)
            startJog('X', -1)
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (!blocked.xPlus) {
            activeKeysRef.current.add(key)
            startJog('X', 1)
          }
          break
        case 'PageUp':
          e.preventDefault()
          if (!blocked.zPlus) {
            activeKeysRef.current.add(key)
            startJog('Z', 1)
          }
          break
        case 'PageDown':
          e.preventDefault()
          if (!blocked.zMinus) {
            activeKeysRef.current.add(key)
            startJog('Z', -1)
          }
          break
        case 'Escape':
          e.preventDefault()
          stopContinuousJog()
          break
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isActive) return
      
      const key = e.key
      if (!activeKeysRef.current.has(key)) return
      
      activeKeysRef.current.delete(key)
      
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(key)) {
        e.preventDefault()
        if (jogMode === 'continuous') {
          stopContinuousJog()
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [startJog, stopContinuousJog, isActive, blocked, jogMode])

  // Safety net: if pointer/focus is lost while jogging, force stop.
  useEffect(() => {
    const forceStop = () => {
      if (activeJogAxisRef.current) {
        stopContinuousJog()
      }
    }

    window.addEventListener('mouseup', forceStop)
    window.addEventListener('touchend', forceStop)
    window.addEventListener('blur', forceStop)
    document.addEventListener('visibilitychange', forceStop)

    return () => {
      window.removeEventListener('mouseup', forceStop)
      window.removeEventListener('touchend', forceStop)
      window.removeEventListener('blur', forceStop)
      document.removeEventListener('visibilitychange', forceStop)
      if (chunkTimerRef.current !== null) {
        window.clearInterval(chunkTimerRef.current)
        chunkTimerRef.current = null
      }
      if (heartbeatTimerRef.current !== null) {
        window.clearInterval(heartbeatTimerRef.current)
        heartbeatTimerRef.current = null
      }
    }
  }, [stopContinuousJog])
  
  return (
    <div 
      ref={containerRef}
      className={`space-y-4 p-2 rounded-lg transition-colors ${isActive ? 'ring-2 ring-machine-500/50 bg-steel-800/30' : ''}`}
      tabIndex={0}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={handleFocus}
    >
      {/* Motion Mode Tabs - Only for robot arm */}
      {isRobotArm && (
        <div className="flex border-b border-steel-700">
          <button
            onClick={() => setMotionMode('jog')}
            title="Csukló szögek direkt vezérlés (X/Y/Z fokban)"
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              motionMode === 'jog'
                ? 'text-machine-400 border-b-2 border-machine-500 -mb-px'
                : 'text-steel-400 hover:text-steel-200'
            }`}
          >
            Jog
          </button>
          <button
            onClick={() => setMotionMode('cartesian')}
            title="X/Y/Z koordináták mm-ben (IK számítás)"
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              motionMode === 'cartesian'
                ? 'text-machine-400 border-b-2 border-machine-500 -mb-px'
                : 'text-steel-400 hover:text-steel-200'
            }`}
          >
            Cartesian
          </button>
        </div>
      )}

      {/* Axis Controls */}
      <div className="flex items-center gap-8">
        {/* XY Pad */}
        <div className="grid grid-cols-3 gap-1">
          <div />
          <JogButton
            onJogStart={startJog}
            onJogStop={stopContinuousJog}
            axis="Y"
            direction={1}
            icon={ArrowUp}
            title={`${axisLabels.y}+ (Arrow Up)`}
            isBlocked={blocked.yPlus}
            jogMode={jogMode}
          />
          <div />
          
          <JogButton
            onJogStart={startJog}
            onJogStop={stopContinuousJog}
            axis="X"
            direction={-1}
            icon={ArrowLeft}
            title={`${axisLabels.x}- (Arrow Left)`}
            isBlocked={blocked.xMinus}
            jogMode={jogMode}
          />
          <button
            onClick={handleHome}
            tabIndex={-1}
            className="btn-icon bg-machine-600/20 hover:bg-machine-600/30 text-machine-400 p-3"
            title="Home"
          >
            <Home className="w-5 h-5" />
          </button>
          <JogButton
            onJogStart={startJog}
            onJogStop={stopContinuousJog}
            axis="X"
            direction={1}
            icon={ArrowRight}
            title={`${axisLabels.x}+ (Arrow Right)`}
            isBlocked={blocked.xPlus}
            jogMode={jogMode}
          />
          
          <div />
          <JogButton
            onJogStart={startJog}
            onJogStop={stopContinuousJog}
            axis="Y"
            direction={-1}
            icon={ArrowDown}
            title={`${axisLabels.y}- (Arrow Down)`}
            isBlocked={blocked.yMinus}
            jogMode={jogMode}
          />
          <div />
        </div>
        
        {/* Z Controls */}
        <div className="flex flex-col gap-1">
          <JogButton
            onJogStart={startJog}
            onJogStop={stopContinuousJog}
            axis="Z"
            direction={1}
            icon={ChevronUp}
            title={`${axisLabels.z}+ (Page Up)`}
            isBlocked={blocked.zPlus}
            jogMode={jogMode}
          />
          <div className="px-3 py-2 bg-steel-800/50 rounded text-center text-sm text-steel-400">
            {axisLabels.z}
          </div>
          <JogButton
            onJogStart={startJog}
            onJogStop={stopContinuousJog}
            axis="Z"
            direction={-1}
            icon={ChevronDown}
            title={`${axisLabels.z}- (Page Down)`}
            isBlocked={blocked.zMinus}
            jogMode={jogMode}
          />
        </div>
      </div>

      {/* Endstop warning - below buttons */}
      {useSoftLimits && anyBlocked && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-md">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-300">
            Endstop aktiv:{' '}
            {[
              blocked.xPlus || blocked.xMinus ? axisLabels.x : null,
              blocked.yPlus || blocked.yMinus ? axisLabels.y : null,
              blocked.zPlus || blocked.zMinus ? axisLabels.z : null,
            ].filter(Boolean).join(', ')}
          </span>
        </div>
      )}
      
      {/* Step Size - only shown in step mode */}
      {jogMode === 'step' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-steel-400">Lépésköz</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={stepSizeMax}
                step={1}
                value={Math.round(stepSize)}
                onChange={(e) => {
                  const val = Math.round(Number(e.target.value))
                  if (val >= 1 && val <= stepSizeMax) {
                    setStepSize(val)
                  }
                }}
                className="w-16 px-1 py-0.5 text-sm text-right bg-transparent border-0 text-steel-200 font-mono 
                  [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                  focus:bg-steel-800 focus:border focus:border-steel-600 focus:rounded focus:outline-none
                  focus:[appearance:auto] focus:[&::-webkit-outer-spin-button]:appearance-auto focus:[&::-webkit-inner-spin-button]:appearance-auto"
              />
              <span className="text-sm text-steel-400">{unit}</span>
            </div>
          </div>
          <input
            type="range"
            min={1}
            max={stepSizeMax}
            step={1}
            value={Math.round(stepSize)}
            onChange={(e) => setStepSize(Math.round(Number(e.target.value)))}
            className="w-full h-2 bg-steel-800 rounded-lg appearance-none cursor-pointer accent-machine-500"
          />
          <div className="flex justify-between text-xs text-steel-500">
            <span>1{unit}</span>
            <span>{stepSizeMax}{unit}</span>
          </div>
        </div>
      )}
      
      {/* Feed Rate */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-steel-400">Sebesség</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={feedRateMin}
              max={feedRateMax}
              step={feedRateStep}
              value={Math.round(feedRate)}
              onChange={(e) => {
                const val = Math.round(Number(e.target.value))
                if (val >= feedRateMin && val <= feedRateMax) {
                  setFeedRate(val)
                }
              }}
              className="w-20 px-1 py-0.5 text-sm text-right bg-transparent border-0 text-steel-200 font-mono 
                [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                focus:bg-steel-800 focus:border focus:border-steel-600 focus:rounded focus:outline-none
                focus:[appearance:auto] focus:[&::-webkit-outer-spin-button]:appearance-auto focus:[&::-webkit-inner-spin-button]:appearance-auto"
            />
            <span className="text-sm text-steel-400">{feedRateUnit}</span>
          </div>
        </div>
        <input
          type="range"
          min={feedRateMin}
          max={feedRateMax}
          step={feedRateStep}
          value={Math.round(feedRate)}
          onChange={(e) => setFeedRate(Math.round(Number(e.target.value)))}
          className="w-full h-2 bg-steel-800 rounded-lg appearance-none cursor-pointer accent-machine-500"
        />
        <div className="flex justify-between text-xs text-steel-500">
          <span>{feedRateMin}{feedRateUnit}</span>
          <span>{feedRateMax}{feedRateUnit}</span>
        </div>
      </div>

      
      {/* Keyboard hints */}
      <div className="text-xs text-steel-500 space-y-1">
        {isActive ? (
          <>
            <p className="text-machine-400">Billentyuzet aktiv</p>
            <p>&#8592; &#8594; &#8593; &#8595; {axisLabels.x}/{axisLabels.y} mozgas, Page Up/Down {axisLabels.z} mozgas</p>
            <p>ESC: Leallitas</p>
            {jogMode === 'continuous' && (
              <p className="text-orange-400">Folyamatos mod: tartsd nyomva a gombot</p>
            )}
          </>
        ) : (
          <p>Kattints ide a billentyuzet vezerles aktivalasahoz</p>
        )}
      </div>
    </div>
  )
}
