/**
 * In-memory job queue — Repository pattern a későbbi perzisztencia előkészítéséhez.
 */

import type { Job } from './jobTypes.js'

export interface JobRepository {
  /** A háttérben tárolt lista (mutálható referencia a meglévő route logikához). */
  list(): Job[]
  findById(id: string): Job | undefined
  push(job: Job): void
  removeById(id: string): Job | undefined
  /** A megadott sorrend szerint újrarendezi a queue-t; ismeretlen id-k kihagyva a végére kerülnek. */
  reorderByIds(order: string[]): void
  clear(): void
}

export class InMemoryJobRepository implements JobRepository {
  private readonly _jobs: Job[] = []

  list(): Job[] {
    return this._jobs
  }

  findById(id: string): Job | undefined {
    return this._jobs.find((j) => j.id === id)
  }

  push(job: Job): void {
    this._jobs.push(job)
  }

  removeById(id: string): Job | undefined {
    const idx = this._jobs.findIndex((j) => j.id === id)
    if (idx === -1) return undefined
    const removed = this._jobs.splice(idx, 1)
    return removed[0]
  }

  reorderByIds(order: string[]): void {
    const jobMap = new Map(this._jobs.map((j) => [j.id, j]))
    const newQueue: Job[] = []
    for (const id of order) {
      const job = jobMap.get(id)
      if (job) {
        newQueue.push(job)
        jobMap.delete(id)
      }
    }
    for (const job of jobMap.values()) {
      newQueue.push(job)
    }
    this._jobs.length = 0
    this._jobs.push(...newQueue)
  }

  clear(): void {
    this._jobs.length = 0
  }
}
