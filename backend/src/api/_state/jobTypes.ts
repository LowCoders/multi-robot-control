/**
 * Job queue domain típusok — külön modul, hogy a JobRepository importja ne
 * körkörös legyen a jobQueueState-tel.
 */

export interface Job {
  id: string
  name: string
  deviceId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  estimatedTime?: number
  filepath: string
  createdAt: number
}

export type ExecutionMode = 'sequential' | 'parallel' | 'manual'
