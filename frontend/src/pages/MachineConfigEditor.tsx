import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Download,
  Upload,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
  Settings2,
  Box,
  Move3D,
  Palette,
  Code,
  Layers,
  Camera,
} from 'lucide-react'
import { MachineVisualization } from '../components/visualization'
import RobotArmVisualization from '../components/visualization/RobotArmVisualization'
import type { CameraState } from '../components/visualization'
import type { MachineConfig, AxisConfig, AxisName, AxisType, MachineType } from '../types/machine-config'
import { DEFAULT_3AXIS_CNC, DEFAULT_5AXIS_CNC, getDefaultConfigForType } from '../types/machine-config'
import { useDeviceStore } from '../stores/deviceStore'

// Axis color options
const AXIS_COLORS: Record<AxisName, string> = {
  X: '#ef4444',
  Y: '#22c55e',
  Z: '#3b82f6',
  A: '#f59e0b',
  B: '#8b5cf6',
  C: '#ec4899',
  J1: '#ef4444',
  J2: '#22c55e',
  J3: '#3b82f6',
  J4: '#f59e0b',
  J5: '#8b5cf6',
  J6: '#ec4899',
}

// Default axis configs by name
const DEFAULT_AXIS_CONFIG: Record<AxisName, Partial<AxisConfig>> = {
  X: { type: 'linear', min: 0, max: 300, homePosition: 0 },
  Y: { type: 'linear', min: 0, max: 400, homePosition: 0 },
  Z: { type: 'linear', min: -80, max: 0, homePosition: 0 },
  A: { type: 'rotary', min: -90, max: 90, homePosition: 0 },
  B: { type: 'rotary', min: -180, max: 180, homePosition: 0 },
  C: { type: 'rotary', min: -180, max: 180, homePosition: 0 },
  J1: { type: 'rotary', min: -180, max: 180, homePosition: 0 },
  J2: { type: 'rotary', min: -90, max: 90, homePosition: 0 },
  J3: { type: 'rotary', min: -120, max: 120, homePosition: 0 },
  J4: { type: 'rotary', min: -180, max: 180, homePosition: 0 },
  J5: { type: 'rotary', min: -120, max: 120, homePosition: 0 },
  J6: { type: 'rotary', min: -360, max: 360, homePosition: 0 },
}

// Axis editor component
function AxisEditor({
  axis,
  allAxes,
  onChange,
  onDelete,
}: {
  axis: AxisConfig
  allAxes: AxisConfig[]
  onChange: (updated: AxisConfig) => void
  onDelete: () => void
}) {
  const possibleParents = allAxes.filter(a => a.name !== axis.name)

  return (
    <div className="bg-steel-800/50 rounded-lg p-4 border border-steel-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: axis.color }}
          >
            {axis.name}
          </div>
          <span className="font-medium text-white">
            {axis.name} tengely
            <span className="text-steel-400 text-sm ml-2">
              ({axis.type === 'linear' ? 'Lineáris' : 'Rotációs'})
            </span>
          </span>
        </div>
        <button
          onClick={onDelete}
          className="btn-icon text-red-400 hover:text-red-300 hover:bg-red-500/10"
          title="Tengely törlése"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Type */}
        <div>
          <label className="block text-xs text-steel-400 mb-1">Típus</label>
          <select
            value={axis.type}
            onChange={(e) => onChange({ ...axis, type: e.target.value as AxisType })}
            className="input w-full text-sm"
          >
            <option value="linear">Lineáris</option>
            <option value="rotary">Rotációs</option>
          </select>
        </div>

        {/* Min */}
        <div>
          <label className="block text-xs text-steel-400 mb-1">
            Min {axis.type === 'linear' ? '(mm)' : '(°)'}
          </label>
          <input
            type="number"
            value={axis.min}
            onChange={(e) => onChange({ ...axis, min: parseFloat(e.target.value) || 0 })}
            className="input w-full text-sm"
          />
        </div>

        {/* Max */}
        <div>
          <label className="block text-xs text-steel-400 mb-1">
            Max {axis.type === 'linear' ? '(mm)' : '(°)'}
          </label>
          <input
            type="number"
            value={axis.max}
            onChange={(e) => onChange({ ...axis, max: parseFloat(e.target.value) || 0 })}
            className="input w-full text-sm"
          />
        </div>

        {/* Home position */}
        <div>
          <label className="block text-xs text-steel-400 mb-1">Home pozíció</label>
          <input
            type="number"
            value={axis.homePosition}
            onChange={(e) => onChange({ ...axis, homePosition: parseFloat(e.target.value) || 0 })}
            className="input w-full text-sm"
          />
        </div>

        {/* Parent axis */}
        <div>
          <label className="block text-xs text-steel-400 mb-1">Szülő tengely</label>
          <select
            value={axis.parent ?? ''}
            onChange={(e) => onChange({ ...axis, parent: (e.target.value || undefined) as AxisName | undefined })}
            className="input w-full text-sm"
          >
            <option value="">Nincs (gyökér)</option>
            {possibleParents.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Color */}
        <div>
          <label className="block text-xs text-steel-400 mb-1">Szín</label>
          <input
            type="color"
            value={axis.color}
            onChange={(e) => onChange({ ...axis, color: e.target.value })}
            className="w-full h-8 rounded cursor-pointer"
          />
        </div>
      </div>
    </div>
  )
}

