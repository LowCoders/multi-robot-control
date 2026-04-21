import { useTranslation } from 'react-i18next'
import { Disc3 } from 'lucide-react'
import type { SpindleConfig } from '../../../types/machine-config'

interface Props {
  value: SpindleConfig | undefined
  onChange: (next: SpindleConfig) => void
}

const DEFAULT: SpindleConfig = { maxRpm: 24000, minRpm: 0, diameter: 52, length: 80 }

export default function SpindleEditor({ value, onChange }: Props) {
  const { t } = useTranslation('devices')
  const v = value ?? DEFAULT
  const update = (patch: Partial<SpindleConfig>) => onChange({ ...v, ...patch })

  return (
    <div className="bg-steel-800/40 rounded-lg border border-steel-700 p-3 space-y-2">
      <div className="flex items-center gap-2 text-steel-300 text-xs font-medium">
        <Disc3 className="w-3 h-3" />
        {t('cap_editors.spindle.title')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-steel-500 mb-1">{t('cap_editors.spindle.max_rpm')}</label>
          <input
            type="number"
            min={0}
            value={v.maxRpm}
            onChange={(e) => update({ maxRpm: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-[11px] text-steel-500 mb-1">{t('cap_editors.spindle.min_rpm')}</label>
          <input
            type="number"
            min={0}
            value={v.minRpm ?? 0}
            onChange={(e) => update({ minRpm: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-[11px] text-steel-500 mb-1">{t('cap_editors.spindle.diameter')}</label>
          <input
            type="number"
            min={0}
            value={v.diameter ?? 0}
            onChange={(e) => update({ diameter: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-[11px] text-steel-500 mb-1">{t('cap_editors.spindle.length')}</label>
          <input
            type="number"
            min={0}
            value={v.length ?? 0}
            onChange={(e) => update({ length: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
      </div>
    </div>
  )
}
