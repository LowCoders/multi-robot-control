import { Hand } from 'lucide-react'
import type { EndEffectorConfig, EndEffectorType } from '../../../types/machine-config'

interface Props {
  value: EndEffectorConfig | undefined
  onChange: (next: EndEffectorConfig) => void
}

const DEFAULT: EndEffectorConfig = {
  type: 'gripper',
  gripperWidth: 60,
  gripperLength: 50,
  gripperFingerCount: 2,
}

export default function EndEffectorEditor({ value, onChange }: Props) {
  const v = value ?? DEFAULT
  const update = (patch: Partial<EndEffectorConfig>) => onChange({ ...v, ...patch })

  return (
    <div className="bg-steel-800/40 rounded-lg border border-steel-700 p-3 space-y-2">
      <div className="flex items-center gap-2 text-steel-300 text-xs font-medium">
        <Hand className="w-3 h-3" />
        Végszerszám (End Effector)
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-steel-500 mb-1">Típus</label>
          <select
            value={v.type}
            onChange={(e) => update({ type: e.target.value as EndEffectorType })}
            className="input w-full text-xs py-1"
          >
            <option value="gripper">Fogókar (gripper)</option>
            <option value="sucker">Vákuumos (sucker)</option>
            <option value="none">Nincs</option>
          </select>
        </div>
        {v.type === 'gripper' && (
          <div>
            <label className="block text-[11px] text-steel-500 mb-1">Ujjak száma</label>
            <input
              type="number"
              min={1}
              max={6}
              value={v.gripperFingerCount ?? 2}
              onChange={(e) => update({ gripperFingerCount: parseInt(e.target.value, 10) || 2 })}
              className="input w-full text-xs py-1"
            />
          </div>
        )}
      </div>
      {v.type === 'gripper' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-steel-500 mb-1">Szélesség (mm)</label>
            <input
              type="number"
              min={1}
              value={v.gripperWidth ?? 60}
              onChange={(e) => update({ gripperWidth: parseFloat(e.target.value) || 0 })}
              className="input w-full text-xs py-1"
            />
          </div>
          <div>
            <label className="block text-[11px] text-steel-500 mb-1">Hosszúság (mm)</label>
            <input
              type="number"
              min={1}
              value={v.gripperLength ?? 50}
              onChange={(e) => update({ gripperLength: parseFloat(e.target.value) || 0 })}
              className="input w-full text-xs py-1"
            />
          </div>
        </div>
      )}
    </div>
  )
}
