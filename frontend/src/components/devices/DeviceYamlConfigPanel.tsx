import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react'

interface Props {
  deviceId: string
}

interface YamlEntry {
  id: string
  name?: string
  type?: string
  driver?: string
  enabled?: boolean
  simulated?: boolean
  config?: Record<string, unknown>
  [key: string]: unknown
}

const DRIVER_OPTIONS = [
  { value: 'simulated', label: 'Szimulált (driver=simulated)' },
  { value: 'grbl', label: 'GRBL' },
  { value: 'linuxcnc', label: 'LinuxCNC' },
  { value: 'robot_arm', label: 'Robotkar (open/closed loop)' },
  { value: 'tube_bender', label: 'Csőhajlító (grblHAL)' },
]

const TYPE_OPTIONS = [
  { value: 'cnc_mill', label: 'CNC Maró' },
  { value: '5axis', label: '5-tengelyes CNC' },
  { value: 'cnc_lathe', label: 'CNC Eszterga' },
  { value: 'laser_cutter', label: 'Lézervágó' },
  { value: '3d_printer', label: '3D Nyomtató' },
  { value: 'robot_arm', label: 'Robotkar' },
  { value: 'tube_bender', label: 'Csőhajlító' },
]

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

export default function DeviceYamlConfigPanel({ deviceId }: Props) {
  const [entry, setEntry] = useState<YamlEntry | null>(null)
  const [name, setName] = useState('')
  const [driver, setDriver] = useState('simulated')
  const [type, setType] = useState('cnc_mill')
  const [simulated, setSimulated] = useState(false)
  const [configText, setConfigText] = useState('{}')
  const [configError, setConfigError] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)
    setNotFound(false)
    try {
      const resp = await fetch(`/api/config/devices-yaml/${encodeURIComponent(deviceId)}`)
      if (resp.status === 404) {
        setNotFound(true)
        setEntry(null)
        return
      }
      if (!resp.ok) {
        throw new Error(`Hiba (${resp.status})`)
      }
      const data = (await resp.json()) as YamlEntry
      setEntry(data)
      setName(typeof data.name === 'string' ? data.name : deviceId)
      setDriver(typeof data.driver === 'string' ? data.driver : 'simulated')
      setType(typeof data.type === 'string' ? data.type : 'cnc_mill')
      setSimulated(data.simulated === true)
      setConfigText(formatJson(data.config))
      setConfigError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Letöltési hiba')
    } finally {
      setLoading(false)
    }
  }, [deviceId])

  useEffect(() => {
    load()
  }, [load])

  // Élő JSON validáció a config textareán
  useEffect(() => {
    try {
      const parsed = JSON.parse(configText)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setConfigError('A config-nak JSON objektumnak kell lennie')
      } else {
        setConfigError(null)
      }
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Érvénytelen JSON')
    }
  }, [configText])

  const handleSave = async () => {
    if (configError) return
    let configObj: Record<string, unknown> = {}
    try {
      configObj = JSON.parse(configText) as Record<string, unknown>
    } catch {
      setConfigError('Érvénytelen JSON')
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const resp = await fetch(`/api/config/devices-yaml/${encodeURIComponent(deviceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          driver,
          type,
          simulated,
          config: configObj,
        }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.error || `Hiba (${resp.status})`)
      }
      setSuccess('devices.yaml frissítve. Az új driver/port változások a bridge újraindítása után lépnek életbe.')
      setTimeout(() => setSuccess(null), 6000)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mentési hiba')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !entry) {
    return (
      <div className="flex items-center gap-2 text-steel-400 text-sm p-3">
        <Loader2 className="w-4 h-4 animate-spin" />
        Betöltés…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="text-xs text-steel-500 p-3">
        Az eszköz <code className="bg-steel-800 px-1 rounded">{deviceId}</code> nem
        található a <code className="bg-steel-800 px-1 rounded">config/devices.yaml</code>-ben.
        Az ezen a panelen állítható mezők csak meglévő YAML-bejegyzéshez érhetők el.
      </div>
    )
  }

  const dirty =
    !!entry &&
    (name !== (entry.name ?? deviceId) ||
      driver !== (entry.driver ?? 'simulated') ||
      type !== (entry.type ?? 'cnc_mill') ||
      simulated !== (entry.simulated === true) ||
      configText !== formatJson(entry.config))

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-steel-500">
        A <code className="bg-steel-800 px-1 rounded">config/devices.yaml</code>-ben tárolt
        eszköz-szintű beállítások (driver, szimulált mód, csatlakozási paraméterek).
        Az engedélyezett/letiltott állapotot nem itt, hanem az „Eszköz hozzáadása"
        modalban lehet kapcsolni. A driver / port változás a bridge újraindítása után
        lép életbe.
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-1">
          <CheckCircle className="w-3.5 h-3.5" />
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-steel-400 mb-1">Eszköz neve</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input w-full"
            placeholder="Pl. CNC Maró"
          />
        </div>
        <div>
          <label className="block text-[11px] text-steel-400 mb-1">Eszköz ID</label>
          <input
            type="text"
            value={deviceId}
            readOnly
            className="input w-full opacity-60 cursor-not-allowed"
          />
        </div>
        <div>
          <label className="block text-[11px] text-steel-400 mb-1">Driver</label>
          <select
            value={driver}
            onChange={(e) => setDriver(e.target.value)}
            className="input w-full"
          >
            {DRIVER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {/* Ha a YAML-ben szokatlan driver van, megőrizzük az opciók közt */}
            {entry?.driver && !DRIVER_OPTIONS.some((o) => o.value === entry.driver) && (
              <option value={entry.driver as string}>{entry.driver as string}</option>
            )}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-steel-400 mb-1">Eszköz típusa</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="input w-full"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {entry?.type && !TYPE_OPTIONS.some((o) => o.value === entry.type) && (
              <option value={entry.type as string}>{entry.type as string}</option>
            )}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 bg-steel-800/40 hover:bg-steel-800/60 rounded p-2 cursor-pointer border border-steel-700 w-fit">
        <input
          type="checkbox"
          checked={simulated}
          onChange={(e) => setSimulated(e.target.checked)}
          className="w-3 h-3 rounded bg-steel-700 border-steel-600"
        />
        <span className="text-xs text-steel-200">Szimulált (emulált) mód</span>
        <span
          className="text-[10px] text-steel-500"
          title="Ha be van pipálva, az eszköz a SimulatedDevice driverrel jön létre, valós port nélkül."
        >
          (info)
        </span>
      </label>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[11px] text-steel-400">
            Csatlakozás / driver-specifikus config (JSON)
          </label>
          {configError && (
            <span className="text-[10px] text-red-400">{configError}</span>
          )}
        </div>
        <textarea
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          className={`input w-full font-mono text-xs h-44 ${
            configError ? 'border-red-500/50' : ''
          }`}
          spellCheck={false}
        />
        <div className="text-[10px] text-steel-500 mt-1">
          Példa kulcsok: <code className="bg-steel-800 px-1 rounded">port</code>,{' '}
          <code className="bg-steel-800 px-1 rounded">baudrate</code>,{' '}
          <code className="bg-steel-800 px-1 rounded">ini_file</code>,{' '}
          <code className="bg-steel-800 px-1 rounded">protocol</code>,{' '}
          <code className="bg-steel-800 px-1 rounded">usb.{'{vid,pid,serial_number,location}'}</code>.
          A teljes objektum cseréje történik mentéskor.
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !!configError || !dirty}
          className="btn btn-primary btn-sm flex items-center gap-1 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {saving ? 'Mentés…' : 'Mentés'}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="btn btn-secondary btn-sm flex items-center gap-1 disabled:opacity-50"
          title="YAML újraolvasása diszkről (a piszkozat változások elvesznek)"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Visszatöltés
        </button>
        {dirty && !configError && (
          <span className="text-[10px] text-amber-400">Mentés nélküli változások</span>
        )}
      </div>
    </div>
  )
}
