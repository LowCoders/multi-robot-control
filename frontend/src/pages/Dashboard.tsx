import { useState } from 'react'
import { Plus, X, Cpu, Zap, Printer } from 'lucide-react'
import { useDeviceStore } from '../stores/deviceStore'
import DeviceCard from '../components/devices/DeviceCard'

interface AddDeviceModalProps {
  isOpen: boolean
  onClose: () => void
}

function AddDeviceModal({ isOpen, onClose }: AddDeviceModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'cnc_mill',
    driver: 'simulated',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
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
  ]
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-steel-900 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-steel-700">
        <div className="flex items-center justify-between p-4 border-b border-steel-700">
          <h2 className="text-lg font-semibold text-white">Új Eszköz Hozzáadása</h2>
          <button onClick={onClose} className="text-steel-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
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
