import { useState, useEffect } from 'react'
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

export default function Settings() {
  const [settings, setSettings] = useState({
    bridgeHost: 'localhost',
    bridgePort: '4002',
    gcodeDirectory: '/home/user/nc_files',
    positionUpdateRate: '10',
    statusUpdateRate: '5',
  })
  
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  
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
            gcodeDirectory: data.gcodeDirectory || '/home/user/nc_files',
            positionUpdateRate: String(data.positionUpdateRate || 10),
            statusUpdateRate: String(data.statusUpdateRate || 5),
          })
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
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
          gcodeDirectory: settings.gcodeDirectory,
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
        setErrorMessage(data.error || 'Mentési hiba')
      }
    } catch (error) {
      setSaveStatus('error')
      setErrorMessage('Nem sikerült kapcsolódni a szerverhez')
    } finally {
      setIsSaving(false)
    }
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Beállítások</h1>
          <p className="text-steel-400">Rendszer konfiguráció</p>
        </div>
        
        <div className="flex items-center gap-3">
          {saveStatus === 'success' && (
            <div className="flex items-center gap-2 text-machine-400">
              <Check className="w-4 h-4" />
              <span className="text-sm">Mentve!</span>
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
            {isSaving ? 'Mentés...' : 'Mentés'}
          </button>
        </div>
      </div>
      
      {/* Server Settings */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-steel-400" />
            <span className="font-medium">Szerver Beállítások</span>
          </div>
        </div>
        <div className="card-body space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-steel-400 mb-1">
                Bridge Host
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
                Bridge Port
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
            <span className="font-medium">Fájl Beállítások</span>
          </div>
        </div>
        <div className="card-body">
          <div>
            <label className="block text-sm text-steel-400 mb-1">
              G-code Könyvtár
            </label>
            <input
              type="text"
              value={settings.gcodeDirectory}
              onChange={(e) => handleChange('gcodeDirectory', e.target.value)}
              className="input w-full"
            />
          </div>
        </div>
      </div>
      
      {/* Performance Settings */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-steel-400" />
            <span className="font-medium">Teljesítmény</span>
          </div>
        </div>
        <div className="card-body space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-steel-400 mb-1">
                Pozíció Frissítési Ráta (Hz)
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
                Státusz Frissítési Ráta (Hz)
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
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-steel-400" />
            <span className="font-medium">Eszközök</span>
          </div>
        </div>
        <div className="card-body">
          <p className="text-sm text-steel-400 mb-4">
            Az eszközök konfigurációját a <code className="bg-steel-800 px-1 rounded">config/devices.yaml</code> 
            fájlban módosíthatod.
          </p>
          
          <div className="bg-steel-800/50 rounded-lg p-4 font-mono text-sm text-steel-300">
            <pre>{`devices:
  - id: cnc_main
    name: "CNC Maró"
    driver: linuxcnc
    type: cnc_mill
    
  - id: laser_1
    name: "Lézervágó"
    driver: grbl
    type: laser_cutter`}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}
