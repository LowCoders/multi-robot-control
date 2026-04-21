import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Wifi,
  CheckCircle,
  AlertCircle,
  RotateCcw,
  Save,
  RefreshCw,
} from 'lucide-react'

// grblHAL networking-plugin setting numbers.  Reference: grblHAL/networking
// settings.c — these IDs are stable across the ESP32 IDF and ESP-AT builds.
//   $70 = services bitmask (bit0=Telnet, bit1=Websocket, bit2=HTTP, bit3=FTP, bit4=DNS, bit5=mDNS, bit6=SSDP)
//   $71 = hostname (string)
//   $73 = WiFi mode (0=off, 1=STA, 2=AP, 3=AP/STA)
//   $74 = AP SSID  (string)
//   $75 = AP password (string)
//   $76 = STA SSID (string)
//   $77 = STA password (string)
//   $79 = AP country code (string, optional)
//   $300 = telnet port (numeric, default 23)
//
// Note: in some grblHAL builds the WiFi-mode setting is exposed under a
// different number (e.g. $73 for AP-mode-only builds reuses the slot for the
// SSID).  We therefore expose `wifiMode` as a free-text/select control and
// only push it when the user explicitly changes it; SSID/password fields are
// independent of mode selection.
const SETTINGS = {
  HOSTNAME: '71',
  WIFI_MODE: '73',
  AP_SSID: '74',
  AP_PASSWORD: '75',
  STA_SSID: '76',
  STA_PASSWORD: '77',
  TELNET_PORT: '300',
} as const

interface NetworkForm {
  hostname: string
  wifiMode: string  // grblHAL numeric mode as string ("0"…"3")
  apSsid: string
  apPassword: string
  staSsid: string
  staPassword: string
  telnetPort: string
}

const EMPTY_FORM: NetworkForm = {
  hostname: '',
  wifiMode: '2',  // SoftAP-only; matches the project default in my_machine.h
  apSsid: '',
  apPassword: '',
  staSsid: '',
  staPassword: '',
  telnetPort: '23',
}

interface NetworkConfigPanelProps {
  deviceId: string
}

