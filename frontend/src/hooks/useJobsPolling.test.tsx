import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { useJobsPolling } from './useJobsPolling'

vi.mock('../utils/hostApi', () => ({
  hostGet: vi.fn(),
  hostPost: vi.fn(),
}))

import { hostGet, hostPost } from '../utils/hostApi'

function TestHost() {
  const [jobs, setJobs] = useState<{ status: string }[]>([])
  const [loading, setLoading] = useState(true)
  const jobsRef = useRef<{ status: string }[]>([])
  jobsRef.current = jobs
  useJobsPolling({
    setJobs,
    setIsLoading: setLoading,
    jobsRef,
    getStoredExecutionMode: () => 'sequential',
  })
  return (
    <div>
      <span data-testid="loading">{loading ? 'y' : 'n'}</span>
      <span data-testid="count">{jobs.length}</span>
    </div>
  )
}

describe('useJobsPolling', () => {
  beforeEach(() => {
    vi.mocked(hostGet).mockResolvedValue({ jobs: [{ status: 'pending' }], executionMode: 'sequential' })
    vi.mocked(hostPost).mockResolvedValue({})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('első betöltés után leáll a loading és meghívja a hostGet-et', async () => {
    render(<TestHost />)
    await waitFor(() => {
      expect(hostGet).toHaveBeenCalledWith('/jobs', expect.any(Object))
    })
    await waitFor(() => {
      expect(document.querySelector('[data-testid="loading"]')?.textContent).toBe('n')
    })
    expect(hostPost).not.toHaveBeenCalled()
  })
})