export default function MachineConfigEditor() {
  const { deviceId } = useParams<{ deviceId: string }>()
  
  // Get stable device info - only re-render when this specific device's static properties change
  const device = useDeviceStore(
    useCallback((state) => {
      const d = state.devices.find((dev) => dev.id === deviceId)
      if (!d) return null
      // Only return stable properties (not status which changes frequently)
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        capabilities: d.capabilities,
        connected: d.connected,
      }
    }, [deviceId]),
    // Custom equality function to prevent re-renders when status changes
    (a, b) => {
      if (a === null && b === null) return true
      if (a === null || b === null) return false
      return a.id === b.id && 
             a.name === b.name && 
             a.type === b.type && 
             a.connected === b.connected &&
             JSON.stringify(a.capabilities) === JSON.stringify(b.capabilities)
    }
  )
  
  // Get device list only for selector page - this only runs when no deviceId
  const devices = useDeviceStore(
    useCallback((state) => {
      // Return minimal stable data for device list
      return state.devices.map((dev) => ({
        id: dev.id,
        name: dev.name,
        type: dev.type,
        connected: dev.connected,
      }))
    }, []),
    // Custom equality - compare by stringified content
    (a, b) => JSON.stringify(a) === JSON.stringify(b)
  )

  // Config state
  const [config, setConfig] = useState<MachineConfig>(DEFAULT_3AXIS_CNC)
  const [originalConfig, setOriginalConfig] = useState<MachineConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const [editMode, setEditMode] = useState<'visual' | 'json'>('visual')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  // Preview position state (for testing)
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0, z: 0 })

  // Live camera state (from 3D view OrbitControls)
  const [liveCamera, setLiveCamera] = useState<CameraState | null>(null)

  // Handle camera change from 3D view
  const handleCameraChange = useCallback((state: CameraState) => {
    setLiveCamera(state)
  }, [])

  // Apply live camera to config
  const handleCaptureCameraView = useCallback(() => {
    if (liveCamera) {
      setConfig({
        ...config,
        visuals: {
          ...config.visuals,
          cameraPosition: liveCamera.position,
          cameraTarget: liveCamera.target,
        },
      })
      setSuccessMessage('Nézőpont rögzítve!')
      setTimeout(() => setSuccessMessage(null), 2000)
    }
  }, [config, liveCamera])

  // Load config on mount
  useEffect(() => {
    async function loadConfig() {
      if (!deviceId) return

      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/devices/${deviceId}/machine-config`)
        if (response.ok) {
          const data = await response.json()
          setConfig(data)
          setOriginalConfig(data)
        } else {
          // Use default based on device capabilities (5+ axes)
          const is5Axis = (device?.capabilities?.axes?.length ?? 0) >= 5
          const defaultConfig = is5Axis 
            ? { ...DEFAULT_5AXIS_CNC, id: deviceId } 
            : { ...DEFAULT_3AXIS_CNC, id: deviceId }

          if (device) {
            defaultConfig.name = device.name
          }

          setConfig(defaultConfig)
          setOriginalConfig(null)
        }
      } catch (err) {
        console.error('Failed to load config:', err)
        const defaultConfig = { ...DEFAULT_3AXIS_CNC, id: deviceId ?? 'new' }
        setConfig(defaultConfig)
      } finally {
        setLoading(false)
      }
    }

    loadConfig()
  }, [deviceId, device])

  // Check if config has changes
  const hasChanges = useMemo(() => {
    if (!originalConfig) return true
    return JSON.stringify(config) !== JSON.stringify(originalConfig)
  }, [config, originalConfig])

  // Save config
  const handleSave = async () => {
    if (!deviceId) {
      setError('Nincs kiválasztva eszköz')
      return
    }

    setSaving(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await fetch(`/api/devices/${deviceId}/machine-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      if (response.ok) {
        setOriginalConfig(config)
        setSuccessMessage('Konfiguráció sikeresen mentve!')
        setTimeout(() => setSuccessMessage(null), 3000)
      } else {
        const data = await response.json()
        setError(data.error || 'Mentés sikertelen')
      }
    } catch (err) {
      console.error('Save error:', err)
      setError('Mentés sikertelen - szerver hiba')
    } finally {
      setSaving(false)
    }
  }

  // Reset to original
  const handleReset = () => {
    if (originalConfig) {
      setConfig(originalConfig)
    } else {
      setConfig(DEFAULT_3AXIS_CNC)
    }
  }

  // Add new axis
  const handleAddAxis = () => {
    const existingNames = config.axes.map((a) => a.name)
    const availableNames: AxisName[] = ['X', 'Y', 'Z', 'A', 'B', 'C']
    const nextName = availableNames.find((n) => !existingNames.includes(n))

    if (!nextName) {
      setError('Maximum 6 tengely támogatott')
      return
    }

    const defaults = DEFAULT_AXIS_CONFIG[nextName]
    const lastAxis = config.axes[config.axes.length - 1]

    const newAxis: AxisConfig = {
      name: nextName,
      type: defaults.type ?? 'linear',
      min: defaults.min ?? 0,
      max: defaults.max ?? 100,
      homePosition: defaults.homePosition ?? 0,
      color: AXIS_COLORS[nextName],
      parent: lastAxis?.name,
    }

    setConfig({
      ...config,
      axes: [...config.axes, newAxis],
    })
  }

  // Update axis
  const handleUpdateAxis = (index: number, updated: AxisConfig) => {
    const newAxes = [...config.axes]
    newAxes[index] = updated
    setConfig({ ...config, axes: newAxes })
  }

  // Delete axis
  const handleDeleteAxis = (index: number) => {
    const axisName = config.axes[index].name
    // Also update any children that referenced this axis
    const newAxes = config.axes
      .filter((_, i) => i !== index)
      .map((a) => (a.parent === axisName ? { ...a, parent: undefined } : a))

    setConfig({ ...config, axes: newAxes })
  }

  // Export config
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${config.id}_config.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Import config
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string)
        // Validate basic structure
        if (imported.id && imported.axes && imported.workEnvelope) {
          setConfig({ ...imported, id: deviceId ?? imported.id })
          setSuccessMessage('Konfiguráció importálva!')
          setTimeout(() => setSuccessMessage(null), 3000)
        } else {
          setError('Érvénytelen konfiguráció formátum')
        }
      } catch {
        setError('Hibás JSON fájl')
      }
    }
    reader.readAsText(file)
  }

  // Load preset
  const handleLoadPreset = (preset: '3axis' | '5axis') => {
    const baseConfig = preset === '5axis' ? DEFAULT_5AXIS_CNC : DEFAULT_3AXIS_CNC
    setConfig({
      ...baseConfig,
      id: deviceId ?? config.id,
      name: config.name,
    })
  }

  // Device selector when no deviceId provided
  if (!deviceId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Gép Konfiguráció</h1>
          <p className="text-steel-400">Válassz egy eszközt a konfiguráció szerkesztéséhez</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.length > 0 ? (
            devices.map((dev) => (
              <Link
                key={dev.id}
                to={`/machine-config/${dev.id}`}
                className="card hover:border-machine-500/50 transition-colors group"
              >
                <div className="card-body">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-machine-500/20 rounded-lg flex items-center justify-center group-hover:bg-machine-500/30 transition-colors">
                      <Box className="w-6 h-6 text-machine-400" />
                    </div>
                    <div>
                      <h3 className="font-medium text-white">{dev.name}</h3>
                      <p className="text-sm text-steel-400">{dev.type}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span className={`${dev.connected ? 'text-green-400' : 'text-steel-500'}`}>
                      {dev.connected ? 'Kapcsolódva' : 'Nincs kapcsolat'}
                    </span>
                    <span className="text-machine-400 group-hover:text-machine-300">
                      Szerkesztés →
                    </span>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="col-span-full text-center py-12 text-steel-400">
              <Box className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>Nincsenek elérhető eszközök</p>
              <p className="text-sm mt-1">Csatlakoztass egy eszközt a Dashboard-on</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-steel-400">Konfiguráció betöltése...</div>
      </div>
    )
  }

  // Egységes kamera alapértékek (a value és onChange fallback-ek konzisztensek legyenek)
  const defaultCameraPosition = {
    x: Math.round(config.workEnvelope.x / 2 + config.workEnvelope.x * 1.4),
    y: -Math.round(config.workEnvelope.y),
    z: Math.round(config.workEnvelope.z + 200),
  }
  const defaultCameraTarget = {
    x: Math.round(config.workEnvelope.x / 2),
    y: Math.round(config.workEnvelope.y / 2),
    z: 0,
  }
  const currentCameraPosition = {
    x: config.visuals?.cameraPosition?.x ?? defaultCameraPosition.x,
    y: config.visuals?.cameraPosition?.y ?? defaultCameraPosition.y,
    z: config.visuals?.cameraPosition?.z ?? defaultCameraPosition.z,
  }
  const currentCameraTarget = {
    x: config.visuals?.cameraTarget?.x ?? defaultCameraTarget.x,
    y: config.visuals?.cameraTarget?.y ?? defaultCameraTarget.y,
    z: config.visuals?.cameraTarget?.z ?? defaultCameraTarget.z,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to={deviceId ? `/device/${deviceId}` : '/'} className="btn-icon hover:bg-steel-800">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">
              {config.name || 'Gép Konfiguráció'}
            </h1>
            <p className="text-steel-400 flex items-center gap-2">
              <span className="text-xs bg-steel-700 text-steel-300 px-2 py-0.5 rounded">
                {config.type === 'cnc_mill' && 'CNC Maró'}
                {config.type === 'cnc_lathe' && 'CNC Eszterga'}
                {config.type === 'laser_cutter' && 'Lézervágó'}
                {config.type === '5axis' && '5 Tengelyes'}
                {config.type === 'robot_arm' && 'Robotkar'}
                {config.type === 'custom' && 'Egyedi'}
              </span>
              <span>•</span>
              <span>{config.axes.length} tengely</span>
              <span>•</span>
              <span>{config.workEnvelope.x}×{config.workEnvelope.y}×{config.workEnvelope.z} mm</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Edit Mode Toggle */}
          <div className="flex rounded-lg overflow-hidden border border-steel-700">
            <button
              onClick={() => {
                if (editMode === 'json') {
                  // Try to apply JSON changes when switching back to visual
                  try {
                    const parsed = JSON.parse(jsonText)
                    setConfig(parsed)
                    setJsonError(null)
                  } catch {
                    // Keep JSON mode if parsing fails
                    setJsonError('Érvénytelen JSON - javítsd a hibát mielőtt visszaváltasz')
                    return
                  }
                }
                setEditMode('visual')
              }}
              className={`px-3 py-1.5 flex items-center gap-1.5 text-sm ${
                editMode === 'visual' ? 'bg-machine-600 text-white' : 'bg-steel-800 text-steel-400 hover:text-white'
              }`}
            >
              <Layers className="w-4 h-4" />
              Vizuális
            </button>
            <button
              onClick={() => {
                setJsonText(JSON.stringify(config, null, 2))
                setJsonError(null)
                setEditMode('json')
              }}
              className={`px-3 py-1.5 flex items-center gap-1.5 text-sm ${
                editMode === 'json' ? 'bg-machine-600 text-white' : 'bg-steel-800 text-steel-400 hover:text-white'
              }`}
            >
              <Code className="w-4 h-4" />
              JSON
            </button>
          </div>

          {/* Import/Export */}
          <label className="btn btn-secondary flex items-center gap-2 cursor-pointer">
            <Upload className="w-4 h-4" />
            Import
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
          <button onClick={handleExport} className="btn btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export
          </button>

          {/* Reset */}
          <button
            onClick={handleReset}
            disabled={!hasChanges}
            className="btn btn-secondary flex items-center gap-2 disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" />
            Visszaállítás
          </button>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Mentés...' : 'Mentés'}
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2 text-red-400">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2 text-green-400">
          <CheckCircle className="w-4 h-4" />
          {successMessage}
        </div>
      )}

      {/* JSON Error */}
      {jsonError && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-2 text-amber-400">
          <AlertCircle className="w-4 h-4" />
          {jsonError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Config editor */}
        <div className="space-y-6">
          {/* JSON Editor Mode */}
          {editMode === 'json' ? (
            <div className="card">
              <div className="card-header flex items-center gap-2">
                <Code className="w-4 h-4 text-steel-400" />
                <span className="font-medium">JSON Konfiguráció</span>
              </div>
              <div className="card-body p-0">
                <textarea
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value)
                    // Try to parse to validate
                    try {
                      JSON.parse(e.target.value)
                      setJsonError(null)
                    } catch {
                      setJsonError('Érvénytelen JSON szintaxis')
                    }
                  }}
                  className="w-full h-[600px] bg-steel-900 text-steel-100 font-mono text-sm p-4 resize-none focus:outline-none focus:ring-1 focus:ring-machine-500"
                  spellCheck={false}
                />
              </div>
              <div className="card-footer flex justify-end gap-2">
                <button
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(jsonText)
                      setConfig(parsed)
                      setJsonError(null)
                      setSuccessMessage('JSON konfiguráció alkalmazva!')
                      setTimeout(() => setSuccessMessage(null), 2000)
                    } catch {
                      setJsonError('Érvénytelen JSON - nem lehet alkalmazni')
                    }
                  }}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  Alkalmaz
                </button>
              </div>
            </div>
          ) : (
            <>
          {/* Basic info */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-steel-400" />
              <span className="font-medium">Alapadatok</span>
            </div>
            <div className="card-body space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-steel-400 mb-1">Gép neve</label>
                  <input
                    type="text"
                    value={config.name}
                    onChange={(e) => setConfig({ ...config, name: e.target.value })}
                    className="input w-full"
                    placeholder="CNC Maró"
                  />
                </div>
                <div>
                  <label className="block text-sm text-steel-400 mb-1">Típus</label>
                  <select
                    value={config.type}
                    onChange={(e) => {
                      const newType = e.target.value as MachineType
                      const baseConfig = getDefaultConfigForType(newType)
                      // Keep current id and name, apply new type's configuration
                      setConfig({
                        ...baseConfig,
                        id: config.id,
                        name: config.name || baseConfig.name,
                        type: newType,
                      })
                    }}
                    className="input w-full"
                  >
                    <option value="cnc_mill">CNC Maró</option>
                    <option value="cnc_lathe">CNC Eszterga</option>
                    <option value="laser_cutter">Lézervágó</option>
                    <option value="5axis">5 Tengelyes</option>
                    <option value="robot_arm">Robotkar</option>
                    <option value="custom">Egyedi</option>
                  </select>
                </div>
              </div>

              {/* Presets */}
              <div>
                <label className="block text-sm text-steel-400 mb-1">Gyors sablonok</label>
                <div className="flex gap-2">
                  <button onClick={() => handleLoadPreset('3axis')} className="btn btn-secondary btn-sm">
                    3 tengelyes CNC
                  </button>
                  <button onClick={() => handleLoadPreset('5axis')} className="btn btn-secondary btn-sm">
                    5 tengelyes CNC
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Work envelope */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Box className="w-4 h-4 text-steel-400" />
              <span className="font-medium">Munkaterület (Work Envelope)</span>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-steel-400 mb-1">X (mm)</label>
                  <input
                    type="number"
                    value={config.workEnvelope.x}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        workEnvelope: { ...config.workEnvelope, x: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-steel-400 mb-1">Y (mm)</label>
                  <input
                    type="number"
                    value={config.workEnvelope.y}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        workEnvelope: { ...config.workEnvelope, y: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-steel-400 mb-1">Z (mm)</label>
                  <input
                    type="number"
                    value={config.workEnvelope.z}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        workEnvelope: { ...config.workEnvelope, z: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="input w-full"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Axes */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Move3D className="w-4 h-4 text-steel-400" />
                <span className="font-medium">Tengelyek ({config.axes.length})</span>
              </div>
              <button
                onClick={handleAddAxis}
                disabled={config.axes.length >= 6}
                className="btn btn-primary btn-sm flex items-center gap-1 disabled:opacity-50"
              >
                <Plus className="w-3 h-3" />
                Új tengely
              </button>
            </div>
            <div className="card-body space-y-4">
              {config.axes.map((axis, index) => (
                <AxisEditor
                  key={axis.name}
                  axis={axis}
                  allAxes={config.axes}
                  onChange={(updated) => handleUpdateAxis(index, updated)}
                  onDelete={() => handleDeleteAxis(index)}
                />
              ))}

              {config.axes.length === 0 && (
                <div className="text-center text-steel-500 py-8">
                  Nincs tengely definiálva. Adj hozzá legalább egyet!
                </div>
              )}
            </div>
          </div>

          {/* Spindle & Tool */}
          <div className="card">
            <div className="card-header">
              <span className="font-medium">Orsó és Szerszám</span>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm text-steel-400 mb-1">Orsó átmérő (mm)</label>
                  <input
                    type="number"
                    value={config.spindle?.diameter ?? 52}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        spindle: { ...config.spindle, maxRpm: config.spindle?.maxRpm ?? 24000, diameter: parseFloat(e.target.value) || 52 },
                      })
                    }
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-steel-400 mb-1">Orsó hossz (mm)</label>
                  <input
                    type="number"
                    value={config.spindle?.length ?? 80}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        spindle: { ...config.spindle, maxRpm: config.spindle?.maxRpm ?? 24000, length: parseFloat(e.target.value) || 80 },
                      })
                    }
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-steel-400 mb-1">Max RPM</label>
                  <input
                    type="number"
                    value={config.spindle?.maxRpm ?? 24000}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        spindle: { ...config.spindle, maxRpm: parseFloat(e.target.value) || 24000 },
                      })
                    }
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-steel-400 mb-1">Szerszám átmérő (mm)</label>
                  <input
                    type="number"
                    value={config.tool?.diameter ?? 6}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        tool: { ...config.tool, diameter: parseFloat(e.target.value) || 6, length: config.tool?.length ?? 30 },
                      })
                    }
                    className="input w-full"
                  />
                </div>
              </div>
            </div>
          </div>

            </>
          )}
        </div>

        {/* Right: 3D Preview */}
        <div className="space-y-4">
          <div className="card h-[600px]">
            <div className="card-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-blue-400" />
                <span className="font-medium">3D Előnézet</span>
              </div>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="btn-icon text-steel-400 hover:text-white"
              >
                {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="card-body p-0 h-[calc(100%-60px)]">
              {showPreview ? (
                config.type === 'robot_arm' ? (
                  <RobotArmVisualization
                    config={config}
                    position={previewPosition}
                    onCameraChange={handleCameraChange}
                  />
                ) : (
                  <MachineVisualization 
                    config={config} 
                    position={previewPosition}
                    onCameraChange={handleCameraChange}
                  />
                )
              ) : (
                <div className="flex items-center justify-center h-full text-steel-500">
                  Előnézet kikapcsolva
                </div>
              )}
            </div>
          </div>

          {/* Preview position controls */}
          <div className="card">
            <div className="card-header">
              <span className="font-medium">Teszt pozíció</span>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-steel-400 mb-1">X</label>
                  <input
                    type="range"
                    min={config.axes.find((a) => a.name === 'X')?.min ?? 0}
                    max={config.axes.find((a) => a.name === 'X')?.max ?? 300}
                    value={previewPosition.x}
                    onChange={(e) => setPreviewPosition({ ...previewPosition, x: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                  <div className="text-center text-xs text-steel-400">{previewPosition.x.toFixed(1)}</div>
                </div>
                <div>
                  <label className="block text-xs text-steel-400 mb-1">Y</label>
                  <input
                    type="range"
                    min={config.axes.find((a) => a.name === 'Y')?.min ?? 0}
                    max={config.axes.find((a) => a.name === 'Y')?.max ?? 400}
                    value={previewPosition.y}
                    onChange={(e) => setPreviewPosition({ ...previewPosition, y: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                  <div className="text-center text-xs text-steel-400">{previewPosition.y.toFixed(1)}</div>
                </div>
                <div>
                  <label className="block text-xs text-steel-400 mb-1">Z</label>
                  <input
                    type="range"
                    min={config.axes.find((a) => a.name === 'Z')?.min ?? -80}
                    max={config.axes.find((a) => a.name === 'Z')?.max ?? 0}
                    value={previewPosition.z}
                    onChange={(e) => setPreviewPosition({ ...previewPosition, z: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                  <div className="text-center text-xs text-steel-400">{previewPosition.z.toFixed(1)}</div>
                </div>
              </div>
              <button
                onClick={() => setPreviewPosition({ x: 0, y: 0, z: 0 })}
                className="btn btn-secondary btn-sm w-full mt-3"
              >
                Reset pozíció
              </button>
            </div>
          </div>

          {/* Visual Settings - moved under 3D preview */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Palette className="w-4 h-4 text-steel-400" />
              <span className="font-medium">Megjelenés</span>
            </div>
            <div className="card-body space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-steel-400 mb-1">Gépváz színe</label>
                  <input
                    type="color"
                    value={config.visuals?.frameColor ?? '#2d2d2d'}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        visuals: { ...config.visuals, frameColor: e.target.value },
                      })
                    }
                    className="w-full h-10 rounded cursor-pointer bg-steel-800 border border-steel-700"
                  />
                </div>
                <div>
                  <label className="block text-sm text-steel-400 mb-1">Háttérszín</label>
                  <input
                    type="color"
                    value={config.visuals?.backgroundColor ?? '#0a0a0f'}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        visuals: { ...config.visuals, backgroundColor: e.target.value },
                      })
                    }
                    className="w-full h-10 rounded cursor-pointer bg-steel-800 border border-steel-700"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.visuals?.showGrid ?? true}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        visuals: { ...config.visuals, showGrid: e.target.checked },
                      })
                    }
                    className="w-4 h-4 rounded bg-steel-800 border-steel-600"
                  />
                  <span className="text-sm text-steel-400">Rács</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.visuals?.showAxesHelper ?? true}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        visuals: { ...config.visuals, showAxesHelper: e.target.checked },
                      })
                    }
                    className="w-4 h-4 rounded bg-steel-800 border-steel-600"
                  />
                  <span className="text-sm text-steel-400">Tengely jelölők</span>
                </label>
              </div>

              {/* Joint Angle Scale (robot arm only) */}
              {config.type === 'robot_arm' && (
                <div className="border-t border-steel-700 pt-4">
                  <h4 className="text-sm font-medium text-steel-300 mb-3">Ízületi szög skálázás</h4>
                  <p className="text-xs text-steel-500 mb-3">
                    Ha a vizualizáció eltér a valós mozgástól, itt kalibrálható a firmware érték → fok szorzó ízületenként.
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-steel-500 mb-1">J1 (bázis)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={config.robotArm?.jointAngleScale?.j1 ?? 1}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            robotArm: {
                              ...config.robotArm!,
                              jointAngleScale: {
                                ...config.robotArm?.jointAngleScale,
                                j1: parseFloat(e.target.value) || 1,
                              },
                            },
                          })
                        }
                        className="input w-full text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-steel-500 mb-1">J2 (váll)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={config.robotArm?.jointAngleScale?.j2 ?? 1}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            robotArm: {
                              ...config.robotArm!,
                              jointAngleScale: {
                                ...config.robotArm?.jointAngleScale,
                                j2: parseFloat(e.target.value) || 1,
                              },
                            },
                          })
                        }
                        className="input w-full text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-steel-500 mb-1">J3 (könyök)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={config.robotArm?.jointAngleScale?.j3 ?? 1}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            robotArm: {
                              ...config.robotArm!,
                              jointAngleScale: {
                                ...config.robotArm?.jointAngleScale,
                                j3: parseFloat(e.target.value) || 1,
                              },
                            },
                          })
                        }
                        className="input w-full text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Camera settings */}
              <div className="border-t border-steel-700 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-steel-300">Alapértelmezett nézőpont</h4>
                  <button
                    onClick={handleCaptureCameraView}
                    disabled={!liveCamera}
                    className="btn btn-primary btn-sm flex items-center gap-1.5 disabled:opacity-50"
                    title="A 3D nézetben beállított nézőpont átvétele"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Nézőpont rögzítése
                  </button>
                </div>
                {liveCamera && (
                  <div className="text-xs text-steel-500 mb-2 bg-steel-800/50 rounded p-2">
                    Aktuális nézet: Kamera ({liveCamera.position.x}, {liveCamera.position.y}, {liveCamera.position.z}) → 
                    Cél ({liveCamera.target.x}, {liveCamera.target.y}, {liveCamera.target.z})
                  </div>
                )}
                <div className="grid grid-cols-4 gap-2 mb-2">
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Kamera X</label>
                    <input
                      type="number"
                      value={currentCameraPosition.x}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          visuals: {
                            ...config.visuals,
                            cameraPosition: {
                              ...currentCameraPosition,
                              x: parseFloat(e.target.value) || 0,
                            },
                          },
                        })
                      }
                      className="input w-full text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Kamera Y</label>
                    <input
                      type="number"
                      value={currentCameraPosition.y}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          visuals: {
                            ...config.visuals,
                            cameraPosition: {
                              ...currentCameraPosition,
                              y: parseFloat(e.target.value) || 0,
                            },
                          },
                        })
                      }
                      className="input w-full text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Kamera Z</label>
                    <input
                      type="number"
                      value={currentCameraPosition.z}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          visuals: {
                            ...config.visuals,
                            cameraPosition: {
                              ...currentCameraPosition,
                              z: parseFloat(e.target.value) || 0,
                            },
                          },
                        })
                      }
                      className="input w-full text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">FOV (°)</label>
                    <input
                      type="number"
                      min={10}
                      max={120}
                      value={config.visuals?.cameraFov ?? 40}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          visuals: { ...config.visuals, cameraFov: parseFloat(e.target.value) || 40 },
                        })
                      }
                      className="input w-full text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Cél X</label>
                    <input
                      type="number"
                      value={currentCameraTarget.x}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          visuals: {
                            ...config.visuals,
                            cameraTarget: {
                              ...currentCameraTarget,
                              x: parseFloat(e.target.value) || 0,
                            },
                          },
                        })
                      }
                      className="input w-full text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Cél Y</label>
                    <input
                      type="number"
                      value={currentCameraTarget.y}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          visuals: {
                            ...config.visuals,
                            cameraTarget: {
                              ...currentCameraTarget,
                              y: parseFloat(e.target.value) || 0,
                            },
                          },
                        })
                      }
                      className="input w-full text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Cél Z</label>
                    <input
                      type="number"
                      value={currentCameraTarget.z}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          visuals: {
                            ...config.visuals,
                            cameraTarget: {
                              ...currentCameraTarget,
                              z: parseFloat(e.target.value) || 0,
                            },
                          },
                        })
                      }
                      className="input w-full text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
