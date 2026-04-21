import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import type { LaserConfig } from '../../../types/machine-config'

interface Props {
  value: LaserConfig | undefined
  onChange: (next: LaserConfig) => void
}

const DEFAULT: LaserConfig = { maxPower: 1000, pwmFreq: 1000, defaultPower: 500 }

export default function LaserEditor({ value, onChange }: Props) {
  const { t } = useTranslation('devices')
  const v = value ?? DEFAULT
  const update = (patch: Partial<LaserConfig>) => onChange({ ...v, ...patch })

  return (
    <div className="bg-steel-800/40 rounded-lg border border-steel-700 p-3 space-y-2">
      <div className="flex items-center gap-2 text-steel-300 text-xs font-medium">
        <Zap className="w-3 h-3" />
        {t('cap_editors.laser.title')}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[11px] text-steel-500 mb-1" title={t('cap_editors.laser.max_power_title')}>
            {t('cap_editors.laser.max_power')}
          </label>
          <input
            type="number"
            min={0}
            value={v.maxPower}
            onChange={(e) => update({ maxPower: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-[11px] text-steel-500 mb-1">{t('cap_editors.laser.pwm_hz')}</label>
          <input
            type="number"
            min={0}
            value={v.pwmFreq ?? 0}
            onChange={(e) => update({ pwmFreq: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-[11px] text-steel-500 mb-1" title={t('cap_editors.laser.default_power_title')}>
            {t('cap_editors.laser.default_power')}
          </label>
          <input
            type="number"
            min={0}
            max={v.maxPower}
            value={v.defaultPower ?? 0}
            onChange={(e) => update({ defaultPower: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
      </div>
    </div>
  )
}
