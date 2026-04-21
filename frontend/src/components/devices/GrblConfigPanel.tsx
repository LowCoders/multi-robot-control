import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, RefreshCw, Save } from 'lucide-react'
import {
  getGrblSettingDescription,
  hasKnownGrblSettingDescription,
} from '../../constants/grblSettings'
import { apiGet, apiPost, HttpError } from '../../utils/apiClient'

interface GrblConfigPanelProps {
  deviceId: string
}

type GrblSettings = Record<string, number>
type StringSettings = Record<string, string>

const INTEGER_ONLY_SETTINGS = new Set([1, 4])

function isIntegerOnlySetting(settingId: number): boolean {
  return INTEGER_ONLY_SETTINGS.has(settingId)
}

function normalizeGrblSettingValue(settingId: number, value: number): number {
  return isIntegerOnlySetting(settingId) ? Math.round(value) : value
}

function toStringSettings(settings: GrblSettings): StringSettings {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => {
      const settingId = Number(key)
      const normalized = normalizeGrblSettingValue(settingId, Number(value))
      return [key, normalized.toString()]
    })
  )
}

function hasNumericValue(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return Number.isFinite(Number(trimmed))
}

export default function GrblConfigPanel({ deviceId }: GrblConfigPanelProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [originalSettings, setOriginalSettings] = useState<GrblSettings>({})
  const [editedSettings, setEditedSettings] = useState<StringSettings>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [showKnownOnly, setShowKnownOnly] = useState(false)

  const loadSettings = async () => {
    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const payload = await apiGet('/devices/{device_id}/grbl-settings', {
        path: { device_id: deviceId },
      })
      const incoming = ((payload as { settings?: GrblSettings }).settings ?? {}) as GrblSettings
      setOriginalSettings(incoming)
      setEditedSettings(toStringSettings(incoming))
      setFieldErrors({})
    } catch (err) {
      const message =
        err instanceof HttpError
          ? `${err.message} (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Ismeretlen hiba'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId])

  const orderedKeys = useMemo(
    () => Object.keys(editedSettings).sort((a, b) => Number(a) - Number(b)),
    [editedSettings]
  )

  const changedSettings = useMemo(() => {
    const changed: GrblSettings = {}
    for (const key of orderedKeys) {
      const raw = editedSettings[key]
      if (!hasNumericValue(raw)) continue
      const settingId = Number(key)
      const parsed = normalizeGrblSettingValue(settingId, Number(raw))
      const original = normalizeGrblSettingValue(settingId, Number(originalSettings[key] ?? NaN))
      if (original !== parsed) {
        changed[key] = parsed
      }
    }
    return changed
  }, [editedSettings, orderedKeys, originalSettings])

  const visibleKeys = useMemo(() => {
    if (!showKnownOnly) return orderedKeys
    return orderedKeys.filter((key) => hasKnownGrblSettingDescription(Number(key)))
  }, [orderedKeys, showKnownOnly])

  const hasChanges = Object.keys(changedSettings).length > 0

  const validateFields = (): boolean => {
    const nextErrors: Record<string, string> = {}
    for (const key of orderedKeys) {
      const raw = editedSettings[key]
      if (!hasNumericValue(raw)) {
        nextErrors[key] = 'Invalid number'
        continue
      }
      const settingId = Number(key)
      if (isIntegerOnlySetting(settingId) && !Number.isInteger(Number(raw))) {
        nextErrors[key] = 'Integer required'
      }
    }
    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleApply = async () => {
    if (!validateFields()) {
      setError('Fix invalid values before apply.')
      return
    }

    if (!hasChanges) return

    setSaving(true)
    setError(null)
    setSuccessMessage(null)

    try {
      await apiPost('/devices/{device_id}/grbl-settings/batch', {
        path: { device_id: deviceId },
        body: { settings: changedSettings },
      })

      setSuccessMessage('GRBL settings updated.')
      await loadSettings()
    } catch (err) {
      const message =
        err instanceof HttpError
          ? `${err.message} (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Ismeretlen hiba'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setEditedSettings(toStringSettings(originalSettings))
    setFieldErrors({})
    setError(null)
  }

  if (loading) {
    return <div className="text-steel-400 py-6">GRBL settings betöltése...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="space-y-1">
          <div className="text-sm text-steel-300">
            Click value fields to edit. Apply sends only changed parameters.
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-steel-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showKnownOnly}
              onChange={(e) => setShowKnownOnly(e.target.checked)}
              className="w-3 h-3 rounded bg-steel-800 border-steel-600"
            />
            Csak funkcióval rendelkező beállítások
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadSettings()}
            className="btn btn-secondary btn-sm flex items-center gap-1"
            disabled={saving}
          >
            <RefreshCw className="w-3 h-3" />
            Frissítés
          </button>
          <button
            onClick={handleReset}
            className="btn btn-secondary btn-sm"
            disabled={saving || (!hasChanges && Object.keys(fieldErrors).length === 0)}
          >
            Visszaállítás
          </button>
          <button
            onClick={handleApply}
            className="btn btn-primary btn-sm flex items-center gap-1"
            disabled={saving || !hasChanges}
          >
            <Save className="w-3 h-3" />
            {saving ? 'Alkalmazás...' : 'Alkalmaz'}
          </button>
        </div>
      </div>

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

      <div className="overflow-x-auto border border-steel-700 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-steel-900">
            <tr className="text-left text-steel-300">
              <th className="px-3 py-2">Parameter</th>
              <th className="px-3 py-2">Description (EN)</th>
              <th className="px-3 py-2 w-52">Value</th>
              <th className="px-3 py-2 w-24">State</th>
            </tr>
          </thead>
          <tbody>
            {visibleKeys.map((key) => {
              const settingId = Number(key)
              const value = editedSettings[key] ?? ''
              const isDirty =
                hasNumericValue(value) &&
                normalizeGrblSettingValue(settingId, Number(value)) !==
                  normalizeGrblSettingValue(settingId, Number(originalSettings[key] ?? NaN))
              const fieldError = fieldErrors[key]

              return (
                <tr key={key} className="border-t border-steel-800">
                  <td className="px-3 py-2 font-mono text-steel-200">${key}</td>
                  <td className="px-3 py-2 text-steel-400">
                    {getGrblSettingDescription(settingId)}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => {
                        const next = e.target.value
                        setEditedSettings((prev) => ({ ...prev, [key]: next }))
                        setFieldErrors((prev) => {
                          if (!prev[key]) return prev
                          const copy = { ...prev }
                          delete copy[key]
                          return copy
                        })
                      }}
                      className={`input w-full ${fieldError ? 'border-red-500' : ''}`}
                    />
                    {fieldError && (
                      <div className="text-xs text-red-400 mt-1">{fieldError}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isDirty ? (
                      <span className="text-amber-400 text-xs">modified</span>
                    ) : (
                      <span className="text-steel-500 text-xs">saved</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {visibleKeys.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-steel-400" colSpan={4}>
                  {orderedKeys.length === 0
                    ? 'No GRBL settings were returned by the device.'
                    : 'No settings match the active filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
