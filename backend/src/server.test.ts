/**
 * Server smoke teszt: helmet headerek + alap működés.
 *
 * A `createServer` egy igazi DeviceManager-t indít (axios-szal próbál a
 * bridge-hez kapcsolódni); itt csak az alap headereket validáljuk a
 * /health endpointon, ami nem igényel működő bridge-et.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer, ServerContext } from './server.js';
import type { AppConfig } from './config/index.js';

describe('server (helmet headers)', () => {
  let ctx: ServerContext;

  beforeAll(async () => {
    const config: AppConfig = {
      devices: [],
      server: {
        bridge: { host: '127.0.0.1', port: 1 },
      },
    };
    ctx = await createServer(config);
  });

  afterAll(() => {
    ctx?.cleanup();
  });

  it('a /health válasz tartalmaz helmet biztonsági headereket', async () => {
    const res = await request(ctx.server).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('a Content-Security-Policy ki van kapcsolva (csak JSON API)', async () => {
    const res = await request(ctx.server).get('/health');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('404 a globális handler JSON formátumában', async () => {
    const res = await request(ctx.server).get('/no-such-route');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Not found', code: 'not_found' });
  });
});
