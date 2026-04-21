import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { sendError, sendAppError } from './sendError.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';

function mockRes(): Response & { _status: number; _body: unknown } {
  const res = {
    _status: 0,
    _body: undefined as unknown,
    status: vi.fn(function (this: { _status: number }, code: number) {
      this._status = code;
      return this;
    }),
    json: vi.fn(function (this: { _body: unknown }, body: unknown) {
      this._body = body;
      return this;
    }),
  } as unknown as Response & { _status: number; _body: unknown };
  return res;
}

describe('sendError', () => {
  it('csak az error mezővel válaszol, ha nincs opt', () => {
    const res = mockRes();
    sendError(res, 400, 'rossz kérés');
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'rossz kérés' });
  });

  it('hozzáfűzi a code mezőt, ha meg van adva', () => {
    const res = mockRes();
    sendError(res, 404, 'nincs ilyen', { code: 'not_found' });
    expect(res._body).toEqual({ error: 'nincs ilyen', code: 'not_found' });
  });

  it('hozzáfűzi a details mezőt, ha meg van adva', () => {
    const res = mockRes();
    sendError(res, 422, 'érvénytelen', { details: { field: 'name' } });
    expect(res._body).toEqual({ error: 'érvénytelen', details: { field: 'name' } });
  });

  it('mind a code, mind a details mezőt átadja', () => {
    const res = mockRes();
    sendError(res, 422, 'érvénytelen', { code: 'validation', details: ['x'] });
    expect(res._body).toEqual({ error: 'érvénytelen', code: 'validation', details: ['x'] });
  });
});

describe('sendAppError', () => {
  it('a NotFoundError httpStatus + toJSON-jét használja', () => {
    const res = mockRes();
    sendAppError(res, new NotFoundError('Eszköz nem található'));
    expect(res._status).toBe(404);
    expect(res._body).toEqual({
      error: 'Eszköz nem található',
      code: 'not_found',
    });
  });

  it('a ValidationError details mezőjét is továbbítja', () => {
    const res = mockRes();
    sendAppError(res, new ValidationError('hiba', { field: 'x' }));
    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: 'hiba',
      code: 'validation_error',
      details: { field: 'x' },
    });
  });
});
