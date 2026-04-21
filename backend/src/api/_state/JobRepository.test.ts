import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryJobRepository } from './JobRepository.js'
import type { Job } from './jobTypes.js'

function makeJob(id: string): Job {
  return {
    id,
    name: `n-${id}`,
    deviceId: 'd1',
    status: 'pending',
    progress: 0,
    filepath: '/tmp/x.gcode',
    createdAt: 1,
  }
}

describe('InMemoryJobRepository', () => {
  let repo: InMemoryJobRepository

  beforeEach(() => {
    repo = new InMemoryJobRepository()
  })

  it('reorderByIds a megadott sorrendet alkalmazza', () => {
    repo.push(makeJob('a'))
    repo.push(makeJob('b'))
    repo.push(makeJob('c'))
    repo.reorderByIds(['c', 'a', 'b'])
    expect(repo.list().map((j) => j.id)).toEqual(['c', 'a', 'b'])
  })

  it('removeById eltávolítja az elemet', () => {
    repo.push(makeJob('x'))
    const removed = repo.removeById('x')
    expect(removed?.id).toBe('x')
    expect(repo.list()).toHaveLength(0)
  })
})
