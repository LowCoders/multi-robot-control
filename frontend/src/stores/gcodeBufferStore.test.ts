import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGcodeBufferStore } from './gcodeBufferStore'

vi.mock('../services/gcodeBufferService', () => ({
  fetchGcodeFile: vi.fn().mockResolvedValue({ lines: ['G0 X0'], filename: 'f.nc' }),
  saveGcodeFile: vi.fn().mockResolvedValue({ filepath: '/tmp/f.nc', filename: 'f.nc' }),
}))

describe('gcodeBufferStore', () => {
  beforeEach(() => {
    useGcodeBufferStore.getState().reset('d1')
    vi.clearAllMocks()
  })

  it('loadFromServer betölti a sort a service-ből', async () => {
    await useGcodeBufferStore.getState().loadFromServer('d1', '/tmp/x.nc')
    const b = useGcodeBufferStore.getState().getBuffer('d1')
    expect(b.lines).toEqual(['G0 X0'])
    expect(b.loading).toBe(false)
  })
})
