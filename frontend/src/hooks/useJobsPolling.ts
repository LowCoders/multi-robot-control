import { useEffect, useRef } from 'react'
import { hostGet, hostPost } from '../utils/hostApi'
import { createLogger } from '../utils/logger'

const log = createLogger('jobs:polling')

export interface JobPollRow {
  status: string
}

/**
 * Job lista + execution mode lekérése adaptív intervallel.
 * A `jobsRef`-et minden renderen frissítsd (`jobsRef.current = jobs`), hogy
 * az interval a legutóbbi futó állapotot lássa — ne használd a `jobs` tömböt
 * közvetlenül effect függőségként (újraindítaná az „első betöltés” ágat).
 */
export function useJobsPolling<T extends JobPollRow>(options: {
  setJobs: React.Dispatch<React.SetStateAction<T[]>>
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
  jobsRef: React.MutableRefObject<T[]>
  getStoredExecutionMode: () => string
}): void {
  const isFirstLoadRef = useRef(true)
  const { setJobs, setIsLoading, jobsRef, getStoredExecutionMode } = options

  useEffect(() => {
    const ac = new AbortController()
    const { signal } = ac
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const loadOnce = async (): Promise<void> => {
      try {
        const data = (await hostGet('/jobs', { signal })) as {
          jobs: T[]
          executionMode?: string
        }
        if (cancelled) return
        setJobs(data.jobs)
        jobsRef.current = data.jobs
        if (isFirstLoadRef.current && data.executionMode) {
          const stored = getStoredExecutionMode()
          if (stored !== data.executionMode) {
            try {
              await hostPost('/jobs/mode', { mode: stored }, { signal })
            } catch (err) {
              log.error('Failed to sync execution mode to backend:', err)
            }
          }
          isFirstLoadRef.current = false
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        log.error('Failed to load jobs:', err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    const scheduleNext = (): void => {
      if (cancelled) return
      const hasRunning = jobsRef.current.some((j) => j.status === 'running')
      const delay = hasRunning ? 500 : 2000
      timeoutId = setTimeout(async () => {
        await loadOnce()
        scheduleNext()
      }, delay)
    }

    void (async () => {
      await loadOnce()
      if (!cancelled) scheduleNext()
    })()

    return () => {
      cancelled = true
      ac.abort()
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [setJobs, setIsLoading, jobsRef, getStoredExecutionMode])
}
