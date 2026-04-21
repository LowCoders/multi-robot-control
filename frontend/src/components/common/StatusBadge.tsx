import type { DeviceState } from '../../types/device'
import { useTranslation } from 'react-i18next'

interface Props {
  state: DeviceState
  size?: 'sm' | 'md'
}

export default function StatusBadge({ state, size = 'md' }: Props) {
  const { t } = useTranslation('common')

  const stateConfig: Record<DeviceState, { labelKey: string; className: string }> = {
    disconnected: {
      labelKey: 'statusBadge.disconnected',
      className: 'badge-disconnected',
    },
    connecting: {
      labelKey: 'statusBadge.connecting',
      className: 'badge-disconnected',
    },
    idle: {
      labelKey: 'statusBadge.idle',
      className: 'badge-idle',
    },
    running: {
      labelKey: 'statusBadge.running',
      className: 'badge-running',
    },
    paused: {
      labelKey: 'statusBadge.paused',
      className: 'badge-paused',
    },
    alarm: {
      labelKey: 'statusBadge.alarm',
      className: 'badge-alarm',
    },
    homing: {
      labelKey: 'statusBadge.homing',
      className: 'badge-running',
    },
    probing: {
      labelKey: 'statusBadge.probing',
      className: 'badge-running',
    },
    jog: {
      labelKey: 'statusBadge.jog',
      className: 'badge-running',
    },
  }

  const config = stateConfig[state] || stateConfig.disconnected

  return (
    <span className={`
      badge ${config.className}
      ${size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : ''}
    `}>
      {t(config.labelKey)}
    </span>
  )
}
