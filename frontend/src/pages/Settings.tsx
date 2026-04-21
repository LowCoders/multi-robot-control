import { useState, useEffect, useCallback } from 'react'
import { 
  Save, 
  RefreshCw, 
  Server, 
  Cpu,
  Folder,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { createLogger } from '../utils/logger'
import { useTranslation } from 'react-i18next'

const log = createLogger('settings')

export default function Settings() {
  const { t } = useTranslation('pages')
  // Az alapértékeket a backend `/api/settings` adja vissza (config/system.yaml-ből).
  // Itt csak üres placeholder, a useEffect tölti fel.
  const [settings, setSettings] = useState({
    bridgeHost: '',
    bridgePort: '',
    positionUpdateRate: '',
    statusUpdateRate: '',
  })
  // A G-code gyökérkönyvtár csak olvasható: a backend `.env` (GCODE_ROOT_DIR)
  // alapján adja vissza, a UI nem módosíthatja.
  const [gcodeRoot, setGcodeRoot] = useState<string>('')
  
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  // Az aktuális devices.yaml tartalma a Settings → Eszközök blokkhoz.
  const [devicesYaml, setDevicesYaml] = useState<string>('')
  const [devicesYamlPath, setDevicesYamlPath] = useState<string>('')
  const [devicesYamlLoading, setDevicesYamlLoading] = useState<boolean>(false)
  const [devicesYamlError, setDevicesYamlError] = useState<string | null>(null)

  const loadDevicesYaml = useCallback(async () => {
    setDevicesYamlLoading(true)
    setDevicesYamlError(null)
    try {
      const resp = await fetch('/api/config/devices-yaml')
      if (!resp.ok) {
        throw new Error(`Hiba (${resp.status})`)
      }
      const data = await resp.json()
      setDevicesYaml(typeof data.raw === 'string' ? data.raw : '')
      setDevicesYamlPath(typeof data.path === 'string' ? data.path : '')
    } catch (err) {
      setDevicesYamlError(err instanceof Error ? err.message : t('settings.download_error'))
    } finally {
      setDevicesYamlLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadDevicesYaml()
  }, [loadDevicesYaml])
  
  // Load settings from API
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/settings')
        if (response.ok) {
          const data = await response.json()
          setSettings({
            bridgeHost: data.bridgeHost || 'localhost',
            bridgePort: String(data.bridgePort || 4002),
            positionUpdateRate: String(data.positionUpdateRate || 10),
            statusUpdateRate: String(data.statusUpdateRate || 5),
          })
          if (typeof data.gcodeRoot === 'string') {
            setGcodeRoot(data.gcodeRoot)
          }
        }
      } catch (error) {
        log.error('Failed to load settings:', error)
      }
    }
    loadSettings()
  }, [])
  
  const handleChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaveStatus('idle') // Reset save status when changing
  }
  
  const handleSave = async () => {
    setIsSaving(true)
    setSaveStatus('idle')
    setErrorMessage('')
    
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bridgeHost: settings.bridgeHost,
          bridgePort: parseInt(settings.bridgePort, 10),
          positionUpdateRate: parseInt(settings.positionUpdateRate, 10),
          statusUpdateRate: parseInt(settings.statusUpdateRate, 10),
        }),
      })
      
      if (response.ok) {
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        const data = await response.json()
        setSaveStatus('error')
        setErrorMessage(data.error || t('settings.save_error_generic'))
      }
    } catch (error) {
      setSaveStatus('error')
      setErrorMessage(t('settings.cannot_reach_server'))
    } finally {
      setIsSaving(false)
    }
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('settings.title')}</h1>
          <p className="text-steel-400">{t('settings.subtitle')}</p>
        </div>
        
        <div className="flex items-center gap-3">
          {saveStatus === 'success' && (
            <div className="flex items-center gap-2 text-machine-400">
              <Check className="w-4 h-4" />
              <span className="text-sm">{t('settings.saved')}</span>
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{errorMessage}</span>
            </div>
          )}
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="btn btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isSaving ? t('settings.save_loading') : t('settings.save')}
          </button>
        </div>
      </div>
      
      {/* Server Settings */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-steel-400" />
            <span className="font-medium">{t('settings.server_section')}</span>
          </div>
        </div>
        <div className="card-body space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-steel-400 mb-1">
                {t('settings.bridge_host')}
              </label>
              <input
                type="text"
                value={settings.bridgeHost}
                onChange={(e) => handleChange('bridgeHost', e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm text-steel-400 mb-1">
                {t('settings.bridge_port')}
              </label>
              <input
                type="text"
                value={settings.bridgePort}
                onChange={(e) => handleChange('bridgePort', e.target.value)}
                className="input w-full"
              />
            </div>
          </div>
        </div>
      </div>
      
      {/* File Settings */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Folder className="w-5 h-5 text-steel-400" />
            <span className="font-medium">{t('settings.file_section')}</span>
          </div>
        </div>
        <div className="card-body">
          <div>
            <label className="block text-sm text-steel-400 mb-1">
              {t('settings.gcode_root_label')}
            </label>
            <input
              type="text"
              value={gcodeRoot}
              readOnly
              className="input w-full bg-steel-900 text-steel-400 cursor-not-allowed"
            />
            <p className="text-xs text-steel-500 mt-1">{t('settings.gcode_root_hint')}</p>
          </div>
        </div>
      </div>
      
      {/* Performance Settings */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-steel-400" />
            <span className="font-medium">{t('settings.performance_section')}</span>
          </div>
        </div>
        <div className="card-body space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-steel-400 mb-1">
                {t('settings.position_rate')}
              </label>
              <input
                type="number"
                value={settings.positionUpdateRate}
                onChange={(e) => handleChange('positionUpdateRate', e.target.value)}
                className="input w-full"
                min="1"
                max="50"
              />
            </div>
            <div>
              <label className="block text-sm text-steel-400 mb-1">
                {t('settings.status_rate')}
              </label>
              <input
                type="number"
                value={settings.statusUpdateRate}
                onChange={(e) => handleChange('statusUpdateRate', e.target.value)}
                className="input w-full"
                min="1"
                max="20"
              />
            </div>
          </div>
        </div>
      </div>
      
      {/* Device Info */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-steel-400" />
              <span className="font-medium">{t('settings.devices_section')}</span>
            </div>
            <button
              type="button"
              onClick={loadDevicesYaml}
              disabled={devicesYamlLoading}
              className="text-steel-400 hover:text-white disabled:opacity-50 flex items-center gap-1 text-xs"
              title={t('settings.devices_refresh_title')}
            >
              {devicesYamlLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {t('settings.refresh_short')}
            </button>
          </div>
        </div>
        <div className="card-body space-y-3">
          <p className="text-sm text-steel-400">
            {t('settings.devices_intro', {
              path: devicesYamlPath || 'config/devices.yaml',
            })}
          </p>

          {devicesYamlError && (
            <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs">
              {devicesYamlError}
            </div>
          )}

          <div className="bg-steel-800/50 rounded-lg overflow-hidden border border-steel-700">
            <pre className="font-mono text-xs text-steel-300 p-3 overflow-auto max-h-96 leading-relaxed whitespace-pre">
              {devicesYamlLoading && !devicesYaml
                ? t('settings.devices_loading')
                : devicesYaml || t('settings.devices_empty')}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
