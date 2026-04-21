/**
 * Job queue + execution mode in-memory tárolója + sequential mode helper.
 */

import type { DeviceManager } from '../../devices/DeviceManager.js'
import { createLogger } from '../../utils/logger.js'
import { InMemoryJobRepository } from './JobRepository.js'
import type { ExecutionMode } from './jobTypes.js'

export type { Job, ExecutionMode } from './jobTypes.js'

const log = createLogger('api:jobQueue')

export const jobRepository = new InMemoryJobRepository()

/** Visszafelé kompatibilis: ugyanaz a mutálható tömb, mint `jobRepository.list()`. */
export const jobQueue = jobRepository.list()

interface ExecutionModeRef {
  value: ExecutionMode
}

export const executionModeRef: ExecutionModeRef = { value: 'sequential' }

export function getExecutionMode(): ExecutionMode {
  return executionModeRef.value
}

export function setExecutionMode(mode: ExecutionMode): void {
  executionModeRef.value = mode
}

/**
 * Sequential mode helper: ha van pending job, betölti és elindítja.
 * Visszaadja, sikerült-e elindítani.
 */
export async function startNextPendingJob(deviceManager: DeviceManager): Promise<boolean> {
  const pendingJobs = jobQueue.filter((j) => j.status === 'pending')
  if (pendingJobs.length === 0) return false

  const nextJob = pendingJobs[0]
  if (!nextJob) return false
  try {
    const loadSuccess = await deviceManager.loadFile(nextJob.deviceId, nextJob.filepath)
    if (loadSuccess) {
      const runSuccess = await deviceManager.run(nextJob.deviceId)
      if (runSuccess) {
        nextJob.status = 'running'
        return true
      }
    }
  } catch (error) {
    log.error('Error starting next job:', error)
  }
  return false
}
