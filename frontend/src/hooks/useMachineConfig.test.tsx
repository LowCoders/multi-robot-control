import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, screen } from '@testing-library/react'
import type { MachineConfig } from '../types/machine-config'
import { useMachineConfig } from './useMachineConfig'

vi.mock('../utils/hostApi', () => ({
  hostGet: vi.fn(),
}))

import { hostGet } from '../utils/hostApi'

function Probe({ id, type }: { id: string; type?: 'cnc_mill' }) {
  const { config, loading } = useMachineConfig(id, type)
  return (
    <div>
      <span data-testid="loading">{loading ? 'y' : 'n'}</span>
      <span data-testid="id">{config?.id ?? ''}</span>
    </div>
  )
}

describe('useMachineConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sikeres hostGet után a config betöltődik', async () => {
    vi.mocked(hostGet).mockResolvedValueOnce({
      id: 'd1',
      name: 'X',
      type: 'cnc_mill',
      axes: [],
    } as unknown as MachineConfig)
    render(<Probe id="d1" type="cnc_mill" />)
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('n')
    })
    expect(screen.getByTestId('id').textContent).toBe('d1')
  })

  it('hiba esetén default config az eszköz id-jával', async () => {
    vi.mocked(hostGet).mockRejectedValueOnce(new Error('network'))
    render(<Probe id="d2" type="cnc_mill" />)
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('n')
    })
    expect(screen.getByTestId('id').textContent).toBe('d2')
  })
})
