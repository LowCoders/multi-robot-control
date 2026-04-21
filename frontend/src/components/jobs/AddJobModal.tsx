/**
 * Új job hozzáadási modal a JobManager oldalhoz.
 *
 * Korábban a `pages/JobManager.tsx` belső `function AddJobModal(...)`
 * blokkja volt; külön fájlba emelve csökken a parent oldal mérete és
 * a modal könnyebben tesztelhető / cserélhető.
 *
 * A modal a `localStorage`-ból emlékszik az utoljára kiválasztott
 * eszközre (`jobManager.lastDeviceId`).
 */

import { useEffect, useState } from 'react'
import {
  FileCode,
  FolderOpen,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
import { createLogger } from '../../utils/logger'
import { useTranslation } from 'react-i18next'

const log = createLogger('jobs.add-modal')

const STORAGE_KEY_LAST_DEVICE = 'jobManager.lastDeviceId'

const TEST_FILES = [
  { name: 'test_square.nc', path: '/web/arduino/test_gcode/test_square.nc', time: 2 },
  { name: 'test_circle.nc', path: '/web/arduino/test_gcode/test_circle.nc', time: 3 },
  { name: 'test_engrave.nc', path: '/web/arduino/test_gcode/test_engrave.nc', time: 5 },
] as const

const loadLastDevice = (): string => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_LAST_DEVICE) ?? '""')
  } catch {
    return ''
  }
}

const saveLastDevice = (id: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY_LAST_DEVICE, JSON.stringify(id))
  } catch (err) {
    log.error('Failed to persist last device id:', err)
  }
}

export interface AddJobSubmitPayload {
  name: string
  deviceId: string
  filepath: string
  estimatedTime?: number
}

export interface AddJobModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (job: AddJobSubmitPayload) => void
  devices: { id: string; name: string }[]
}

export default function AddJobModal({
  isOpen,
  onClose,
  onSubmit,
  devices,
}: AddJobModalProps) {
  const { t } = useTranslation('pages')
  const [formData, setFormData] = useState(() => ({
    name: '',
    deviceId: loadLastDevice(),
    filepath: '',
    estimatedTime: '',
  }))
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (devices.length > 0 && !formData.deviceId) {
      const lastId = loadLastDevice()
      const validId = devices.find((d) => d.id === lastId)?.id || devices[0].id
      setFormData((prev) => ({ ...prev, deviceId: validId }))
    }
  }, [devices, formData.deviceId])

  const handleDeviceChange = (deviceId: string) => {
    setFormData({ ...formData, deviceId })
    saveLastDevice(deviceId)
  }

  if (!isOpen) return null

  const handleSelectTestFile = (file: typeof TEST_FILES[number]) => {
    setFormData({
      ...formData,
      name: file.name,
      filepath: file.path,
      estimatedTime: file.time.toString(),
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    await onSubmit({
      name: formData.name || formData.filepath.split('/').pop() || t('job_manager.add_modal.default_name'),
      deviceId: formData.deviceId,
      filepath: formData.filepath,
      estimatedTime: formData.estimatedTime
        ? parseInt(formData.estimatedTime, 10)
        : undefined,
    })

    setIsSubmitting(false)
    setFormData({
      name: '',
      deviceId: devices[0]?.id || '',
      filepath: '',
      estimatedTime: '',
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="card w-full max-w-lg mx-4">
        <div className="card-header flex items-center justify-between">
          <span className="font-medium">{t('job_manager.add_modal.title')}</span>
          <button onClick={onClose} className="text-steel-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="card-body space-y-4">
          <div>
            <label className="block text-sm text-steel-400 mb-2">
              Gyors választás (teszt fájlok)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {TEST_FILES.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => handleSelectTestFile(file)}
                  className={`p-2 rounded-lg border text-sm text-left transition-colors ${
                    formData.filepath === file.path
                      ? 'border-machine-500 bg-machine-500/20 text-machine-400'
                      : 'border-steel-700 hover:border-steel-500 text-steel-300'
                  }`}
                >
                  <FileCode className="w-4 h-4 mb-1" />
                  {file.name}
                </button>
              ))}
            </div>
          </div>

          <div className="text-center text-steel-500 text-sm">{t('job_manager.add_modal.or_divider')}</div>

          <div>
            <label className="block text-sm text-steel-400 mb-1">
              <FolderOpen className="w-4 h-4 inline mr-1" />
              {t('job_manager.add_modal.filepath_label')}
            </label>
            <input
              type="text"
              value={formData.filepath}
              onChange={(e) => setFormData({ ...formData, filepath: e.target.value })}
              className="input w-full"
              placeholder={t('job_manager.add_modal.filepath_placeholder')}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-steel-400 mb-1">{t('job_manager.add_modal.name_label')}</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="input w-full"
              placeholder={t('job_manager.add_modal.name_placeholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-steel-400 mb-1">{t('job_manager.add_modal.target_device')}</label>
              <select
                value={formData.deviceId}
                onChange={(e) => handleDeviceChange(e.target.value)}
                className="input w-full"
                required
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-steel-400 mb-1">{t('job_manager.add_modal.time_label')}</label>
              <input
                type="number"
                value={formData.estimatedTime}
                onChange={(e) => setFormData({ ...formData, estimatedTime: e.target.value })}
                className="input w-full"
                placeholder={t('job_manager.add_modal.time_placeholder')}
                min="1"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1">
              {t('job_manager.add_modal.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.filepath || !formData.deviceId}
              className="btn btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {t('job_manager.add_modal.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
