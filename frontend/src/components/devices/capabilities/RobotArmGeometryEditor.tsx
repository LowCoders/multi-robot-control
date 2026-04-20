import { Bot } from 'lucide-react'
import type { RobotArmConfig } from '../../../types/machine-config'

interface Props {
  value: RobotArmConfig | undefined
  onChange: (next: RobotArmConfig) => void
}

const DEFAULT: RobotArmConfig = {
  baseDiameter: 120,
  baseHeight: 60,
  lowerArmLength: 200,
  lowerArmWidth: 50,
  upperArmLength: 200,
  upperArmWidth: 40,
  endEffector: { type: 'gripper' },
}

export default function RobotArmGeometryEditor({ value, onChange }: Props) {
  const v = value ?? DEFAULT
  const update = (patch: Partial<RobotArmConfig>) => onChange({ ...v, ...patch })

  const numField = (label: string, key: keyof Pick<RobotArmConfig, 'baseDiameter' | 'baseHeight' | 'lowerArmLength' | 'lowerArmWidth' | 'upperArmLength' | 'upperArmWidth'>) => (
    <div>
      <label className="block text-[11px] text-steel-500 mb-1">{label}</label>
      <input
        type="number"
        min={1}
        value={v[key] ?? 0}
        onChange={(e) => update({ [key]: parseFloat(e.target.value) || 0 } as Partial<RobotArmConfig>)}
        className="input w-full text-xs py-1"
      />
    </div>
  )

  return (
    <div className="bg-steel-800/40 rounded-lg border border-steel-700 p-3 space-y-2">
      <div className="flex items-center gap-2 text-steel-300 text-xs font-medium">
        <Bot className="w-3 h-3" />
        Robotkar geometria
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numField('Bázis átmérő (mm)', 'baseDiameter')}
        {numField('Bázis magasság (mm)', 'baseHeight')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numField('Alsó kar hossz (mm)', 'lowerArmLength')}
        {numField('Alsó kar szélesség (mm)', 'lowerArmWidth')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numField('Felső kar hossz (mm)', 'upperArmLength')}
        {numField('Felső kar szélesség (mm)', 'upperArmWidth')}
      </div>
    </div>
  )
}
