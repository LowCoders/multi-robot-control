import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Save, Loader2 } from 'lucide-react'
import GcodeFileBrowser from './GcodeFileBrowser'

interface Props {
  isOpen: boolean
  onClose: () => void
  defaultFilename: string
  defaultDir?: string | null
  onConfirm: (
    path: string,
    overwrite: boolean
  ) => Promise<{ ok: boolean; error?: string; status?: number }>
}

const ALLOWED_EXTS = ['.nc', '.gcode', '.ngc', '.tap', '.txt']

function ensureExtension(name: string): string {
  const lower = name.toLowerCase()
  if (ALLOWED_EXTS.some((ext) => lower.endsWith(ext))) return name
  return `${name}.nc`
}

export default function SaveGcodeAsModal({
  isOpen,
  onClose,
  defaultFilename,
  defaultDir,
  onConfirm,
}: Props) {
  const { t } = useTranslation('visualization')
  const [filename, setFilename] = useState(defaultFilename || 'program.nc')
  const [currentDir, setCurrentDir] = useState<string | null>(defaultDir || null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setFilename(defaultFilename || 'program.nc')
      setConfirmingOverwrite(false)
      setError(null)
    }
  }, [isOpen, defaultFilename])

  if (!isOpen) return null

  const finalName = ensureExtension(filename.trim())
  const fullPath = currentDir ? `${currentDir.replace(/\/$/, '')}/${finalName}` : ''

  const doSave = async (overwrite: boolean) => {
    if (!fullPath) return
    setSaving(true)
    setError(null)
    const result = await onConfirm(fullPath, overwrite)
    setSaving(false)
    if (result.ok) {
      onClose()
      return
    }
    if (result.status === 409 && !overwrite) {
      setConfirmingOverwrite(true)
      return
    }
    setError(result.error || t('save_modal.save_error'))
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="card w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="card-header flex items-center justify-between">
          <span className="font-medium flex items-center gap-2">
            <Save className="w-4 h-4 text-machine-400" />
            {t('save_modal.title')}
          </span>
          <button onClick={onClose} className="text-steel-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="card-body overflow-y-auto flex-1 space-y-3">
          <GcodeFileBrowser
            initialDir={defaultDir || null}
            hideFiles={false}
            onCurrentDirChange={(d) => setCurrentDir(d)}
            onPickFile={(file) => {
              setFilename(file.name)
              setConfirmingOverwrite(false)
            }}
          />

          <div>
            <label className="block text-sm text-steel-400 mb-1">
              {t('save_modal.filename_label')}
            </label>
            <input
              type="text"
              value={filename}
              onChange={(e) => {
                setFilename(e.target.value)
                setConfirmingOverwrite(false)
              }}
              className="input w-full"
              placeholder={t('save_modal.filename_placeholder')}
              autoFocus
            />
            <p className="text-xs text-steel-500 mt-1">
              {t('save_modal.extensions_hint', { exts: ALLOWED_EXTS.join(', ') })}
            </p>
          </div>

          {fullPath && (
            <div className="text-xs text-steel-400 break-all">
              {t('save_modal.path_prefix')} <span className="text-steel-200">{fullPath}</span>
            </div>
          )}

          {confirmingOverwrite && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
              {t('save_modal.exists_prompt')}
            </div>
          )}

          {error && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="card-footer flex justify-end gap-2 border-t border-steel-700 px-4 py-3">
          <button onClick={onClose} className="btn btn-secondary">
            {t('save_modal.cancel')}
          </button>
          {confirmingOverwrite ? (
            <button
              onClick={() => doSave(true)}
              disabled={saving}
              className="btn btn-danger flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('save_modal.overwrite')}
            </button>
          ) : (
            <button
              onClick={() => doSave(false)}
              disabled={saving || !filename.trim() || !currentDir}
              className="btn btn-primary flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <Save className="w-4 h-4" />
              {t('save_modal.confirm_save')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
