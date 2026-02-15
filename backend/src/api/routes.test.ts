/**
 * API Routes Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { createApiRoutes } from './routes.js';
import { DeviceManager, Device, DeviceStatus, DeviceCapabilities } from '../devices/DeviceManager.js';
import { StateManager } from '../state/StateManager.js';

// Create mock managers
const createMockDeviceManager = (): Partial<DeviceManager> => ({
  getDevices: vi.fn(),
  getDevice: vi.fn(),
  getDeviceStatus: vi.fn(),
  getDeviceCapabilities: vi.fn(),
  connectDevice: vi.fn(),
  disconnectDevice: vi.fn(),
  home: vi.fn(),
  jog: vi.fn(),
  jogStop: vi.fn(),
  sendGCode: vi.fn(),
  loadFile: vi.fn(),
  run: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
  setFeedOverride: vi.fn(),
  setSpindleOverride: vi.fn(),
});

const createMockStateManager = (): Partial<StateManager> => ({
  getClientCount: vi.fn().mockReturnValue(5),
});

describe('API Routes', () => {
  let app: Express;
  let mockDeviceManager: Partial<DeviceManager>;
  let mockStateManager: Partial<StateManager>;

  const mockDevice: Device = {
    id: 'cnc-main',
    name: 'Main CNC',
    type: 'cnc',
    driver: 'linuxcnc',
    connected: true,
    state: 'idle',
  };

  const mockStatus: DeviceStatus = {
    state: 'idle',
    position: { x: 10, y: 20, z: 30 },
    work_position: { x: 10, y: 20, z: 30 },
    feed_rate: 1000,
    spindle_speed: 0,
    laser_power: 0,
    progress: 0,
    current_line: 0,
    total_lines: 0,
    current_file: null,
    error_message: null,
    feed_override: 100,
    spindle_override: 100,
  };

  const mockCapabilities: DeviceCapabilities = {
    axes: ['X', 'Y', 'Z'],
    has_spindle: true,
    has_laser: false,
    has_coolant: true,
    has_probe: true,
    has_tool_changer: false,
    has_gripper: false,
    has_sucker: false,
    max_feed_rate: 5000,
    max_spindle_speed: 24000,
    max_laser_power: 0,
    work_envelope: { x: 400, y: 400, z: 200 },
  };

  beforeEach(() => {
    mockDeviceManager = createMockDeviceManager();
    mockStateManager = createMockStateManager();
    
    app = express();
    app.use(express.json());
    app.use('/api', createApiRoutes(
      mockDeviceManager as DeviceManager,
      mockStateManager as StateManager
    ));
  });

  describe('GET /api/devices', () => {
    it('should return all devices', async () => {
      (mockDeviceManager.getDevices as ReturnType<typeof vi.fn>).mockReturnValue([mockDevice]);

      const response = await request(app).get('/api/devices');

      expect(response.status).toBe(200);
      expect(response.body.devices).toHaveLength(1);
      expect(response.body.devices[0].id).toBe('cnc-main');
    });

    it('should return empty array when no devices', async () => {
      (mockDeviceManager.getDevices as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const response = await request(app).get('/api/devices');

      expect(response.status).toBe(200);
      expect(response.body.devices).toEqual([]);
    });
  });

  describe('GET /api/devices/:id', () => {
    it('should return device by id', async () => {
      (mockDeviceManager.getDevice as ReturnType<typeof vi.fn>).mockReturnValue(mockDevice);

      const response = await request(app).get('/api/devices/cnc-main');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('cnc-main');
      expect(response.body.name).toBe('Main CNC');
    });

    it('should return 404 for non-existent device', async () => {
      (mockDeviceManager.getDevice as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const response = await request(app).get('/api/devices/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/devices/:id/status', () => {
    it('should return device status', async () => {
      (mockDeviceManager.getDeviceStatus as ReturnType<typeof vi.fn>).mockResolvedValue(mockStatus);

      const response = await request(app).get('/api/devices/cnc-main/status');

      expect(response.status).toBe(200);
      expect(response.body.state).toBe('idle');
      expect(response.body.position).toEqual({ x: 10, y: 20, z: 30 });
    });

    it('should return 404 for non-existent device status', async () => {
      (mockDeviceManager.getDeviceStatus as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const response = await request(app).get('/api/devices/non-existent/status');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/devices/:id/capabilities', () => {
    it('should return device capabilities', async () => {
      (mockDeviceManager.getDeviceCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue(mockCapabilities);

      const response = await request(app).get('/api/devices/cnc-main/capabilities');

      expect(response.status).toBe(200);
      expect(response.body.axes).toEqual(['X', 'Y', 'Z']);
      expect(response.body.has_spindle).toBe(true);
    });

    it('should return 404 for non-existent device capabilities', async () => {
      (mockDeviceManager.getDeviceCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const response = await request(app).get('/api/devices/non-existent/capabilities');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/devices/:id/connect', () => {
    it('should connect device', async () => {
      (mockDeviceManager.connectDevice as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app).post('/api/devices/cnc-main/connect');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockDeviceManager.connectDevice).toHaveBeenCalledWith('cnc-main');
    });

    it('should return failure on connect error', async () => {
      (mockDeviceManager.connectDevice as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const response = await request(app).post('/api/devices/cnc-main/connect');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/devices/:id/disconnect', () => {
    it('should disconnect device', async () => {
      (mockDeviceManager.disconnectDevice as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app).post('/api/devices/cnc-main/disconnect');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/devices/:id/home', () => {
    it('should home all axes', async () => {
      (mockDeviceManager.home as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app)
        .post('/api/devices/cnc-main/home')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockDeviceManager.home).toHaveBeenCalledWith('cnc-main', undefined);
    });

    it('should home specific axes', async () => {
      (mockDeviceManager.home as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app)
        .post('/api/devices/cnc-main/home')
        .send({ axes: ['X', 'Y'] });

      expect(response.status).toBe(200);
      expect(mockDeviceManager.home).toHaveBeenCalledWith('cnc-main', ['X', 'Y']);
    });
  });

  describe('POST /api/devices/:id/jog', () => {
    it('should jog axis', async () => {
      (mockDeviceManager.jog as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app)
        .post('/api/devices/cnc-main/jog')
        .send({ axis: 'X', distance: 10, feed_rate: 1000 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockDeviceManager.jog).toHaveBeenCalledWith('cnc-main', 'X', 10, 1000);
    });
  });

  describe('POST /api/devices/:id/jog/stop', () => {
    it('should stop jog', async () => {
      (mockDeviceManager.jogStop as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app).post('/api/devices/cnc-main/jog/stop');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/devices/:id/gcode', () => {
    it('should send G-code', async () => {
      (mockDeviceManager.sendGCode as ReturnType<typeof vi.fn>).mockResolvedValue('ok');

      const response = await request(app)
        .post('/api/devices/cnc-main/gcode')
        .send({ gcode: 'G0 X0 Y0' });

      expect(response.status).toBe(200);
      expect(response.body.response).toBe('ok');
      expect(mockDeviceManager.sendGCode).toHaveBeenCalledWith('cnc-main', 'G0 X0 Y0');
    });
  });

  describe('POST /api/devices/:id/load', () => {
    it('should load file', async () => {
      (mockDeviceManager.loadFile as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app)
        .post('/api/devices/cnc-main/load')
        .send({ filepath: '/path/to/file.nc' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockDeviceManager.loadFile).toHaveBeenCalledWith('cnc-main', '/path/to/file.nc');
    });
  });

  describe('POST /api/devices/:id/run', () => {
    it('should run from beginning', async () => {
      (mockDeviceManager.run as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app).post('/api/devices/cnc-main/run');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockDeviceManager.run).toHaveBeenCalledWith('cnc-main', 0);
    });

    it('should run from specific line', async () => {
      (mockDeviceManager.run as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app).post('/api/devices/cnc-main/run?from_line=100');

      expect(response.status).toBe(200);
      expect(mockDeviceManager.run).toHaveBeenCalledWith('cnc-main', 100);
    });
  });

  describe('POST /api/devices/:id/pause', () => {
    it('should pause device', async () => {
      (mockDeviceManager.pause as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app).post('/api/devices/cnc-main/pause');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/devices/:id/resume', () => {
    it('should resume device', async () => {
      (mockDeviceManager.resume as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app).post('/api/devices/cnc-main/resume');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/devices/:id/stop', () => {
    it('should stop device', async () => {
      (mockDeviceManager.stop as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app).post('/api/devices/cnc-main/stop');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/devices/:id/reset', () => {
    it('should reset device', async () => {
      (mockDeviceManager.reset as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app).post('/api/devices/cnc-main/reset');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/devices/:id/feed-override', () => {
    it('should set feed override', async () => {
      (mockDeviceManager.setFeedOverride as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app)
        .post('/api/devices/cnc-main/feed-override')
        .send({ percent: 120 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockDeviceManager.setFeedOverride).toHaveBeenCalledWith('cnc-main', 120);
    });
  });

  describe('POST /api/devices/:id/spindle-override', () => {
    it('should set spindle override', async () => {
      (mockDeviceManager.setSpindleOverride as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const response = await request(app)
        .post('/api/devices/cnc-main/spindle-override')
        .send({ percent: 80 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockDeviceManager.setSpindleOverride).toHaveBeenCalledWith('cnc-main', 80);
    });
  });

  describe('GET /api/stats', () => {
    it('should return stats', async () => {
      (mockDeviceManager.getDevices as ReturnType<typeof vi.fn>).mockReturnValue([mockDevice]);

      const response = await request(app).get('/api/stats');

      expect(response.status).toBe(200);
      expect(response.body.connectedClients).toBe(5);
      expect(response.body.devices).toBe(1);
    });
  });
});
