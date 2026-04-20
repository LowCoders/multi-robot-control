import { describe, expect, it } from 'vitest'
import { effectiveCapabilities } from './capabilities'
import type { MachineConfig } from '../types/machine-config'
import type { DeviceCapabilities } from '../types/device'

function makeConfig(overrides: Partial<MachineConfig> = {}): MachineConfig {
  return {
    id: 'test',
    name: 'Test',
    type: 'cnc_mill',
    axes: [],
    workEnvelope: { x: 100, y: 100, z: 100 },
    ...overrides,
  }
}

function makeRuntime(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    axes: ['X', 'Y', 'Z'],
    has_spindle: false,
    has_laser: false,
    has_coolant: false,
    has_probe: false,
    has_tool_changer: false,
    has_gripper: false,
    has_sucker: false,
    max_feed_rate: 0,
    max_spindle_speed: 0,
    max_laser_power: 0,
    work_envelope: { x: 100, y: 100, z: 100 },
    ...overrides,
  }
}

describe('effectiveCapabilities', () => {
  it('returns all-false for empty config and runtime', () => {
    const eff = effectiveCapabilities(null, null)
    expect(eff.hasGripper).toBe(false)
    expect(eff.hasLaser).toBe(false)
    expect(eff.hasSpindle).toBe(false)
    expect(eff.maxLaserPower).toBe(0)
    expect(eff.maxSpindleSpeed).toBe(0)
    expect(eff.source.hasGripper).toBe('none')
  })

  it('marks runtime-only flags with source: runtime', () => {
    const eff = effectiveCapabilities(makeConfig(), makeRuntime({ has_laser: true }))
    expect(eff.hasLaser).toBe(true)
    expect(eff.source.hasLaser).toBe('runtime')
    expect(eff.source.hasSpindle).toBe('none')
  })

  it('marks declared-only flags with source: declared', () => {
    const config = makeConfig({ declaredCapabilities: { hasGripper: true } })
    const eff = effectiveCapabilities(config, makeRuntime())
    expect(eff.hasGripper).toBe(true)
    expect(eff.source.hasGripper).toBe('declared')
  })

  it('marks declared+runtime flags as source: both (sync)', () => {
    const config = makeConfig({ declaredCapabilities: { hasSpindle: true } })
    const runtime = makeRuntime({ has_spindle: true })
    const eff = effectiveCapabilities(config, runtime)
    expect(eff.hasSpindle).toBe(true)
    expect(eff.source.hasSpindle).toBe('both')
  })

  it('takes union (OR) of declared and runtime flags', () => {
    const config = makeConfig({ declaredCapabilities: { hasGripper: true } })
    const runtime = makeRuntime({ has_laser: true })
    const eff = effectiveCapabilities(config, runtime)
    expect(eff.hasGripper).toBe(true)
    expect(eff.hasLaser).toBe(true)
    expect(eff.hasSucker).toBe(false)
  })

  it('prefers runtime numeric maxima when present, falls back to declared/config', () => {
    const config = makeConfig({
      declaredCapabilities: { maxLaserPower: 500 },
      laser: { maxPower: 800 },
      spindle: { maxRpm: 12000 },
    })
    const runtimeWithLaser = makeRuntime({ max_laser_power: 1000, max_spindle_speed: 0 })
    const eff = effectiveCapabilities(config, runtimeWithLaser)
    expect(eff.maxLaserPower).toBe(1000)
    expect(eff.maxSpindleSpeed).toBe(12000)
  })

  it('falls back to declared maxLaserPower if both runtime and laser config missing', () => {
    const config = makeConfig({ declaredCapabilities: { maxLaserPower: 250 } })
    const eff = effectiveCapabilities(config, null)
    expect(eff.maxLaserPower).toBe(250)
  })

  it('maps has_vacuum_pump to hasVacuum', () => {
    const eff = effectiveCapabilities(makeConfig(), makeRuntime({ has_vacuum_pump: true }))
    expect(eff.hasVacuum).toBe(true)
    expect(eff.source.hasVacuum).toBe('runtime')
  })

  it('uses driverConfig.maxFeedRate as fallback for maxFeedRate', () => {
    const config = makeConfig({ driverConfig: { maxFeedRate: 5000 } })
    const eff = effectiveCapabilities(config, makeRuntime({ max_feed_rate: 0 }))
    expect(eff.maxFeedRate).toBe(5000)
  })
})
