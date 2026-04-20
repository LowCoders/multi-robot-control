import type { MachineConfig, DeclaredCapabilities } from '../types/machine-config'
import type { DeviceCapabilities } from '../types/device'

// Az "effective" képességek a felhasználó által deklarált (config.declaredCapabilities)
// és a backend által jelentett (DeviceCapabilities) értékek uniója.
//
// Logika:
// - Ha a felhasználó deklarálta (hasLaser=true), akkor "declared" = true.
// - Ha a runtime is jelzi (capabilities.has_laser=true), akkor "runtime" = true.
// - Az effective = declared || runtime — ha bármelyik forrás állítja, megjelenítjük.
// - A UI-on a runtime detektált képességet külön badge-el jelezzük (lásd
//   MachineConfigTab "Eszköz képességek" szekcióját).
//
// Maximum értékek (maxLaserPower, maxSpindleSpeed):
// - A runtime érték preferált (a tényleges hardver határa), ha 0/üres, akkor a
//   declarált fallback használata.

export interface EffectiveCapabilities {
  hasGripper: boolean
  hasSucker: boolean
  hasLaser: boolean
  hasSpindle: boolean
  hasCoolant: boolean
  hasProbe: boolean
  hasToolChanger: boolean
  hasVacuum: boolean
  // Numerikus határok (futtatáshoz a slider/input értékekhez)
  maxLaserPower: number
  maxSpindleSpeed: number
  maxFeedRate: number
  // Per-flag forrás-jelölés a UI-hoz (badge: "runtime" / "declared")
  source: {
    hasGripper: 'declared' | 'runtime' | 'both' | 'none'
    hasSucker: 'declared' | 'runtime' | 'both' | 'none'
    hasLaser: 'declared' | 'runtime' | 'both' | 'none'
    hasSpindle: 'declared' | 'runtime' | 'both' | 'none'
    hasCoolant: 'declared' | 'runtime' | 'both' | 'none'
    hasProbe: 'declared' | 'runtime' | 'both' | 'none'
    hasToolChanger: 'declared' | 'runtime' | 'both' | 'none'
    hasVacuum: 'declared' | 'runtime' | 'both' | 'none'
  }
}

type CapabilityKey = keyof DeclaredCapabilities &
  ('hasGripper' | 'hasSucker' | 'hasLaser' | 'hasSpindle' | 'hasCoolant' | 'hasProbe' | 'hasToolChanger' | 'hasVacuum')

const RUNTIME_KEY_MAP: Record<CapabilityKey, keyof DeviceCapabilities> = {
  hasGripper: 'has_gripper',
  hasSucker: 'has_sucker',
  hasLaser: 'has_laser',
  hasSpindle: 'has_spindle',
  hasCoolant: 'has_coolant',
  hasProbe: 'has_probe',
  hasToolChanger: 'has_tool_changer',
  hasVacuum: 'has_vacuum_pump',
}

function resolveSource(declared: boolean, runtime: boolean): 'declared' | 'runtime' | 'both' | 'none' {
  if (declared && runtime) return 'both'
  if (declared) return 'declared'
  if (runtime) return 'runtime'
  return 'none'
}

export function effectiveCapabilities(
  config: MachineConfig | null | undefined,
  runtime: DeviceCapabilities | null | undefined
): EffectiveCapabilities {
  const declared = config?.declaredCapabilities ?? {}

  const flag = (key: CapabilityKey): { value: boolean; source: 'declared' | 'runtime' | 'both' | 'none' } => {
    const d = declared[key] === true
    const r = runtime ? runtime[RUNTIME_KEY_MAP[key]] === true : false
    return { value: d || r, source: resolveSource(d, r) }
  }

  const gripper = flag('hasGripper')
  const sucker = flag('hasSucker')
  const laser = flag('hasLaser')
  const spindle = flag('hasSpindle')
  const coolant = flag('hasCoolant')
  const probe = flag('hasProbe')
  const toolChanger = flag('hasToolChanger')
  const vacuum = flag('hasVacuum')

  // Numerikus határok: runtime preferált, declarált fallback, ha mindkettő hiányzik 0
  const maxLaserPower =
    (runtime?.max_laser_power && runtime.max_laser_power > 0 ? runtime.max_laser_power : null)
    ?? declared.maxLaserPower
    ?? config?.laser?.maxPower
    ?? 0
  const maxSpindleSpeed =
    (runtime?.max_spindle_speed && runtime.max_spindle_speed > 0 ? runtime.max_spindle_speed : null)
    ?? declared.maxSpindleSpeed
    ?? config?.spindle?.maxRpm
    ?? 0
  const maxFeedRate =
    (runtime?.max_feed_rate && runtime.max_feed_rate > 0 ? runtime.max_feed_rate : null)
    ?? config?.driverConfig?.maxFeedRate
    ?? 0

  return {
    hasGripper: gripper.value,
    hasSucker: sucker.value,
    hasLaser: laser.value,
    hasSpindle: spindle.value,
    hasCoolant: coolant.value,
    hasProbe: probe.value,
    hasToolChanger: toolChanger.value,
    hasVacuum: vacuum.value,
    maxLaserPower,
    maxSpindleSpeed,
    maxFeedRate,
    source: {
      hasGripper: gripper.source,
      hasSucker: sucker.source,
      hasLaser: laser.source,
      hasSpindle: spindle.source,
      hasCoolant: coolant.source,
      hasProbe: probe.source,
      hasToolChanger: toolChanger.source,
      hasVacuum: vacuum.source,
    },
  }
}
