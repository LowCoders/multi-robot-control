import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxiosError } from 'axios';
import { BridgeClient } from './bridgeClient.js';

interface MockAxios {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
}

function makeClient(): { client: BridgeClient; raw: MockAxios } {
  const client = new BridgeClient('http://localhost:4002');
  const raw = client.raw as unknown as MockAxios;
  raw.get = vi.fn();
  raw.post = vi.fn();
  return { client, raw };
}

function makeAxios404(): AxiosError {
  const err = new AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST');
  err.response = {
    status: 404,
    statusText: 'Not Found',
    data: {},
    headers: {},
    config: {} as never,
  };
  return err;
}

describe('BridgeClient — safeGet 404 handling', () => {
  let client: BridgeClient;
  let raw: MockAxios;

  beforeEach(() => {
    ({ client, raw } = makeClient());
  });

  it('null-t ad vissza, ha a bridge 404-et válaszol', async () => {
    raw.get.mockRejectedValueOnce(makeAxios404());
    const result = await client.getDeviceStatus('missing');
    expect(result).toBeNull();
  });

  it('továbbadja a payload-ot, ha a bridge 200-at válaszol', async () => {
    const status = { state: 'idle', position: { x: 0, y: 0, z: 0 } };
    raw.get.mockResolvedValueOnce({ data: status });
    const result = await client.getDeviceStatus('cnc-1');
    expect(result).toEqual(status);
    expect(raw.get).toHaveBeenCalledWith('/devices/cnc-1/status', undefined);
  });

  it('encodeURIComponent-et használ a deviceId-re', async () => {
    raw.get.mockResolvedValueOnce({ data: null });
    await client.getDeviceStatus('cnc/with space');
    expect(raw.get).toHaveBeenCalledWith('/devices/cnc%2Fwith%20space/status', undefined);
  });
});

describe('BridgeClient — successPost', () => {
  let client: BridgeClient;
  let raw: MockAxios;

  beforeEach(() => {
    ({ client, raw } = makeClient());
  });

  it('true-t ad vissza, ha a bridge { success: true }-vel válaszol', async () => {
    raw.post.mockResolvedValueOnce({ data: { success: true } });
    const ok = await client.connectDevice('cnc-1');
    expect(ok).toBe(true);
    expect(raw.post).toHaveBeenCalledWith('/devices/cnc-1/connect', null, undefined);
  });

  it('false-ot ad vissza, ha a bridge { success: false }-szel válaszol', async () => {
    raw.post.mockResolvedValueOnce({ data: { success: false } });
    const ok = await client.connectDevice('cnc-1');
    expect(ok).toBe(false);
  });

  it('false-ot ad vissza, ha hálózati hiba történik (logol, de nem dob)', async () => {
    raw.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const ok = await client.connectDevice('cnc-1');
    expect(ok).toBe(false);
  });
});

describe('BridgeClient — addDevice', () => {
  it('a payload-ot a /devices POST végpontra küldi', async () => {
    const { client, raw } = makeClient();
    raw.post.mockResolvedValueOnce({ data: { success: true } });
    const payload = {
      id: 'cnc-1',
      name: 'CNC',
      type: 'cnc_mill',
      driver: 'grbl',
      enabled: true,
      config: { port: '/dev/ttyUSB0' },
    };
    const ok = await client.addDevice(payload);
    expect(ok).toBe(true);
    expect(raw.post).toHaveBeenCalledWith('/devices', payload, undefined);
  });
});

describe('BridgeClient — getJogDiagnostics', () => {
  it('null-t ad vissza 404-re és a választ adja 200-ra', async () => {
    const { client, raw } = makeClient();
    raw.get.mockResolvedValueOnce({
      data: { protocol: 'grbl1.1', last_jog_trace: { commands: ['$J=G91 X10'] } },
    });
    const ok = await client.getJogDiagnostics('cnc-1');
    expect(ok?.protocol).toBe('grbl1.1');
    expect(ok?.last_jog_trace?.commands).toEqual(['$J=G91 X10']);

    raw.get.mockRejectedValueOnce(makeAxios404());
    const miss = await client.getJogDiagnostics('cnc-1');
    expect(miss).toBeNull();
  });
});

describe('BridgeClient — sendGCode', () => {
  it('a response stringet adja vissza, vagy "error"-t, ha üres', async () => {
    const { client, raw } = makeClient();
    raw.post.mockResolvedValueOnce({ data: { response: 'ok' } });
    const ok = await client.sendGCode('cnc-1', 'G0 X10');
    expect(ok).toBe('ok');

    raw.post.mockResolvedValueOnce({ data: {} });
    const empty = await client.sendGCode('cnc-1', 'G0 X10');
    expect(empty).toBe('error');
  });
});
