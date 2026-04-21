import { describe, it, expect } from 'vitest'
import { deriveWorkEnvelopeFromAxes } from './machineTypeSwitch'

describe('deriveWorkEnvelopeFromAxes', () => {
  it('kiszámítja az X/Y/Z tartományt a tengely min/max alapján', () => {
    const axes = [
      { name: 'X' as const, type: 'linear' as const, min: 0, max: 200, color: '#fff' },
      { name: 'Y' as const, type: 'linear' as const, min: -50, max: 50, color: '#fff' },
      { name: 'Z' as const, type: 'linear' as const, min: 0, max: 80, color: '#fff' },
    ]
    const env = deriveWorkEnvelopeFromAxes(axes)
    expect(env.x).toBe(200)
    expect(env.y).toBe(100)
    expect(env.z).toBe(80)
  })
})
