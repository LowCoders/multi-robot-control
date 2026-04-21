import { useState, useEffect, useRef } from 'react'
import {
  Play,
  Square,
  CheckCircle,
  AlertCircle,
  Loader2,
  Target,
  Settings,
  ChevronDown,
  ChevronRight,
  Save,
  Power,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { createLogger } from '../../utils/logger'

const log = createLogger('calibration')

interface CalibrationResults {
  completed: boolean
  j1_limits: [number | null, number | null]
  j2_limits: [number | null, number | null]
  j3_limits: [number | null, number | null]
  home_position: { j1: number; j2: number; j3: number }
  error?: string
}

interface CalibrationPanelProps {
  deviceId: string
  onApplyResults?: (results: CalibrationResults) => void
}

export default function CalibrationPanel({ deviceId, onApplyResults }: CalibrationPanelProps) {
  const { t } = useTranslation('devices')
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [results, setResults] = useState<CalibrationResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingHome, setSavingHome] = useState(false)
  const [homeSaveSuccess, setHomeSaveSuccess] = useState(false)
  
  const [settings, setSettings] = useState({
    speed: 150,
    stall_timeout: 0.3,
    stall_tolerance: 0.5,
  })
  
  const [selectedJoints, setSelectedJoints] = useState({
    X: false,  // Bázis - nincs fizikai végállás
    Y: true,   // Váll - van fizikai végállás
    Z: true,   // Könyök - van fizikai végállás
  })
  
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [])

  const handleStartCalibration = async () => {
    setError(null)
    setResults(null)
    setIsCalibrating(true)
    
    try {
      // Kiválasztott tengelyek listája
      const joints = Object.entries(selectedJoints)
        .filter(([, selected]) => selected)
        .map(([joint]) => joint)
      
      const response = await fetch(`/api/devices/${deviceId}/calibrate-limits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speed: settings.speed,
          stall_timeout: settings.stall_timeout,
          stall_tolerance: settings.stall_tolerance,
          joints: joints.length > 0 ? joints : undefined,
        }),
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || t('calibration.calibration_start_failed'))
      }
      
      const data: CalibrationResults = await response.json()
      setResults(data)
      setIsCalibrating(false)
      
      if (data.error) {
        setError(data.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('calibration.unknown_error'))
      setIsCalibrating(false)
    }
  }

  const handleStopCalibration = async () => {
    try {
      await fetch(`/api/devices/${deviceId}/calibration-stop`, {
        method: 'POST',
      })
      setIsCalibrating(false)
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    } catch (err) {
      log.error('Failed to stop calibration:', err)
    }
  }

  const handleApplyResults = () => {
    if (results && onApplyResults) {
      onApplyResults(results)
    }
  }

  const handleSaveToConfig = async () => {
    if (!results) return
    
    setSaving(true)
    setError(null)
    setSaveSuccess(false)
    
    try {
      const response = await fetch(`/api/devices/${deviceId}/save-calibration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          j1_limits: results.j1_limits,
          j2_limits: results.j2_limits,
          j3_limits: results.j3_limits,
        }),
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || t('calibration.save_failed'))
      }
      
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('calibration.save_failed'))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAsHome = async () => {
    if (!results || !results.home_position) return
    
    setSavingHome(true)
    setError(null)
    setHomeSaveSuccess(false)
    
    try {
      const hp = results.home_position
      const response = await fetch(`/api/devices/${deviceId}/home-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'absolute',
          X: hp.j2,
          Y: hp.j3,
          Z: hp.j1,
          save_current: false,
        }),
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || t('calibration.save_failed'))
      }
      
      setHomeSaveSuccess(true)
      setTimeout(() => setHomeSaveSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('calibration.save_failed'))
    } finally {
      setSavingHome(false)
    }
  }

  const formatLimit = (value: number | null): string => {
    if (value === null) return '-'
    return `${value.toFixed(1)}°`
  }

  return (
    <div className="bg-steel-900/50 rounded-lg border border-steel-700 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-steel-300 text-sm font-medium">
          <Target className="w-4 h-4" />
          {t('calibration.panel_title')}
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="btn-icon text-steel-400 hover:text-white"
          title={t('calibration.settings_tooltip')}
        >
          {showSettings ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <Settings className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-steel-500">{t('calibration.intro')}</p>

      {showSettings && (
        <div className="bg-steel-800/50 rounded-lg p-3 space-y-3">
          <div className="text-xs text-steel-400 font-medium">
            {t('calibration.settings_section_title')}
          </div>
          <p className="text-xs text-steel-600">{t('calibration.settings_yaml_hint')}</p>

          <div>
            <label className="block text-xs text-steel-500 mb-2">
              {t('calibration.axes_to_calibrate')}
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs text-steel-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedJoints.X}
                  onChange={(e) => setSelectedJoints({ ...selectedJoints, X: e.target.checked })}
                  className="w-3 h-3 rounded border-steel-600 bg-steel-700 text-machine-500 focus:ring-machine-500"
                />
                {t('calibration.axis_x')}
              </label>
              <label className="flex items-center gap-2 text-xs text-steel-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedJoints.Y}
                  onChange={(e) => setSelectedJoints({ ...selectedJoints, Y: e.target.checked })}
                  className="w-3 h-3 rounded border-steel-600 bg-steel-700 text-machine-500 focus:ring-machine-500"
                />
                {t('calibration.axis_y')}
              </label>
              <label className="flex items-center gap-2 text-xs text-steel-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedJoints.Z}
                  onChange={(e) => setSelectedJoints({ ...selectedJoints, Z: e.target.checked })}
                  className="w-3 h-3 rounded border-steel-600 bg-steel-700 text-machine-500 focus:ring-machine-500"
                />
                {t('calibration.axis_z')}
              </label>
            </div>
            <p className="text-xs text-steel-600 mt-1">{t('calibration.axis_base_note')}</p>
          </div>
          
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-steel-500 mb-1">
                {t('calibration.speed_label')}
              </label>
              <input
                type="number"
                value={settings.speed}
                onChange={(e) => setSettings({ ...settings, speed: parseFloat(e.target.value) || 150 })}
                className="input w-full text-xs py-1"
                min={50}
                max={500}
              />
            </div>
            <div>
              <label className="block text-xs text-steel-500 mb-1">
                {t('calibration.stall_timeout_label')}
              </label>
              <input
                type="number"
                value={settings.stall_timeout}
                onChange={(e) => setSettings({ ...settings, stall_timeout: parseFloat(e.target.value) || 0.3 })}
                className="input w-full text-xs py-1"
                min={0.1}
                max={2}
                step={0.1}
              />
            </div>
            <div>
              <label className="block text-xs text-steel-500 mb-1">
                {t('calibration.tolerance_label')}
              </label>
              <input
                type="number"
                value={settings.stall_tolerance}
                onChange={(e) => setSettings({ ...settings, stall_tolerance: parseFloat(e.target.value) || 0.5 })}
                className="input w-full text-xs py-1"
                min={0.1}
                max={5}
                step={0.1}
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 flex items-center gap-2 text-red-400 text-xs">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </div>
      )}

      {isCalibrating && (
        <div className="flex items-center gap-2 text-sm text-steel-300">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('calibration.running_status')}
        </div>
      )}

      {results && results.completed && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
            <CheckCircle className="w-4 h-4" />
            {t('calibration.success_title')}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-steel-800/50 rounded p-2">
              <div className="text-steel-500 mb-1">{t('calibration.axis_x')}</div>
              <div className="text-white">
                {formatLimit(results.j1_limits[0])} ... {formatLimit(results.j1_limits[1])}
              </div>
            </div>
            <div className="bg-steel-800/50 rounded p-2">
              <div className="text-steel-500 mb-1">{t('calibration.axis_y')}</div>
              <div className="text-white">
                {formatLimit(results.j2_limits[0])} ... {formatLimit(results.j2_limits[1])}
              </div>
            </div>
            <div className="bg-steel-800/50 rounded p-2">
              <div className="text-steel-500 mb-1">{t('calibration.axis_z')}</div>
              <div className="text-white">
                {formatLimit(results.j3_limits[0])} ... {formatLimit(results.j3_limits[1])}
              </div>
            </div>
          </div>
          {/* Home position info */}
          {results.home_position && (
            <div className="bg-steel-800/50 rounded p-2 text-xs">
              <div className="text-steel-500 mb-1">{t('calibration.home_calibrated_title')}</div>
              <div className="text-white">
                X: {results.home_position.j1.toFixed(1)}° |
                Y: {results.home_position.j2.toFixed(1)}° |
                Z: {results.home_position.j3.toFixed(1)}°
              </div>
            </div>
          )}
          <div className="flex gap-2">
            {onApplyResults && (
              <button
                onClick={handleApplyResults}
                className="btn btn-primary btn-sm flex-1 flex items-center justify-center gap-1"
              >
                <CheckCircle className="w-3 h-3" />
                {t('calibration.apply_btn')}
              </button>
            )}
            <button
              onClick={handleSaveToConfig}
              disabled={saving}
              className="btn btn-secondary btn-sm flex-1 flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <Save className="w-3 h-3" />
              {saving ? t('calibration.saving') : t('calibration.save_yaml')}
            </button>
          </div>
          {saveSuccess && (
            <div className="text-xs text-green-400 text-center">
              {t('calibration.saved_yaml_banner')}
            </div>
          )}
          {/* Save as home position button */}
          {results.home_position && (
            <button
              onClick={handleSaveAsHome}
              disabled={savingHome}
              className="btn btn-secondary btn-sm w-full flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <Power className="w-3 h-3" />
              {savingHome ? t('calibration.saving') : t('calibration.save_home')}
            </button>
          )}
          {homeSaveSuccess && (
            <div className="text-xs text-green-400 text-center">
              {t('calibration.saved_home_banner')}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {!isCalibrating ? (
          <button
            onClick={handleStartCalibration}
            className="btn btn-primary btn-sm flex-1 flex items-center justify-center gap-1"
          >
            <Play className="w-3 h-3" />
            {t('calibration.find_limits')}
          </button>
        ) : (
          <button
            onClick={handleStopCalibration}
            className="btn btn-danger btn-sm flex-1 flex items-center justify-center gap-1"
          >
            <Square className="w-3 h-3" />
            {t('calibration.stop_btn')}
          </button>
        )}
      </div>
    </div>
  )
}
