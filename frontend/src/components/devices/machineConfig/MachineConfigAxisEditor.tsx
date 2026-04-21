/**
 * Egy tengely (X / Y / Z / J1 / ...) szerkesztője a MachineConfigTab-ban.
 *
 * Korábban a `MachineConfigTab.tsx` belső `function AxisEditor(...)` blokkja
 * volt; külön fájlba emelve csökken a parent komponens vizuális zaja és
 * újrahasználható lesz (pl. teaching modal).
 */

import { Trash2 } from 'lucide-react'
import type { AxisConfig, AxisName, AxisType } from '../../../types/machine-config'

export interface MachineConfigAxisEditorProps {
  axis: AxisConfig
  allAxes: AxisConfig[]
  grblRate?: number
  grblAcceleration?: number
  homePosition?: number | null
  onGrblRateChange?: (rate: number) => void
  onGrblAccelerationChange?: (acceleration: number) => void
  onHomePositionChange?: (value: number | null) => void
  onChange: (updated: AxisConfig) => void
  onDelete: () => void
}

const parseLimit = (raw: string): number | null => {
  if (raw.trim() === '') return null
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

const parseHome = (raw: string): number | null => {
  if (raw.trim() === '') return null
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

export default function MachineConfigAxisEditor({
  axis,
  allAxes,
  grblRate,
  grblAcceleration,
  homePosition,
  onGrblRateChange,
  onGrblAccelerationChange,
  onHomePositionChange,
  onChange,
  onDelete,
}: MachineConfigAxisEditorProps) {
  const possibleParents = allAxes.filter((a) => a.name !== axis.name)
  const limitsInvalid = axis.min != null && axis.max != null && axis.min >= axis.max

  return (
    <div className="bg-steel-800/50 rounded-lg p-3 border border-steel-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: axis.color }}
          >
            {axis.name}
          </div>
          <span className="text-sm font-medium text-white">
            {axis.name}
            <span className="text-steel-400 text-xs ml-1">
              ({axis.type === 'linear' ? 'Lin.' : 'Rot.'})
            </span>
          </span>
          <input
            type="color"
            value={axis.color}
            onChange={(e) => onChange({ ...axis, color: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer bg-transparent border border-steel-600 p-0"
            title="Tengely színe"
          />
        </div>
        <button
          onClick={onDelete}
          className="btn-icon text-red-400 hover:text-red-300 hover:bg-red-500/10"
          title="Tengely törlése"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="block text-xs text-steel-500 mb-1" title="Üres = nincs alsó limit">
            Min
          </label>
          <input
            type="number"
            value={axis.min ?? ''}
            placeholder="∅"
            onChange={(e) => onChange({ ...axis, min: parseLimit(e.target.value) })}
            className="input w-full text-xs py-1"
            title="Üresen hagyva: nincs alsó limit"
          />
        </div>
        <div>
          <label className="block text-xs text-steel-500 mb-1" title="Üres = nincs felső limit">
            Max
          </label>
          <input
            type="number"
            value={axis.max ?? ''}
            placeholder="∅"
            onChange={(e) => onChange({ ...axis, max: parseLimit(e.target.value) })}
            className="input w-full text-xs py-1"
            title="Üresen hagyva: nincs felső limit"
          />
        </div>
        <div>
          <label className="block text-xs text-steel-500 mb-1">Scale</label>
          <input
            type="number"
            value={axis.scale ?? 1.0}
            onChange={(e) => onChange({ ...axis, scale: parseFloat(e.target.value) || 1.0 })}
            className="input w-full text-xs py-1"
            step={0.001}
            title="Firmware érték → fizikai egység szorzó"
          />
        </div>
        <div>
          <label className="block text-xs text-steel-500 mb-1">Home</label>
          <input
            type="number"
            value={homePosition ?? ''}
            placeholder="∅"
            onChange={(e) => onHomePositionChange?.(parseHome(e.target.value))}
            className="input w-full text-xs py-1"
            disabled={!onHomePositionChange}
            title="Home pozíció ezen a tengelyen (üres = nincs megadva)"
            step={0.1}
          />
        </div>
      </div>

      {limitsInvalid && (
        <div className="mt-1 text-[11px] text-amber-400">
          Figyelem: Min ({axis.min}) ≥ Max ({axis.max}) — érvénytelen tartomány.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        <div>
          <label className="block text-xs text-steel-500 mb-1">Max rate (GRBL)</label>
          <input
            type="number"
            value={grblRate ?? ''}
            onChange={(e) => {
              if (!onGrblRateChange) return
              onGrblRateChange(parseFloat(e.target.value) || 0)
            }}
            className="input w-full text-xs py-1"
            min={1}
            disabled={!onGrblRateChange}
            title="GRBL $110/$111/$112 érték tengelyenként"
          />
        </div>
        <div>
          <label className="block text-xs text-steel-500 mb-1">Acceleration (GRBL)</label>
          <input
            type="number"
            value={grblAcceleration ?? ''}
            onChange={(e) => {
              if (!onGrblAccelerationChange) return
              onGrblAccelerationChange(parseFloat(e.target.value) || 0)
            }}
            className="input w-full text-xs py-1"
            min={1}
            disabled={!onGrblAccelerationChange}
            title="GRBL $120/$121/$122 érték tengelyenként"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
        <div>
          <label className="block text-xs text-steel-500 mb-1">Típus</label>
          <select
            value={axis.type}
            onChange={(e) => onChange({ ...axis, type: e.target.value as AxisType })}
            className="input w-full text-xs py-1"
          >
            <option value="linear">Lineáris</option>
            <option value="rotary">Rotációs</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-steel-500 mb-1">Szülő</label>
          <select
            value={axis.parent ?? ''}
            onChange={(e) =>
              onChange({
                ...axis,
                parent: (e.target.value || undefined) as AxisName | undefined,
              })
            }
            className="input w-full text-xs py-1"
          >
            <option value="">Nincs</option>
            {possibleParents.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center sm:pt-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={axis.invert ?? false}
              onChange={(e) => onChange({ ...axis, invert: e.target.checked })}
              className="w-3 h-3 rounded bg-steel-700 border-steel-600"
            />
            <span className="text-xs text-steel-400">Invertálás</span>
          </label>
        </div>
      </div>
    </div>
  )
}
