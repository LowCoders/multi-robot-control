import { useTranslation } from 'react-i18next'
import type { DeclaredCapabilities } from '../../../types/machine-config'
import type { EffectiveCapabilities } from '../../../utils/capabilities'

interface Props {
  declared: DeclaredCapabilities | undefined
  effective: EffectiveCapabilities
  onChange: (next: DeclaredCapabilities) => void
}

type Key = keyof Pick<
  DeclaredCapabilities,
  'hasGripper' | 'hasLaser' | 'hasSpindle' | 'hasCoolant' | 'hasProbe' | 'hasToolChanger' | 'hasVacuum'
>

const KEYS: Key[] = [
  'hasGripper',
  'hasLaser',
  'hasSpindle',
  'hasCoolant',
  'hasProbe',
  'hasToolChanger',
  'hasVacuum',
]

function badgeStyle(source: 'declared' | 'runtime' | 'both' | 'none'): string {
  switch (source) {
    case 'runtime':
      return 'bg-blue-500/20 text-blue-300 border-blue-500/40'
    case 'both':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    case 'declared':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    default:
      return 'bg-steel-700/40 text-steel-500 border-steel-700'
  }
}

export default function CapabilityToggles({ declared, effective, onChange }: Props) {
  const { t } = useTranslation('devices')
  const v = declared ?? {}

  const badgeLabel = (source: 'declared' | 'runtime' | 'both' | 'none'): string => {
    switch (source) {
      case 'runtime':
        return t('capability_toggles.badge_runtime')
      case 'both':
        return t('capability_toggles.badge_sync')
      case 'declared':
        return t('capability_toggles.badge_manual')
      default:
        return ''
    }
  }

  const toggle = (key: Key, checked: boolean) => {
    onChange({ ...v, [key]: checked })
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {KEYS.map((key) => {
        const declaredVal = v[key] === true
        const source = effective.source[key]
        return (
          <label
            key={key}
            className="flex items-center gap-2 bg-steel-800/40 hover:bg-steel-800/60 rounded p-2 cursor-pointer border border-steel-700"
            title={t(`capability_toggles.${key}.tooltip`)}
          >
            <input
              type="checkbox"
              checked={declaredVal}
              onChange={(e) => toggle(key, e.target.checked)}
              className="w-3 h-3 rounded bg-steel-700 border-steel-600"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-steel-200 truncate">{t(`capability_toggles.${key}.label`)}</div>
              {source !== 'none' && (
                <div className={`inline-block text-[9px] uppercase tracking-wide px-1 mt-0.5 rounded border ${badgeStyle(source)}`}>
                  {badgeLabel(source)}
                </div>
              )}
            </div>
          </label>
        )
      })}
    </div>
  )
}
