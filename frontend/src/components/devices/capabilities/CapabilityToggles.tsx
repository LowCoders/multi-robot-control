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

const ITEMS: { key: Key; label: string; tooltip: string }[] = [
  { key: 'hasGripper', label: 'Fogókar', tooltip: 'End effector (fogókar / vákuumos / nincs) — a típust a végszerszám szerkesztőben állítod' },
  { key: 'hasLaser', label: 'Lézer', tooltip: 'Lézer modul (M3/M5 vagy egyedi)' },
  { key: 'hasSpindle', label: 'Spindle', tooltip: 'Orsó / spindle (RPM vezérléssel)' },
  { key: 'hasCoolant', label: 'Hűtés', tooltip: 'Coolant (M7/M8/M9)' },
  { key: 'hasProbe', label: 'Probe', tooltip: 'Probing (G38.x)' },
  { key: 'hasToolChanger', label: 'Tool changer', tooltip: 'Automatikus szerszámcsere' },
  { key: 'hasVacuum', label: 'Vákuum pumpa', tooltip: 'Külön vákuumpumpa' },
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

function badgeLabel(source: 'declared' | 'runtime' | 'both' | 'none'): string {
  switch (source) {
    case 'runtime':
      return 'runtime'
    case 'both':
      return 'sync'
    case 'declared':
      return 'manual'
    default:
      return ''
  }
}

export default function CapabilityToggles({ declared, effective, onChange }: Props) {
  const v = declared ?? {}

  const toggle = (key: Key, checked: boolean) => {
    onChange({ ...v, [key]: checked })
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {ITEMS.map((item) => {
        const declaredVal = v[item.key] === true
        const source = effective.source[item.key]
        return (
          <label
            key={item.key}
            className="flex items-center gap-2 bg-steel-800/40 hover:bg-steel-800/60 rounded p-2 cursor-pointer border border-steel-700"
            title={item.tooltip}
          >
            <input
              type="checkbox"
              checked={declaredVal}
              onChange={(e) => toggle(item.key, e.target.checked)}
              className="w-3 h-3 rounded bg-steel-700 border-steel-600"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-steel-200 truncate">{item.label}</div>
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