export default function NetworkConfigPanel({ deviceId }: NetworkConfigPanelProps) {
  const { t } = useTranslation('devices')
  const [form, setForm] = useState<NetworkForm>(EMPTY_FORM)
  const [original, setOriginal] = useState<NetworkForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showApPass, setShowApPass] = useState(false)
  const [showStaPass, setShowStaPass] = useState(false)

  const formFromSettings = useCallback(
    (settings: Record<string, unknown>): NetworkForm => {
      const get = (key: string, fallback: string) => {
        const v = settings[key]
        if (v == null) return fallback
        return typeof v === 'string' ? v : String(v)
      }
      return {
        hostname: get(SETTINGS.HOSTNAME, ''),
        wifiMode: get(SETTINGS.WIFI_MODE, '2'),
        apSsid: get(SETTINGS.AP_SSID, ''),
        apPassword: get(SETTINGS.AP_PASSWORD, ''),
        staSsid: get(SETTINGS.STA_SSID, ''),
        staPassword: get(SETTINGS.STA_PASSWORD, ''),
        telnetPort: get(SETTINGS.TELNET_PORT, '23'),
      }
    },
    []
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/devices/${deviceId}/grbl-settings`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      const settings = (data?.settings ?? {}) as Record<string, unknown>
      const next = formFromSettings(settings)
      setForm(next)
      setOriginal(next)
    } catch (e) {
      setError(t('network_config.fetch_failed', { detail: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }, [deviceId, formFromSettings, t])

  useEffect(() => {
    refresh()
  }, [refresh])

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(original),
    [form, original]
  )

  const handleResetDefaults = useCallback(() => {
    // Per project convention: device-id is reused as both AP/STA SSID and
    // hostname; the password is the project-wide "panelDefault".  Only the
    // form is mutated here — Apply still has to be pressed to persist.
    setForm({
      hostname: deviceId,
      wifiMode: '2',
      apSsid: deviceId,
      apPassword: 'panelDefault',
      staSsid: deviceId,
      staPassword: 'panelDefault',
      telnetPort: '23',
    })
  }, [deviceId])

  const handleRevert = useCallback(() => {
    setForm(original)
  }, [original])

  const handleApply = useCallback(async () => {
    setApplying(true)
    setError(null)
    setSuccess(null)
    try {
      const payload: Record<string, number | string> = {}
      // Only push settings that actually changed — networking writes touch
      // the controller's EEPROM and may require a reboot, so we keep the
      // batch as small as possible.
      if (form.hostname !== original.hostname) payload[SETTINGS.HOSTNAME] = form.hostname
      if (form.wifiMode !== original.wifiMode) {
        const n = parseInt(form.wifiMode, 10)
        if (Number.isFinite(n)) payload[SETTINGS.WIFI_MODE] = n
      }
      if (form.apSsid !== original.apSsid) payload[SETTINGS.AP_SSID] = form.apSsid
      if (form.apPassword !== original.apPassword) payload[SETTINGS.AP_PASSWORD] = form.apPassword
      if (form.staSsid !== original.staSsid) payload[SETTINGS.STA_SSID] = form.staSsid
      if (form.staPassword !== original.staPassword) payload[SETTINGS.STA_PASSWORD] = form.staPassword
      if (form.telnetPort !== original.telnetPort) {
        const n = parseInt(form.telnetPort, 10)
        if (Number.isFinite(n)) payload[SETTINGS.TELNET_PORT] = n
      }

      if (Object.keys(payload).length === 0) {
        setSuccess(t('network_config.no_change'))
        setTimeout(() => setSuccess(null), 2000)
        return
      }

      const res = await fetch(`/api/devices/${deviceId}/grbl-settings/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      setSuccess(t('network_config.sent_restart'))
      setOriginal(form)
      setTimeout(() => setSuccess(null), 4000)
    } catch (e) {
      setError(t('network_config.apply_failed', { detail: (e as Error).message }))
    } finally {
      setApplying(false)
    }
  }, [deviceId, form, original, t])

  return (
    <details open className="bg-steel-900/50 rounded-lg border border-steel-700 group">
      <summary className="flex items-center gap-2 text-steel-300 text-sm font-medium p-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <Wifi className="w-4 h-4" />
        {t('network_config.panel_title')}
        <span className="ml-auto text-steel-500 text-xs group-open:rotate-90 transition-transform">▶</span>
      </summary>
      <div className="px-3 pb-3 space-y-3">
        <div className="text-[11px] text-steel-500">{t('network_config.intro')}</div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-2 flex items-center gap-2 text-red-400 text-xs">
            <AlertCircle className="w-3 h-3 flex-shrink-0" /> {error}
          </div>
        )}
        {success && (
          <div className="bg-green-500/10 border border-green-500/30 rounded p-2 flex items-center gap-2 text-green-400 text-xs">
            <CheckCircle className="w-3 h-3 flex-shrink-0" /> {success}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-steel-500 mb-1">Hostname ($71)</label>
            <input
              type="text"
              value={form.hostname}
              onChange={(e) => setForm({ ...form, hostname: e.target.value })}
              className="input w-full text-xs py-1"
              placeholder={deviceId}
            />
          </div>
          <div>
            <label className="block text-xs text-steel-500 mb-1">WiFi mode ($73)</label>
            <select
              value={form.wifiMode}
              onChange={(e) => setForm({ ...form, wifiMode: e.target.value })}
              className="input w-full text-xs py-1"
            >
              <option value="0">0 — Off</option>
              <option value="1">1 — STA (csatlakozás meglévő hálózatra)</option>
              <option value="2">2 — AP (CrowPanel csatlakozik ide)</option>
              <option value="3">3 — AP/STA</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-steel-500 mb-1">AP SSID ($74)</label>
            <input
              type="text"
              value={form.apSsid}
              onChange={(e) => setForm({ ...form, apSsid: e.target.value })}
              className="input w-full text-xs py-1"
              placeholder={deviceId}
            />
          </div>
          <div>
            <label className="block text-xs text-steel-500 mb-1">
              AP Password ($75)
              <button
                type="button"
                onClick={() => setShowApPass((v) => !v)}
                className="ml-2 text-steel-400 hover:text-steel-200"
              >
                {showApPass ? '(elrejt)' : '(mutat)'}
              </button>
            </label>
            <input
              type={showApPass ? 'text' : 'password'}
              value={form.apPassword}
              onChange={(e) => setForm({ ...form, apPassword: e.target.value })}
              className="input w-full text-xs py-1"
              placeholder="panelDefault"
            />
          </div>
          <div>
            <label className="block text-xs text-steel-500 mb-1">STA SSID ($76)</label>
            <input
              type="text"
              value={form.staSsid}
              onChange={(e) => setForm({ ...form, staSsid: e.target.value })}
              className="input w-full text-xs py-1"
              placeholder={deviceId}
            />
          </div>
          <div>
            <label className="block text-xs text-steel-500 mb-1">
              STA Password ($77)
              <button
                type="button"
                onClick={() => setShowStaPass((v) => !v)}
                className="ml-2 text-steel-400 hover:text-steel-200"
              >
                {showStaPass ? '(elrejt)' : '(mutat)'}
              </button>
            </label>
            <input
              type={showStaPass ? 'text' : 'password'}
              value={form.staPassword}
              onChange={(e) => setForm({ ...form, staPassword: e.target.value })}
              className="input w-full text-xs py-1"
              placeholder="panelDefault"
            />
          </div>
          <div>
            <label className="block text-xs text-steel-500 mb-1">Telnet port ($300)</label>
            <input
              type="number"
              value={form.telnetPort}
              onChange={(e) => setForm({ ...form, telnetPort: e.target.value })}
              className="input w-full text-xs py-1"
              min={1}
              max={65535}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="btn btn-secondary btn-sm text-xs flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />{' '}
            {t('network_config.refresh')}
          </button>
          <button
            type="button"
            onClick={handleResetDefaults}
            className="btn btn-secondary btn-sm text-xs flex items-center gap-1"
            title={`SSID/hostname = "${deviceId}", password = "panelDefault"`}
          >
            <RotateCcw className="w-3 h-3" /> {t('network_config.reset_defaults')}
          </button>
          <button
            type="button"
            onClick={handleRevert}
            disabled={!dirty}
            className="btn btn-secondary btn-sm text-xs flex items-center gap-1 disabled:opacity-50"
          >
            {t('network_config.revert')}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!dirty || applying}
            className="btn btn-primary btn-sm text-xs flex items-center gap-1 disabled:opacity-50 ml-auto"
          >
            <Save className="w-3 h-3" />
            {applying ? t('network_config.applying') : t('network_config.apply')}
          </button>
        </div>
      </div>
    </details>
  )
}
