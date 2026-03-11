import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Download,
  Upload,
  AlertCircle,
  CheckCircle,
  Settings2,
  Box,
  Move3D,
  Palette,
  Code,
  Layers,
  Cpu,
  Power,
  Gauge,
} from 'lucide-react'
import { MachineVisualization } from '../visualization'
import RobotArmVisualization from '../visualization/RobotArmVisualization'
import CalibrationPanel from './CalibrationPanel'
import type { CameraState } from '../visualization'
import type { MachineConfig, AxisConfig, AxisName, AxisType, MachineType } from '../../types/machine-config'
import { DEFAULT_3AXIS_CNC, DEFAULT_5AXIS_CNC, getDefaultConfigForType } from '../../types/machine-config'
import type { DeviceCapabilities } from '../../types/device'

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

const DEFAULT_AXIS_CONFIG: Record<AxisName, Partial<AxisConfig>> = {
  X: { type: 'linear', min: 0, max: 300 },
  Y: { type: 'linear', min: 0, max: 400 },
  Z: { type: 'linear', min: -80, max: 0 },
  A: { type: 'rotary', min: -90, max: 90 },
  B: { type: 'rotary', min: -180, max: 180 },
  C: { type: 'rotary', min: -180, max: 180 },
  J1: { type: 'rotary', min: -180, max: 180 },
  J2: { type: 'rotary', min: -90, max: 90 },
  J3: { type: 'rotary', min: -120, max: 120 },
  J4: { type: 'rotary', min: -180, max: 180 },
  J5: { type: 'rotary', min: -120, max: 120 },
  J6: { type: 'rotary', min: -360, max: 360 },
}

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
    <div className="bg-steel-800/50 rounded-lg p-3 border border-steel-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: axis.color }}
          >
            {axis.name}
          </div>
          <span className="text-sm font-medium text-white">
            {axis.name}
            <span className="text-steel-400 text-xs ml-1">
              ({axis.type === 'linear' ? 'Lin.' : 'Rot.'})
            </span>
          </span>
        </div>
        <button
          onClick={onDelete}
          className="btn-icon text-red-400 hover:text-red-300 hover:bg-red-500/10"
          title="Tengely törlése"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Első sor: Min, Max, Scale */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-steel-500 mb-1">Min</label>
          <input
            type="number"
            value={axis.min}
            onChange={(e) => onChange({ ...axis, min: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-xs text-steel-500 mb-1">Max</label>
          <input
            type="number"
            value={axis.max}
            onChange={(e) => onChange({ ...axis, max: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-xs text-steel-500 mb-1">Scale</label>
          <input
            type="number"
            value={axis.scale ?? 1.0}
            onChange={(e) => onChange({ ...axis, scale: parseFloat(e.target.value) || 1.0 })}
            className="input w-full text-xs py-1"
            step={0.001}
            title="Firmware érték → fizikai egység szorzó"
          />
        </div>
      </div>

      {/* Második sor: Típus, Szülő, Invertálás */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
        <div>
          <label className="block text-xs text-steel-500 mb-1">Típus</label>
          <select
            value={axis.type}
            onChange={(e) => onChange({ ...axis, type: e.target.value as AxisType })}
            className="input w-full text-xs py-1"
          >
            <option value="linear">Lineáris</option>
            <option value="rotary">Rotációs</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-steel-500 mb-1">Szülő</label>
          <select
            value={axis.parent ?? ''}
            onChange={(e) => onChange({ ...axis, parent: (e.target.value || undefined) as AxisName | undefined })}
            className="input w-full text-xs py-1"
          >
            <option value="">Nincs</option>
            {possibleParents.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center sm:pt-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={axis.invert ?? false}
              onChange={(e) => onChange({ ...axis, invert: e.target.checked })}
              className="w-3 h-3 rounded bg-steel-700 border-steel-600"
            />
            <span className="text-xs text-steel-400">Invertálás</span>
          </label>
        </div>
      </div>
    </div>
  )
}

interface MachineConfigTabProps {
  deviceId: string
  deviceName?: string
  deviceType?: string
  capabilities?: DeviceCapabilities
}

export default function MachineConfigTab({ 
  deviceId, 
  deviceName,
  deviceType: _deviceType,
  capabilities 
}: MachineConfigTabProps) {
  const [config, setConfig] = useState<MachineConfig>(DEFAULT_3AXIS_CNC)
  const [originalConfig, setOriginalConfig] = useState<MachineConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [editMode, setEditMode] = useState<'visual' | 'json'>('visual')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0, z: 0 })
  const [liveCamera, setLiveCamera] = useState<CameraState | null>(null)

  const handleCameraChange = useCallback((state: CameraState) => {
    setLiveCamera(state)
  }, [])

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

  useEffect(() => {
    async function loadConfig() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/devices/${deviceId}/machine-config`)
        if (response.ok) {
          const data = await response.json()
          setConfig(data)
          setOriginalConfig(data)
        } else {
          const is5Axis = (capabilities?.axes?.length ?? 0) >= 5
          const defaultConfig = is5Axis 
            ? { ...DEFAULT_5AXIS_CNC, id: deviceId } 
            : { ...DEFAULT_3AXIS_CNC, id: deviceId }

          if (deviceName) {
            defaultConfig.name = deviceName
          }

          setConfig(defaultConfig)
          setOriginalConfig(null)
        }
      } catch (err) {
        console.error('Failed to load config:', err)
        const defaultConfig = { ...DEFAULT_3AXIS_CNC, id: deviceId }
        setConfig(defaultConfig)
      } finally {
        setLoading(false)
      }
    }

    loadConfig()
  }, [deviceId, deviceName, capabilities])

  const hasChanges = useMemo(() => {
    if (!originalConfig) return true
    return JSON.stringify(config) !== JSON.stringify(originalConfig)
  }, [config, originalConfig])

  const handleSave = async () => {
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
        
        // Hot reload: driver config újratöltése, hogy az új beállítások
        // (pl. tengely invertálás, scale, limitek) azonnal életbe lépjenek
        try {
          const reloadResponse = await fetch(`/api/devices/${deviceId}/reload-config`, {
            method: 'POST',
          })
          if (reloadResponse.ok) {
            setSuccessMessage('Konfiguráció mentve és alkalmazva!')
          } else {
            setSuccessMessage('Konfiguráció mentve (újraindítás szükséges az alkalmazáshoz)')
          }
        } catch {
          setSuccessMessage('Konfiguráció mentve (újraindítás szükséges az alkalmazáshoz)')
        }
        
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

  const handleReset = () => {
    if (originalConfig) {
      setConfig(originalConfig)
    } else {
      setConfig(DEFAULT_3AXIS_CNC)
    }
  }

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
      color: AXIS_COLORS[nextName],
      parent: lastAxis?.name,
    }

    setConfig({
      ...config,
      axes: [...config.axes, newAxis],
    })
  }

  const handleUpdateAxis = (index: number, updated: AxisConfig) => {
    const newAxes = [...config.axes]
    newAxes[index] = updated
    setConfig({ ...config, axes: newAxes })
  }

  const handleDeleteAxis = (index: number) => {
    const axisName = config.axes[index].name
    const newAxes = config.axes
      .filter((_, i) => i !== index)
      .map((a) => (a.parent === axisName ? { ...a, parent: undefined } : a))

    setConfig({ ...config, axes: newAxes })
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${config.id}_config.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string)
        if (imported.id && imported.axes && imported.workEnvelope) {
          setConfig({ ...imported, id: deviceId })
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

  const handleLoadPreset = (preset: '3axis' | '5axis') => {
    const baseConfig = preset === '5axis' ? DEFAULT_5AXIS_CNC : DEFAULT_3AXIS_CNC
    setConfig({
      ...baseConfig,
      id: deviceId,
      name: config.name,
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-steel-400">Konfiguráció betöltése...</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-steel-700">
            <button
              onClick={() => {
                if (editMode === 'json') {
                  try {
                    const parsed = JSON.parse(jsonText)
                    setConfig(parsed)
                    setJsonError(null)
                  } catch {
                    setJsonError('Érvénytelen JSON')
                    return
                  }
                }
                setEditMode('visual')
              }}
              className={`px-2 py-1 flex items-center gap-1 text-xs ${
                editMode === 'visual' ? 'bg-machine-600 text-white' : 'bg-steel-800 text-steel-400 hover:text-white'
              }`}
            >
              <Layers className="w-3 h-3" />
              Vizuális
            </button>
            <button
              onClick={() => {
                setJsonText(JSON.stringify(config, null, 2))
                setJsonError(null)
                setEditMode('json')
              }}
              className={`px-2 py-1 flex items-center gap-1 text-xs ${
                editMode === 'json' ? 'bg-machine-600 text-white' : 'bg-steel-800 text-steel-400 hover:text-white'
              }`}
            >
              <Code className="w-3 h-3" />
              JSON
            </button>
          </div>

          <label className="btn btn-secondary btn-sm flex items-center gap-1 cursor-pointer">
            <Upload className="w-3 h-3" />
            <span className="hidden sm:inline">Import</span>
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
          <button onClick={handleExport} className="btn btn-secondary btn-sm flex items-center gap-1">
            <Download className="w-3 h-3" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            disabled={!hasChanges}
            className="btn btn-secondary btn-sm flex items-center gap-1 disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3" />
            Visszaállítás
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="btn btn-primary btn-sm flex items-center gap-1 disabled:opacity-50"
          >
            <Save className="w-3 h-3" />
            {saving ? 'Mentés...' : 'Mentés'}
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-2 flex items-center gap-2 text-green-400 text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {successMessage}
        </div>
      )}
      {jsonError && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 flex items-center gap-2 text-amber-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {jsonError}
        </div>
      )}

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Config editor */}
        <div className="space-y-4">
          {editMode === 'json' ? (
            <div className="bg-steel-900 rounded-lg border border-steel-700">
              <textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value)
                  try {
                    JSON.parse(e.target.value)
                    setJsonError(null)
                  } catch {
                    setJsonError('Érvénytelen JSON szintaxis')
                  }
                }}
                className="w-full h-[400px] bg-transparent text-steel-100 font-mono text-xs p-3 resize-none focus:outline-none"
                spellCheck={false}
              />
              <div className="border-t border-steel-700 p-2 flex justify-end">
                <button
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(jsonText)
                      setConfig(parsed)
                      setJsonError(null)
                      setSuccessMessage('JSON alkalmazva!')
                      setTimeout(() => setSuccessMessage(null), 2000)
                    } catch {
                      setJsonError('Érvénytelen JSON')
                    }
                  }}
                  className="btn btn-primary btn-sm flex items-center gap-1"
                >
                  <CheckCircle className="w-3 h-3" />
                  Alkalmaz
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Basic info */}
              <div className="bg-steel-900/50 rounded-lg border border-steel-700 p-3 space-y-3">
                <div className="flex items-center gap-2 text-steel-300 text-sm font-medium">
                  <Settings2 className="w-4 h-4" />
                  Alapadatok
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Gép neve</label>
                    <input
                      type="text"
                      value={config.name}
                      onChange={(e) => setConfig({ ...config, name: e.target.value })}
                      className="input w-full text-sm"
                      placeholder="CNC Maró"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Típus</label>
                    <select
                      value={config.type}
                      onChange={(e) => {
                        const newType = e.target.value as MachineType
                        const baseConfig = getDefaultConfigForType(newType)
                        setConfig({
                          ...baseConfig,
                          id: config.id,
                          name: config.name || baseConfig.name,
                          type: newType,
                        })
                      }}
                      className="input w-full text-sm"
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
                <div className="flex gap-2">
                  <button onClick={() => handleLoadPreset('3axis')} className="btn btn-secondary btn-sm text-xs">
                    3 tengelyes
                  </button>
                  <button onClick={() => handleLoadPreset('5axis')} className="btn btn-secondary btn-sm text-xs">
                    5 tengelyes
                  </button>
                </div>
              </div>

              {/* Work envelope */}
              <div className="bg-steel-900/50 rounded-lg border border-steel-700 p-3 space-y-3">
                <div className="flex items-center gap-2 text-steel-300 text-sm font-medium">
                  <Box className="w-4 h-4" />
                  Munkaterület (mm)
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">X</label>
                    <input
                      type="number"
                      value={config.workEnvelope.x}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          workEnvelope: { ...config.workEnvelope, x: parseFloat(e.target.value) || 0 },
                        })
                      }
                      className="input w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Y</label>
                    <input
                      type="number"
                      value={config.workEnvelope.y}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          workEnvelope: { ...config.workEnvelope, y: parseFloat(e.target.value) || 0 },
                        })
                      }
                      className="input w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Z</label>
                    <input
                      type="number"
                      value={config.workEnvelope.z}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          workEnvelope: { ...config.workEnvelope, z: parseFloat(e.target.value) || 0 },
                        })
                      }
                      className="input w-full text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Axes */}
              <div className="bg-steel-900/50 rounded-lg border border-steel-700 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-steel-300 text-sm font-medium">
                    <Move3D className="w-4 h-4" />
                    Tengelyek ({config.axes.length})
                  </div>
                  <button
                    onClick={handleAddAxis}
                    disabled={config.axes.length >= 6}
                    className="btn btn-primary btn-sm flex items-center gap-1 disabled:opacity-50 text-xs"
                  >
                    <Plus className="w-3 h-3" />
                    Új
                  </button>
                </div>
                <div className="space-y-2 max-h-[800px] overflow-y-auto">
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
                    <div className="text-center text-steel-500 py-4 text-sm">
                      Nincs tengely definiálva
                    </div>
                  )}
                </div>
              </div>

              {/* Driver Settings */}
              <div className="bg-steel-900/50 rounded-lg border border-steel-700 p-3 space-y-3">
                <div className="flex items-center gap-2 text-steel-300 text-sm font-medium">
                  <Cpu className="w-4 h-4" />
                  Driver Beállítások
                </div>
                
                {/* Max Feed Rate */}
                <div>
                  <label className="block text-xs text-steel-500 mb-1">
                    Maximális előtolás ({config.type === 'robot_arm' ? 'fok/perc' : 'mm/perc'})
                  </label>
                  <input
                    type="number"
                    value={config.driverConfig?.maxFeedRate ?? 2000}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        driverConfig: {
                          ...config.driverConfig,
                          maxFeedRate: parseFloat(e.target.value) || 2000,
                        },
                      })
                    }
                    className="input w-full text-sm"
                    min={1}
                  />
                </div>

                {/* Home Position */}
                <div className="bg-steel-800/50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 text-steel-400 text-xs font-medium">
                    <Power className="w-3 h-3" />
                    Home Pozíció
                  </div>
                  <div>
                    <label className="block text-xs text-steel-500 mb-1">Mód</label>
                    <select
                      value={config.driverConfig?.homePosition?.mode ?? 'absolute'}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          driverConfig: {
                            ...config.driverConfig,
                            homePosition: {
                              ...config.driverConfig?.homePosition,
                              mode: e.target.value as 'absolute' | 'query',
                            },
                          },
                        })
                      }
                      className="input w-full text-sm"
                    >
                      <option value="absolute">Megadott pozíció</option>
                      <option value="query">Firmware lekérdezés</option>
                    </select>
                  </div>
                  {config.driverConfig?.homePosition?.mode === 'absolute' && (
                    <div className="grid grid-cols-3 gap-2">
                      {config.axes.map((axis) => (
                        <div key={axis.name}>
                          <label className="block text-xs text-steel-500 mb-1">{axis.name}</label>
                          <input
                            type="number"
                            value={config.driverConfig?.homePosition?.positions?.[axis.name] ?? 0}
                            onChange={(e) => {
                              const positions = { ...config.driverConfig?.homePosition?.positions }
                              positions[axis.name] = parseFloat(e.target.value) || 0
                              setConfig({
                                ...config,
                                driverConfig: {
                                  ...config.driverConfig,
                                  homePosition: {
                                    ...config.driverConfig?.homePosition,
                                    mode: config.driverConfig?.homePosition?.mode ?? 'absolute',
                                    positions,
                                  },
                                },
                              })
                            }}
                            className="input w-full text-xs py-1"
                            step={0.1}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Closed Loop Settings - robot_arm only */}
                {config.type === 'robot_arm' && (
                  <div className="bg-steel-800/50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-steel-400 text-xs font-medium">
                        <Gauge className="w-3 h-3" />
                        Closed Loop
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.driverConfig?.closedLoop?.enabled ?? false}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              driverConfig: {
                                ...config.driverConfig,
                                closedLoop: {
                                  ...config.driverConfig?.closedLoop,
                                  enabled: e.target.checked,
                                },
                              },
                            })
                          }
                          className="w-3 h-3 rounded bg-steel-700 border-steel-600"
                        />
                        <span className="text-xs text-steel-400">Engedélyezve</span>
                      </label>
                    </div>
                    {config.driverConfig?.closedLoop?.enabled && (
                      <>
                        <div>
                          <label className="block text-xs text-steel-500 mb-1">Driver típus</label>
                          <select
                            value={config.driverConfig?.closedLoop?.driverType ?? 'servo'}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                driverConfig: {
                                  ...config.driverConfig,
                                  closedLoop: {
                                    ...config.driverConfig?.closedLoop,
                                    enabled: true,
                                    driverType: e.target.value as 'servo' | 'stepper_encoder',
                                  },
                                },
                              })
                            }
                            className="input w-full text-xs"
                          >
                            <option value="servo">Servo</option>
                            <option value="stepper_encoder">Stepper + Encoder</option>
                          </select>
                        </div>
                        <div className="text-xs text-steel-500">Stall Detection</div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-steel-500 mb-1">Timeout (s)</label>
                            <input
                              type="number"
                              value={config.driverConfig?.closedLoop?.stallDetection?.timeout ?? 0.3}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  driverConfig: {
                                    ...config.driverConfig,
                                    closedLoop: {
                                      ...config.driverConfig?.closedLoop,
                                      enabled: true,
                                      stallDetection: {
                                        ...config.driverConfig?.closedLoop?.stallDetection,
                                        timeout: parseFloat(e.target.value) || 0.3,
                                      },
                                    },
                                  },
                                })
                              }
                              className="input w-full text-xs py-1"
                              step={0.1}
                              min={0.1}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-steel-500 mb-1">Tolerancia (°)</label>
                            <input
                              type="number"
                              value={config.driverConfig?.closedLoop?.stallDetection?.tolerance ?? 0.5}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  driverConfig: {
                                    ...config.driverConfig,
                                    closedLoop: {
                                      ...config.driverConfig?.closedLoop,
                                      enabled: true,
                                      stallDetection: {
                                        ...config.driverConfig?.closedLoop?.stallDetection,
                                        tolerance: parseFloat(e.target.value) || 0.5,
                                      },
                                    },
                                  },
                                })
                              }
                              className="input w-full text-xs py-1"
                              step={0.1}
                              min={0.1}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-steel-500 mb-1">Sebesség (°/min)</label>
                            <input
                              type="number"
                              value={config.driverConfig?.closedLoop?.stallDetection?.speed ?? 150}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  driverConfig: {
                                    ...config.driverConfig,
                                    closedLoop: {
                                      ...config.driverConfig?.closedLoop,
                                      enabled: true,
                                      stallDetection: {
                                        ...config.driverConfig?.closedLoop?.stallDetection,
                                        speed: parseFloat(e.target.value) || 150,
                                      },
                                    },
                                  },
                                })
                              }
                              className="input w-full text-xs py-1"
                              min={10}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-steel-500 mb-1">Max keresés (°)</label>
                            <input
                              type="number"
                              value={config.driverConfig?.closedLoop?.stallDetection?.maxSearchAngle ?? 400}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  driverConfig: {
                                    ...config.driverConfig,
                                    closedLoop: {
                                      ...config.driverConfig?.closedLoop,
                                      enabled: true,
                                      stallDetection: {
                                        ...config.driverConfig?.closedLoop?.stallDetection,
                                        maxSearchAngle: parseFloat(e.target.value) || 400,
                                      },
                                    },
                                  },
                                })
                              }
                              className="input w-full text-xs py-1"
                              min={10}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Calibration Panel - robot_arm only */}
              {config.type === 'robot_arm' && (
                <CalibrationPanel
                  deviceId={deviceId}
                  onApplyResults={(results) => {
                    const newAxes = config.axes.map((axis) => {
                      if (axis.name === 'X' && results.j1_limits[0] !== null && results.j1_limits[1] !== null) {
                        return { ...axis, min: results.j1_limits[0], max: results.j1_limits[1] }
                      }
                      if (axis.name === 'Y' && results.j2_limits[0] !== null && results.j2_limits[1] !== null) {
                        return { ...axis, min: results.j2_limits[0], max: results.j2_limits[1] }
                      }
                      if (axis.name === 'Z' && results.j3_limits[0] !== null && results.j3_limits[1] !== null) {
                        return { ...axis, min: results.j3_limits[0], max: results.j3_limits[1] }
                      }
                      return axis
                    })
                    setConfig({ ...config, axes: newAxes })
                    setSuccessMessage('Kalibrációs eredmények alkalmazva!')
                    setTimeout(() => setSuccessMessage(null), 3000)
                  }}
                />
              )}

            </>
          )}
        </div>

        {/* Right: 3D Preview */}
        <div className="space-y-3">
          <div className="bg-steel-900/50 rounded-lg border border-steel-700 overflow-hidden h-[350px]">
            {config.type === 'robot_arm' ? (
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
            )}
          </div>

          {/* Preview position controls */}
          <div className="bg-steel-900/50 rounded-lg border border-steel-700 p-3 space-y-2">
            <div className="text-xs text-steel-400 font-medium">Teszt pozíció</div>
            <div className="grid grid-cols-3 gap-2">
              {['X', 'Y', 'Z'].map((axisName) => {
                const axis = config.axes.find((a) => a.name === axisName)
                const key = axisName.toLowerCase() as 'x' | 'y' | 'z'
                return (
                  <div key={axisName}>
                    <label className="block text-xs text-steel-500 mb-1">{axisName}</label>
                    <input
                      type="range"
                      min={axis?.min ?? 0}
                      max={axis?.max ?? 100}
                      value={previewPosition[key]}
                      onChange={(e) => setPreviewPosition({ ...previewPosition, [key]: parseFloat(e.target.value) })}
                      className="w-full"
                    />
                    <div className="text-center text-xs text-steel-500">{previewPosition[key].toFixed(0)}</div>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPreviewPosition({ x: 0, y: 0, z: 0 })}
                className="btn btn-secondary btn-sm text-xs flex-1"
              >
                Reset pozíció
              </button>
              <button
                onClick={handleCaptureCameraView}
                className="btn btn-secondary btn-sm text-xs flex-1"
              >
                Nézőpont rögzítése
              </button>
            </div>
          </div>

          {/* Visual Settings */}
          <div className="bg-steel-900/50 rounded-lg border border-steel-700 p-3 space-y-3">
            <div className="flex items-center gap-2 text-steel-300 text-sm font-medium">
              <Palette className="w-4 h-4" />
              Megjelenés
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-steel-500 mb-1">Gépváz színe</label>
                <input
                  type="color"
                  value={config.visuals?.frameColor ?? '#2d2d2d'}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      visuals: { ...config.visuals, frameColor: e.target.value },
                    })
                  }
                  className="w-full h-8 rounded cursor-pointer bg-steel-800 border border-steel-700"
                />
              </div>
              <div>
                <label className="block text-xs text-steel-500 mb-1">Háttérszín</label>
                <input
                  type="color"
                  value={config.visuals?.backgroundColor ?? '#0a0a0f'}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      visuals: { ...config.visuals, backgroundColor: e.target.value },
                    })
                  }
                  className="w-full h-8 rounded cursor-pointer bg-steel-800 border border-steel-700"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
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
                  className="w-3 h-3 rounded bg-steel-800 border-steel-600"
                />
                <span className="text-xs text-steel-400">Rács</span>
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
                  className="w-3 h-3 rounded bg-steel-800 border-steel-600"
                />
                <span className="text-xs text-steel-400">Tengely jelölők</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
