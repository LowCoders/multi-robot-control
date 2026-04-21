/**
 * errorMiddleware + sendError + AppError szigorúság tesztek.
 */

import { describe, it, expect, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
  BridgeUnavailableError,
} from '../../errors/AppError.js';
import { errorMiddleware } from './errorMiddleware.js';
import { asyncHandler } from './asyncHandler.js';

function makeApp(handler: express.RequestHandler): Express {
  const app = express();
  app.use(express.json());
  app.get('/test', handler);
  app.use(errorMiddleware);
  return app;
}

describe('errorMiddleware', () => {
  it('NotFoundError → 404 + code:not_found', async () => {
    const app = makeApp((_req, _res, next) => next(new NotFoundError('hiányzik')));
    const res = await request(app).get('/test');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'hiányzik', code: 'not_found' });
  });

  it('ValidationError details mező megőrződik', async () => {
    const app = makeApp((_req, _res, next) =>
      next(new ValidationError('rossz input', [{ path: ['x'], msg: 'kell' }]))
    );
    const res = await request(app).get('/test');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.details).toBeDefined();
  });

  it('ConflictError → 409', async () => {
    const app = makeApp((_req, _res, next) => next(new ConflictError('konfliktus')));
    const res = await request(app).get('/test');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });

  it('ForbiddenError → 403', async () => {
    const app = makeApp((_req, _res, next) => next(new ForbiddenError('tiltott')));
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('BridgeUnavailableError → 503', async () => {
    const app = makeApp((_req, _res, next) => next(new BridgeUnavailableError('bridge le van')));
    const res = await request(app).get('/test');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('bridge_unavailable');
  });

  it('asyncHandler-ben dobott AppError-t is elkapja', async () => {
    const app = makeApp(
      asyncHandler(async () => {
        throw new NotFoundError('no');
      })
    );
    const res = await request(app).get('/test');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('ismeretlen hiba → 500 + code:internal_error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = makeApp((_req, _res, next) => next(new Error('boom')));
    const res = await request(app).get('/test');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom', code: 'internal_error' });
    errorSpy.mockRestore();
  });

  it('AppError leszármazott bárhonnan toJSON-en megy ki', () => {
    class CustomError extends AppError {
      readonly httpStatus = 418;
      readonly code = 'teapot';
    }
    const err = new CustomError('I am a teapot');
    expect(err.toJSON()).toEqual({ error: 'I am a teapot', code: 'teapot' });
  });
});
