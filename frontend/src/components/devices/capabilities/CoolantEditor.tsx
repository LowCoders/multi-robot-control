import { useTranslation } from 'react-i18next'
import { Droplets } from 'lucide-react'
import type { CoolantConfig, CoolantMode } from '../../../types/machine-config'

interface Props {
  value: CoolantConfig | undefined
  onChange: (next: CoolantConfig) => void
}

const DEFAULT: CoolantConfig = { mode: 'flood' }

export default function CoolantEditor({ value, onChange }: Props) {
  const { t } = useTranslation('devices')
  const v = value ?? DEFAULT
  const update = (patch: Partial<CoolantConfig>) => onChange({ ...v, ...patch })

  return (
    <div className="bg-steel-800/40 rounded-lg border border-steel-700 p-3 space-y-2">
      <div className="flex items-center gap-2 text-steel-300 text-xs font-medium">
        <Droplets className="w-3 h-3" />
        {t('cap_editors.coolant.title')}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[11px] text-steel-500 mb-1">{t('cap_editors.coolant.mode')}</label>
          <select
            value={v.mode ?? 'flood'}
            onChange={(e) => update({ mode: e.target.value as CoolantMode })}
            className="input w-full text-xs py-1"
          >
            <option value="flood">{t('cap_editors.coolant.mode_flood')}</option>
            <option value="mist">{t('cap_editors.coolant.mode_mist')}</option>
            <option value="air">{t('cap_editors.coolant.mode_air')}</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-steel-500 mb-1" title={t('cap_editors.coolant.override_hint')}>
            {t('cap_editors.coolant.on_override')}
          </label>
          <input
            type="text"
            value={v.mGcodeOn ?? ''}
            placeholder="M8"
            onChange={(e) => update({ mGcodeOn: e.target.value || undefined })}
            className="input w-full text-xs py-1 font-mono"
          />
        </div>
        <div>
          <label className="block text-[11px] text-steel-500 mb-1" title={t('cap_editors.coolant.override_hint')}>
            {t('cap_editors.coolant.off_override')}
          </label>
          <input
            type="text"
            value={v.mGcodeOff ?? ''}
            placeholder="M9"
            onChange={(e) => update({ mGcodeOff: e.target.value || undefined })}
            className="input w-full text-xs py-1 font-mono"
          />
        </div>
      </div>
    </div>
  )
}
