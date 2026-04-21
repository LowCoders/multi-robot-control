import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { hostGet, hostPost, hostDelete } from './hostApi'
import { HttpError } from './apiClient'

describe('hostApi', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hostGet a /api prefixet használja', async () => {
    await hostGet('/jobs')
    expect(fetch).toHaveBeenCalledWith('/api/jobs', expect.objectContaining({ method: 'GET' }))
  })

  it('hostPost JSON body-t küld', async () => {
    await hostPost('/jobs', { name: 'x', deviceId: 'd', filepath: '/a.nc' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: 'x', deviceId: 'd', filepath: '/a.nc' }),
      })
    )
  })

  it('nem OK válaszra HttpError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'hiba', code: 'x' }), { status: 400, statusText: 'Bad' })
    )
    await expect(hostGet('/jobs')).rejects.toBeInstanceOf(HttpError)
  })

  it('hostDelete DELETE metódust használ', async () => {
    await hostDelete('/jobs/1')
    expect(fetch).toHaveBeenCalledWith('/api/jobs/1', expect.objectContaining({ method: 'DELETE' }))
  })
})
