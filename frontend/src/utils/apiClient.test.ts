import { describe, it, expect } from 'vitest'
import { HttpError } from './apiClient'

describe('HttpError', () => {
  it('megőrzi a status és payload mezőket', () => {
    const err = new HttpError(422, { code: 'validation_error' }, 'hiba')
    expect(err.status).toBe(422)
    expect(err.payload).toEqual({ code: 'validation_error' })
    expect(err.message).toBe('hiba')
  })
})
