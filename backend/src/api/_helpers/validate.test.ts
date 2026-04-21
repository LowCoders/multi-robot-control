/**
 * validate middleware (zod alapú) kontraktus tesztek.
 */

import { describe, it, expect } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery } from './validate.js';
import { errorMiddleware } from './errorMiddleware.js';

function app(): Express {
  const a = express();
  a.use(express.json());
  return a;
}

describe('validateBody', () => {
  it('jó payload → handler kapja a parsed értéket', async () => {
    const a = app();
    const Schema = z.object({ name: z.string(), age: z.number() });
    a.post('/x', validateBody(Schema), (req, res) => {
      res.json(req.body);
    });
    a.use(errorMiddleware);

    const res = await request(a).post('/x').send({ name: 'Sam', age: 7 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Sam', age: 7 });
  });

  it('rossz payload → 400 + validation_error code + details', async () => {
    const a = app();
    const Schema = z.object({ name: z.string() });
    a.post('/x', validateBody(Schema), (_req, res) => res.json({ ok: true }));
    a.use(errorMiddleware);

    const res = await request(a).post('/x').send({ name: 42 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    expect(Array.isArray(res.body.details)).toBe(true);
  });
});

describe('validateQuery', () => {
  it('coerce string → number megy', async () => {
    const a = app();
    const Schema = z.object({ limit: z.coerce.number().int() });
    a.get('/x', validateQuery(Schema), (req, res) => {
      res.json({ limit: req.query.limit });
    });
    a.use(errorMiddleware);

    const res = await request(a).get('/x?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(10);
  });
});

describe('validateParams', () => {
  it('érvénytelen paraméter → 400', async () => {
    const a = app();
    const Schema = z.object({ id: z.string().regex(/^[a-z]+$/) });
    a.get('/x/:id', validateParams(Schema), (_req, res) => res.json({ ok: true }));
    a.use(errorMiddleware);

    const res = await request(a).get('/x/123');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });
});
