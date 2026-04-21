import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('devices')
  const v = value ?? DEFAULT
  const update = (patch: Partial<RobotArmConfig>) => onChange({ ...v, ...patch })

  const numField = (
    labelKey:
      | 'base_diameter'
      | 'base_height'
      | 'lower_arm_length'
      | 'lower_arm_width'
      | 'upper_arm_length'
      | 'upper_arm_width',
    key: keyof Pick<RobotArmConfig, 'baseDiameter' | 'baseHeight' | 'lowerArmLength' | 'lowerArmWidth' | 'upperArmLength' | 'upperArmWidth'>,
  ) => (
    <div>
      <label className="block text-[11px] text-steel-500 mb-1">{t(`cap_editors.robot_arm.${labelKey}`)}</label>
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
        {t('cap_editors.robot_arm.title')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numField('base_diameter', 'baseDiameter')}
        {numField('base_height', 'baseHeight')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numField('lower_arm_length', 'lowerArmLength')}
        {numField('lower_arm_width', 'lowerArmWidth')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numField('upper_arm_length', 'upperArmLength')}
        {numField('upper_arm_width', 'upperArmWidth')}
      </div>
    </div>
  )
}
