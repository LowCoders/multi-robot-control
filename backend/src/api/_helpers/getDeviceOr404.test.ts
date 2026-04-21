import { describe, it, expect } from 'vitest';
import { getDeviceOr404 } from './getDeviceOr404.js';
import { NotFoundError } from '../../errors/AppError.js';
import type { DeviceManager, Device } from '../../devices/DeviceManager.js';

function makeMgr(devices: Record<string, Device>): DeviceManager {
  return {
    getDevice: (id: string) => devices[id],
  } as unknown as DeviceManager;
}

const sampleDevice: Device = {
  id: 'cnc-1',
  name: 'CNC #1',
  type: 'cnc_mill',
  driver: 'grbl',
  connected: true,
  state: 'idle',
};

describe('getDeviceOr404', () => {
  it('visszaadja a létező eszközt', () => {
    const mgr = makeMgr({ 'cnc-1': sampleDevice });
    const dev = getDeviceOr404(mgr, 'cnc-1');
    expect(dev).toBe(sampleDevice);
  });

  it('NotFoundError-t dob, ha nincs ilyen ID', () => {
    const mgr = makeMgr({});
    let caught: unknown = null;
    try {
      getDeviceOr404(mgr, 'missing');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect((caught as NotFoundError).message).toContain('missing');
    expect((caught as NotFoundError).httpStatus).toBe(404);
    expect((caught as NotFoundError).code).toBe('not_found');
  });
});
