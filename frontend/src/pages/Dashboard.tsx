import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X, Cpu, Zap, Printer, Bot, Wrench, Power, Loader2, RefreshCw } from 'lucide-react'
import { useDeviceStore } from '../stores/deviceStore'
import DeviceCard from '../components/devices/DeviceCard'

interface AddDeviceModalProps {
  isOpen: boolean
  onClose: () => void
}

interface YamlDeviceEntry {
  id: string
  name: string
  type: string
  driver: string
  enabled: boolean
  simulated: boolean
}

function AddDeviceModal({ isOpen, onClose }: AddDeviceModalProps) {
  const { t } = useTranslation('pages')
  const { devices } = useDeviceStore()
  const [formData, setFormData] = useState({
    name: '',
    type: 'cnc_mill',
    driver: 'simulated',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [yamlEntries, setYamlEntries] = useState<YamlDeviceEntry[]>([])
  const [yamlLoading, setYamlLoading] = useState(false)
  const [yamlError, setYamlError] = useState<string | null>(null)
  const [enablingId, setEnablingId] = useState<string | null>(null)

  const loadYaml = useCallback(async () => {
    setYamlLoading(true)
    setYamlError(null)
    try {
      const resp = await fetch('/api/config/devices-yaml')
      if (!resp.ok) throw new Error(t('dashboard.add_modal.error_http', { status: resp.status }))
      const data = await resp.json()
      setYamlEntries(Array.isArray(data.devices) ? data.devices : [])
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : t('dashboard.add_modal.yaml_load_error'))
    } finally {
      setYamlLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (isOpen) {
      loadYaml()
    }
  }, [isOpen, loadYaml])

  const loadedIds = new Set(devices.map((d) => d.id))
  const enableableEntries = yamlEntries.filter(
    (e) => !e.enabled && !loadedIds.has(e.id)
  )

  const handleEnable = async (id: string) => {
    setEnablingId(id)
    setYamlError(null)
    try {
      const resp = await fetch('/api/config/devices-yaml/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled: true }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.error || t('dashboard.add_modal.error_http', { status: resp.status }))
      }
      const data = await resp.json()
      if (data.bridgeError) {
        setYamlError(t('dashboard.add_modal.bridge_warning', { detail: data.bridgeError }))
      }
      await loadYaml()
      window.location.reload()
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : t('dashboard.add_modal.enable_error'))
    } finally {
      setEnablingId(null)
    }
  }

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const id = `device_${Date.now()}`

      const response = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: formData.name,
          type: formData.type,
          driver: formData.driver,
          enabled: true,
          config: {}
        })
      })

      if (!response.ok) {
        throw new Error(t('dashboard.add_modal.create_failed'))
      }

      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dashboard.add_modal.unknown_error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const deviceTypes = useMemo(
    () =>
      [
        { value: 'cnc_mill' as const, labelKey: 'dashboard.add_modal.device_types.cnc_mill', icon: Cpu },
        { value: 'laser_cutter' as const, labelKey: 'dashboard.add_modal.device_types.laser_cutter', icon: Zap },
        { value: 'printer_3d' as const, labelKey: 'dashboard.add_modal.device_types.printer_3d', icon: Printer },
        { value: 'robot_arm' as const, labelKey: 'dashboard.add_modal.device_types.robot_arm', icon: Bot },
        { value: 'tube_bender' as const, labelKey: 'dashboard.add_modal.device_types.tube_bender', icon: Wrench },
      ] as const,
    [],
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-steel-900 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-steel-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-steel-700">
          <h2 className="text-lg font-semibold text-white">{t('dashboard.add_modal.title')}</h2>
          <button onClick={onClose} className="text-steel-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-steel-700 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-steel-200">{t('dashboard.add_modal.disabled_section_title')}</h3>
            <button
              type="button"
              onClick={loadYaml}
              disabled={yamlLoading}
              className="text-steel-400 hover:text-white disabled:opacity-50"
              title={t('dashboard.add_modal.refresh_title')}
            >
              {yamlLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </button>
          </div>

          {yamlError && (
            <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs">
              {yamlError}
            </div>
          )}

          {!yamlLoading && enableableEntries.length === 0 && !yamlError && (
            <p className="text-xs text-steel-500">
              {t('dashboard.add_modal.none_disabled', { file: 'devices.yaml' })}
            </p>
          )}

          {enableableEntries.length > 0 && (
            <div className="space-y-1.5">
              {enableableEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-2 p-2 bg-steel-800/60 border border-steel-700 rounded-lg"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate">{entry.name}</div>
                    <div className="text-[10px] text-steel-500 font-mono">
                      {entry.id} · {entry.type} · {entry.driver}
                      {entry.simulated && ' · sim'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleEnable(entry.id)}
                    disabled={enablingId === entry.id}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-machine-600 text-white rounded hover:bg-machine-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {enablingId === entry.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Power className="w-3 h-3" />
                    )}
                    {t('dashboard.add_modal.enable')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <h3 className="text-sm font-medium text-steel-200 -mt-1">{t('dashboard.add_modal.create_section')}</h3>
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-steel-300 mb-1">
              {t('dashboard.add_modal.device_name')}
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-steel-800 border border-steel-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-machine-500"
              placeholder={t('dashboard.add_modal.device_name_placeholder')}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-steel-300 mb-2">
              {t('dashboard.add_modal.device_type')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {deviceTypes.map(({ value, labelKey, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFormData({ ...formData, type: value })}
                  className={`p-3 rounded-lg border transition-colors flex flex-col items-center gap-1 ${
                    formData.type === value
                      ? 'bg-machine-600/20 border-machine-500 text-machine-400'
                      : 'bg-steel-800 border-steel-600 text-steel-400 hover:border-steel-500'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs">{t(labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-steel-300 mb-1">
              {t('dashboard.add_modal.driver')}
            </label>
            <select
              value={formData.driver}
              onChange={(e) => setFormData({ ...formData, driver: e.target.value })}
              className="w-full px-3 py-2 bg-steel-800 border border-steel-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-machine-500"
            >
              <option value="simulated">{t('dashboard.add_modal.driver_simulated')}</option>
              <option value="grbl">GRBL</option>
              <option value="linuxcnc">LinuxCNC</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-steel-700 text-white rounded-lg hover:bg-steel-600 transition-colors"
            >
              {t('dashboard.add_modal.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.name}
              className="flex-1 px-4 py-2 bg-machine-600 text-white rounded-lg hover:bg-machine-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t('dashboard.add_modal.submit_loading') : t('dashboard.add_modal.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { t } = useTranslation('pages')
  const { devices, connected } = useDeviceStore()
  const [showAddDevice, setShowAddDevice] = useState(false)

  const activeDevices = devices.filter(d => d.connected)
  const runningDevices = devices.filter(d => d.state === 'running')

  const subtitle =
    t('dashboard.subtitle_active', { count: activeDevices.length }) +
    (runningDevices.length > 0 ? t('dashboard.subtitle_running_suffix', { count: runningDevices.length }) : '')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('dashboard.title')}</h1>
          <p className="text-steel-400">{subtitle}</p>
        </div>

        {!connected && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm text-red-400">{t('dashboard.no_server')}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {devices.map((device) => (
          <DeviceCard key={device.id} device={device} />
        ))}

        <div
          onClick={() => setShowAddDevice(true)}
          className="card border-dashed border-2 border-steel-700 hover:border-steel-500 transition-colors cursor-pointer"
        >
          <div className="card-body flex flex-col items-center justify-center py-12 text-steel-500 hover:text-steel-300 transition-colors">
            <Plus className="w-8 h-8 mb-2" />
            <span>{t('dashboard.add_device_card')}</span>
          </div>
        </div>
      </div>

      <AddDeviceModal isOpen={showAddDevice} onClose={() => setShowAddDevice(false)} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="card-body">
            <div className="text-sm text-steel-400 mb-1">{t('dashboard.stats.total')}</div>
            <div className="text-2xl font-bold text-white">{devices.length}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="text-sm text-steel-400 mb-1">{t('dashboard.stats.active')}</div>
            <div className="text-2xl font-bold text-machine-400">{activeDevices.length}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="text-sm text-steel-400 mb-1">{t('dashboard.stats.running_jobs')}</div>
            <div className="text-2xl font-bold text-blue-400">{runningDevices.length}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="text-sm text-steel-400 mb-1">{t('dashboard.stats.server')}</div>
            <div className="text-2xl font-bold text-white">
              {connected ? (
                <span className="text-machine-400">{t('dashboard.stats.online')}</span>
              ) : (
                <span className="text-red-400">{t('dashboard.stats.offline')}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
