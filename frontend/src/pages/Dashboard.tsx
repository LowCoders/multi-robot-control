import { useEffect, useState, useCallback } from 'react'
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
  const { devices } = useDeviceStore()
  const [formData, setFormData] = useState({
    name: '',
    type: 'cnc_mill',
    driver: 'simulated',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // YAML-ből letölthető (de jelenleg disabled) eszközök listája
  const [yamlEntries, setYamlEntries] = useState<YamlDeviceEntry[]>([])
  const [yamlLoading, setYamlLoading] = useState(false)
  const [yamlError, setYamlError] = useState<string | null>(null)
  const [enablingId, setEnablingId] = useState<string | null>(null)

  const loadYaml = useCallback(async () => {
    setYamlLoading(true)
    setYamlError(null)
    try {
      const resp = await fetch('/api/config/devices-yaml')
      if (!resp.ok) throw new Error(`Hiba (${resp.status})`)
      const data = await resp.json()
      setYamlEntries(Array.isArray(data.devices) ? data.devices : [])
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : 'YAML letöltési hiba')
    } finally {
      setYamlLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      loadYaml()
    }
  }, [isOpen, loadYaml])

  // A valóban újra-aktiválható eszközök:
  //   - a YAML-ben enabled: false-ra van állítva
  //   - és (még) nincs jelen a runtime device-listában
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
        throw new Error(data.error || `Hiba (${resp.status})`)
      }
      const data = await resp.json()
      if (data.bridgeError) {
        // A YAML mentése sikerült, de a bridge nem tudta betölteni — figyelmeztetés
        setYamlError(`YAML frissítve, de a bridge betöltés nem sikerült: ${data.bridgeError}`)
      }
      // YAML-listát újra olvasunk + dashboard reloaddal frissítjük a device store-t
      await loadYaml()
      window.location.reload()
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : 'Engedélyezési hiba')
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
      // Generate a unique ID
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
        throw new Error('Nem sikerült hozzáadni az eszközt')
      }
      
      // Reload the devices
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ismeretlen hiba')
    } finally {
      setIsSubmitting(false)
    }
  }
  
  const deviceTypes = [
    { value: 'cnc_mill', label: 'CNC Maró', icon: Cpu },
    { value: 'laser_cutter', label: 'Lézervágó', icon: Zap },
    { value: 'printer_3d', label: '3D Nyomtató', icon: Printer },
    { value: 'robot_arm', label: 'Robotkar', icon: Bot },
    { value: 'tube_bender', label: 'Csőhajlító', icon: Wrench },
  ]
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-steel-900 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-steel-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-steel-700">
          <h2 className="text-lg font-semibold text-white">Új Eszköz Hozzáadása</h2>
          <button onClick={onClose} className="text-steel-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Letiltott (devices.yaml-ben enabled:false) eszközök gyors visszakapcsolása */}
        <div className="p-4 border-b border-steel-700 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-steel-200">Letiltott eszközök engedélyezése</h3>
            <button
              type="button"
              onClick={loadYaml}
              disabled={yamlLoading}
              className="text-steel-400 hover:text-white disabled:opacity-50"
              title="Frissítés"
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
              Nincs letiltott eszköz a <code className="bg-steel-800 px-1 rounded">devices.yaml</code>-ben,
              ami engedélyezhető lenne.
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
                    Engedélyez
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <h3 className="text-sm font-medium text-steel-200 -mt-1">Új eszköz létrehozása</h3>
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium text-steel-300 mb-1">
              Eszköz neve
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-steel-800 border border-steel-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-machine-500"
              placeholder="Pl: CNC Maró #2"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-steel-300 mb-2">
              Eszköz típusa
            </label>
            <div className="grid grid-cols-3 gap-2">
              {deviceTypes.map(({ value, label, icon: Icon }) => (
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
                  <span className="text-xs">{label}</span>
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-steel-300 mb-1">
              Driver
            </label>
            <select
              value={formData.driver}
              onChange={(e) => setFormData({ ...formData, driver: e.target.value })}
              className="w-full px-3 py-2 bg-steel-800 border border-steel-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-machine-500"
            >
              <option value="simulated">Szimulált (teszteléshez)</option>
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
              Mégse
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.name}
              className="flex-1 px-4 py-2 bg-machine-600 text-white rounded-lg hover:bg-machine-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Hozzáadás...' : 'Hozzáadás'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { devices, connected } = useDeviceStore()
  const [showAddDevice, setShowAddDevice] = useState(false)
  
  const activeDevices = devices.filter(d => d.connected)
  const runningDevices = devices.filter(d => d.state === 'running')
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-steel-400">
            {activeDevices.length} aktív eszköz
            {runningDevices.length > 0 && ` • ${runningDevices.length} fut`}
          </p>
        </div>
        
        {!connected && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm text-red-400">Nincs szerver kapcsolat</span>
          </div>
        )}
      </div>
      
      {/* Device Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {devices.map((device) => (
          <DeviceCard key={device.id} device={device} />
        ))}
        
        {/* Add Device Card */}
        <div 
          onClick={() => setShowAddDevice(true)}
          className="card border-dashed border-2 border-steel-700 hover:border-steel-500 transition-colors cursor-pointer"
        >
          <div className="card-body flex flex-col items-center justify-center py-12 text-steel-500 hover:text-steel-300 transition-colors">
            <Plus className="w-8 h-8 mb-2" />
            <span>Eszköz hozzáadása</span>
          </div>
        </div>
      </div>
      
      {/* Add Device Modal */}
      <AddDeviceModal isOpen={showAddDevice} onClose={() => setShowAddDevice(false)} />
      
      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="card-body">
            <div className="text-sm text-steel-400 mb-1">Összes Eszköz</div>
            <div className="text-2xl font-bold text-white">{devices.length}</div>
          </div>
        </div>
        
        <div className="card">
          <div className="card-body">
            <div className="text-sm text-steel-400 mb-1">Aktív</div>
            <div className="text-2xl font-bold text-machine-400">{activeDevices.length}</div>
          </div>
        </div>
        
        <div className="card">
          <div className="card-body">
            <div className="text-sm text-steel-400 mb-1">Futó Jobok</div>
            <div className="text-2xl font-bold text-blue-400">{runningDevices.length}</div>
          </div>
        </div>
        
        <div className="card">
          <div className="card-body">
            <div className="text-sm text-steel-400 mb-1">Szerver</div>
            <div className="text-2xl font-bold text-white">
              {connected ? (
                <span className="text-machine-400">Online</span>
              ) : (
                <span className="text-red-400">Offline</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
