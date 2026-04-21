/**
 * Jobs router happy-path teszt.
 *
 * Csak az új helperek (`tryStartJob`, `syncRunningJob`) viselkedését tesztelni
 * unit szinten nehezebb, mert internal-ek; ezért end-to-end stílusban,
 * supertest + mock DeviceManager-rel megyünk.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { createJobsRouter } from './jobs.routes.js';
import { errorMiddleware } from '../_helpers/errorMiddleware.js';
import { jobQueue, executionModeRef } from '../_state/appState.js';
import type { DeviceManager, DeviceStatus } from '../../devices/DeviceManager.js';

function makeMockDM(overrides: Partial<DeviceManager> = {}): DeviceManager {
  const base: Partial<DeviceManager> = {
    loadFile: vi.fn().mockResolvedValue(true),
    run: vi.fn().mockResolvedValue(true),
    pause: vi.fn().mockResolvedValue(true),
    stop: vi.fn().mockResolvedValue(true),
    getDeviceStatus: vi.fn().mockResolvedValue(null),
  };
  return { ...base, ...overrides } as DeviceManager;
}

function buildApp(dm: DeviceManager): Express {
  const app = express();
  app.use(express.json());
  app.use(createJobsRouter(dm));
  app.use(errorMiddleware);
  return app;
}

beforeEach(() => {
  jobQueue.length = 0;
  executionModeRef.value = 'sequential';
});

describe('jobs.routes — execution mode', () => {
  it('GET /jobs/mode visszaadja az aktuális mode-ot', async () => {
    const app = buildApp(makeMockDM());
    const res = await request(app).get('/jobs/mode');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'sequential' });
  });

  it('POST /jobs/mode érvényes mode-ot beállít', async () => {
    const app = buildApp(makeMockDM());
    const res = await request(app).post('/jobs/mode').send({ mode: 'parallel' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'parallel' });
    expect(executionModeRef.value).toBe('parallel');
  });

  it('POST /jobs/mode érvénytelen mode-ra 400-at ad', async () => {
    const app = buildApp(makeMockDM());
    const res = await request(app).post('/jobs/mode').send({ mode: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });
});

describe('jobs.routes — CRUD', () => {
  it('POST /jobs új jobot ad a queue-hoz', async () => {
    const app = buildApp(makeMockDM());
    const res = await request(app)
      .post('/jobs')
      .send({ name: 'Job1', deviceId: 'cnc-1', filepath: '/tmp/a.gcode' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Job1');
    expect(res.body.status).toBe('pending');
    expect(jobQueue).toHaveLength(1);
  });

  it('POST /jobs hiányzó mező → 400 validation_error', async () => {
    const app = buildApp(makeMockDM());
    const res = await request(app).post('/jobs').send({ name: 'Job1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('GET /jobs/:id 404-et ad nem létező ID-ra', async () => {
    const app = buildApp(makeMockDM());
    const res = await request(app).get('/jobs/missing');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('DELETE /jobs/:id eltávolítja a jobot', async () => {
    const app = buildApp(makeMockDM());
    jobQueue.push({
      id: '1',
      name: 'X',
      deviceId: 'cnc-1',
      filepath: '/tmp/x',
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
    });
    const res = await request(app).delete('/jobs/1');
    expect(res.status).toBe(200);
    expect(jobQueue).toHaveLength(0);
  });
});

describe('jobs.routes — tryStartJob viselkedés (POST /jobs/:id/run)', () => {
  it('happy path: load+run sikeres → status running', async () => {
    const dm = makeMockDM();
    const app = buildApp(dm);
    jobQueue.push({
      id: '10',
      name: 'A',
      deviceId: 'cnc-1',
      filepath: '/tmp/a',
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
    });
    const res = await request(app).post('/jobs/10/run');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.job.status).toBe('running');
    expect(dm.loadFile).toHaveBeenCalledWith('cnc-1', '/tmp/a');
    expect(dm.run).toHaveBeenCalled();
  });

  it('loadFile sikertelen → 500 + status failed', async () => {
    const dm = makeMockDM({ loadFile: vi.fn().mockResolvedValue(false) });
    const app = buildApp(dm);
    jobQueue.push({
      id: '11',
      name: 'B',
      deviceId: 'cnc-1',
      filepath: '/tmp/b',
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
    });
    const res = await request(app).post('/jobs/11/run');
    expect(res.status).toBe(500);
    expect(jobQueue[0]?.status).toBe('failed');
  });

  it('már futó job → 409 conflict', async () => {
    const app = buildApp(makeMockDM());
    jobQueue.push({
      id: '12',
      name: 'C',
      deviceId: 'cnc-1',
      filepath: '/tmp/c',
      status: 'running',
      progress: 50,
      createdAt: Date.now(),
    });
    const res = await request(app).post('/jobs/12/run');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });
});

describe('jobs.routes — syncRunningJob viselkedés (GET /jobs)', () => {
  it('befejezett (idle + 100%) jobot completed-re állítja', async () => {
    const status: DeviceStatus = {
      state: 'idle',
      position: { x: 0, y: 0, z: 0 },
      work_position: { x: 0, y: 0, z: 0 },
      feed_rate: 0,
      spindle_speed: 0,
      laser_power: 0,
      progress: 100,
      current_line: 0,
      total_lines: 0,
      current_file: null,
      error_message: null,
      feed_override: 100,
      spindle_override: 100,
    };
    const dm = makeMockDM({ getDeviceStatus: vi.fn().mockResolvedValue(status) });
    const app = buildApp(dm);
    jobQueue.push({
      id: '20',
      name: 'D',
      deviceId: 'cnc-1',
      filepath: '/tmp/d',
      status: 'running',
      progress: 50,
      createdAt: Date.now(),
    });
    const res = await request(app).get('/jobs');
    expect(res.status).toBe(200);
    expect(res.body.jobs[0].status).toBe('completed');
    expect(res.body.jobs[0].progress).toBe(100);
  });

  it('alarm state-ben failed-re állítja a futó jobot', async () => {
    const status: DeviceStatus = {
      state: 'alarm',
      position: { x: 0, y: 0, z: 0 },
      work_position: { x: 0, y: 0, z: 0 },
      feed_rate: 0,
      spindle_speed: 0,
      laser_power: 0,
      progress: 30,
      current_line: 0,
      total_lines: 0,
      current_file: null,
      error_message: 'limit hit',
      feed_override: 100,
      spindle_override: 100,
    };
    const dm = makeMockDM({ getDeviceStatus: vi.fn().mockResolvedValue(status) });
    const app = buildApp(dm);
    jobQueue.push({
      id: '21',
      name: 'E',
      deviceId: 'cnc-1',
      filepath: '/tmp/e',
      status: 'running',
      progress: 10,
      createdAt: Date.now(),
    });
    const res = await request(app).get('/jobs');
    expect(res.status).toBe(200);
    expect(res.body.jobs[0].status).toBe('failed');
  });
});

describe('jobs.routes — POST /jobs/reorder', () => {
  it('a megadott sorrendet alkalmazza', async () => {
    const app = buildApp(makeMockDM());
    jobQueue.push(
      {
        id: 'a',
        name: 'A',
        deviceId: 'd',
        filepath: '/x',
        status: 'pending',
        progress: 0,
        createdAt: 1,
      },
      {
        id: 'b',
        name: 'B',
        deviceId: 'd',
        filepath: '/x',
        status: 'pending',
        progress: 0,
        createdAt: 2,
      },
      {
        id: 'c',
        name: 'C',
        deviceId: 'd',
        filepath: '/x',
        status: 'pending',
        progress: 0,
        createdAt: 3,
      }
    );

    const res = await request(app).post('/jobs/reorder').send({ order: ['c', 'a', 'b'] });
    expect(res.status).toBe(200);
    expect(jobQueue.map((j) => j.id)).toEqual(['c', 'a', 'b']);
  });

  it('érvénytelen body-ra 400-at ad', async () => {
    const app = buildApp(makeMockDM());
    const res = await request(app).post('/jobs/reorder').send({ order: 'not-an-array' });
    expect(res.status).toBe(400);
  });
});
