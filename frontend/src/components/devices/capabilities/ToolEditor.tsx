import { useTranslation } from 'react-i18next'
import { Drill } from 'lucide-react'
import type { ToolConfig } from '../../../types/machine-config'

interface Props {
  value: ToolConfig | undefined
  onChange: (next: ToolConfig) => void
}

const DEFAULT: ToolConfig = { diameter: 6, length: 30, type: 'endmill' }

export default function ToolEditor({ value, onChange }: Props) {
  const { t } = useTranslation('devices')
  const v = value ?? DEFAULT
  const update = (patch: Partial<ToolConfig>) => onChange({ ...v, ...patch })

  return (
    <div className="bg-steel-800/40 rounded-lg border border-steel-700 p-3 space-y-2">
      <div className="flex items-center gap-2 text-steel-300 text-xs font-medium">
        <Drill className="w-3 h-3" />
        {t('cap_editors.tool.title')}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[11px] text-steel-500 mb-1">{t('cap_editors.tool.diameter')}</label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={v.diameter}
            onChange={(e) => update({ diameter: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-[11px] text-steel-500 mb-1">{t('cap_editors.tool.length')}</label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={v.length}
            onChange={(e) => update({ length: parseFloat(e.target.value) || 0 })}
            className="input w-full text-xs py-1"
          />
        </div>
        <div>
          <label className="block text-[11px] text-steel-500 mb-1">{t('cap_editors.tool.type')}</label>
          <select
            value={v.type ?? 'endmill'}
            onChange={(e) => update({ type: e.target.value as ToolConfig['type'] })}
            className="input w-full text-xs py-1"
          >
            <option value="endmill">{t('cap_editors.tool.type_endmill')}</option>
            <option value="ballnose">{t('cap_editors.tool.type_ballnose')}</option>
            <option value="drill">{t('cap_editors.tool.type_drill')}</option>
            <option value="laser">{t('cap_editors.tool.type_laser')}</option>
            <option value="custom">{t('cap_editors.tool.type_custom')}</option>
          </select>
        </div>
      </div>
    </div>
  )
}
