import type { DeviceState } from '../../types/device'

interface Props {
  state: DeviceState
  size?: 'sm' | 'md'
}

const stateConfig: Record<DeviceState, { label: string; className: string }> = {
  disconnected: {
    label: 'Offline',
    className: 'badge-disconnected',
  },
  connecting: {
    label: 'Csatlakozás...',
    className: 'badge-disconnected',
  },
  idle: {
    label: 'Idle',
    className: 'badge-idle',
  },
  running: {
    label: 'Fut',
    className: 'badge-running',
  },
  paused: {
    label: 'Szünet',
    className: 'badge-paused',
  },
  alarm: {
    label: 'Alarm',
    className: 'badge-alarm',
  },
  homing: {
    label: 'Homing',
    className: 'badge-running',
  },
  probing: {
    label: 'Probing',
    className: 'badge-running',
  },
  jog: {
    label: 'Jog',
    className: 'badge-running',
  },
}

export default function StatusBadge({ state, size = 'md' }: Props) {
  const config = stateConfig[state] || stateConfig.disconnected
  
  return (
    <span className={`
      badge ${config.className}
      ${size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : ''}
    `}>
      {config.label}
    </span>
  )
}
