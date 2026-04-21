import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, FolderOpen, FileCode, HardDrive, Cloud } from 'lucide-react'
import GcodeFileBrowser from './GcodeFileBrowser'

interface Props {
  isOpen: boolean
  onClose: () => void
  onPickServerFile: (filepath: string) => void
  onPickLocalFile: (filename: string, text: string) => void
}

type Tab = 'server' | 'local'

export default function OpenGcodeModal({
  isOpen,
  onClose,
  onPickServerFile,
  onPickLocalFile,
}: Props) {
  const { t } = useTranslation('visualization')
  const [tab, setTab] = useState<Tab>('server')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    onPickLocalFile(file.name, text)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="card w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="card-header flex items-center justify-between">
          <span className="font-medium flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-machine-400" />
            {t('open_modal.title')}
          </span>
          <button onClick={onClose} className="text-steel-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-steel-700">
          <button
            onClick={() => setTab('server')}
            className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
              tab === 'server'
                ? 'border-b-2 border-machine-500 text-machine-400'
                : 'text-steel-400 hover:text-steel-200'
            }`}
          >
            <Cloud className="w-4 h-4" />
            {t('open_modal.tab_server')}
          </button>
          <button
            onClick={() => setTab('local')}
            className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
              tab === 'local'
                ? 'border-b-2 border-machine-500 text-machine-400'
                : 'text-steel-400 hover:text-steel-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            {t('open_modal.tab_local')}
          </button>
        </div>

        <div className="card-body overflow-y-auto flex-1">
          {tab === 'server' ? (
            <GcodeFileBrowser
              onPickFile={(file) => {
                onPickServerFile(file.path)
                onClose()
              }}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-steel-300">{t('open_modal.local_help')}</p>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".nc,.gcode,.ngc,.tap,.txt"
                  onChange={handleLocalFile}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <FileCode className="w-4 h-4" />
                  {t('open_modal.pick_file')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
