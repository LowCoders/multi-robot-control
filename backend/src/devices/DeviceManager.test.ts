/**
 * DeviceManager Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeviceManager, Device, DeviceStatus } from './DeviceManager.js';
import { StateManager } from '../state/StateManager.js';

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(),
      post: vi.fn(),
    })),
  },
}));

// Mock ws
vi.mock('ws', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  })),
}));

// Create mock StateManager
const createMockStateManager = (): Partial<StateManager> => ({
  broadcastDeviceStatus: vi.fn(),
  broadcastStateChange: vi.fn(),
  broadcastPosition: vi.fn(),
  broadcastError: vi.fn(),
  broadcastJobComplete: vi.fn(),
});

describe('DeviceManager', () => {
  let deviceManager: DeviceManager;
  let mockStateManager: Partial<StateManager>;

  beforeEach(() => {
    mockStateManager = createMockStateManager();
    deviceManager = new DeviceManager(
      'http://localhost:8080',
      mockStateManager as StateManager
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should create DeviceManager instance', () => {
      expect(deviceManager).toBeDefined();
    });

    it('should return empty device list initially', () => {
      const devices = deviceManager.getDevices();
      expect(devices).toEqual([]);
    });

    it('should return undefined for non-existent device', () => {
      const device = deviceManager.getDevice('non-existent');
      expect(device).toBeUndefined();
    });
  });

  describe('Device Configuration', () => {
    it('should initialize with device configs (simulated)', async () => {
      // Since initialize calls external services, we test the internal state setup
      // by calling a partial initialization
      
      // Access private method through type assertion for testing
      const dm = deviceManager as unknown as {
        devices: Map<string, Device>;
      };

      // Simulate adding devices
      dm.devices.set('cnc-main', {
        id: 'cnc-main',
        name: 'Main CNC',
        type: 'cnc',
        driver: 'linuxcnc',
        connected: false,
        state: 'disconnected',
      });

      dm.devices.set('laser-1', {
        id: 'laser-1',
        name: 'Laser Cutter',
        type: 'laser',
        driver: 'grbl',
        connected: false,
        state: 'disconnected',
      });

      expect(deviceManager.getDevices()).toHaveLength(2);
      expect(deviceManager.getDevice('cnc-main')).toBeDefined();
      expect(deviceManager.getDevice('laser-1')).toBeDefined();
      expect(deviceManager.getDevice('disabled-device')).toBeUndefined();
    });
  });

  describe('Device Status Updates', () => {
    beforeEach(() => {
      // Setup test devices
      const dm = deviceManager as unknown as {
        devices: Map<string, Device>;
        updateDeviceStatus: (deviceId: string, status: DeviceStatus) => void;
        handleStateChange: (deviceId: string, oldState: string, newState: string) => void;
        handlePositionUpdate: (deviceId: string, position: DeviceStatus['position']) => void;
        handleError: (deviceId: string, message: string) => void;
      };

      dm.devices.set('test-device', {
        id: 'test-device',
        name: 'Test Device',
        type: 'cnc',
        driver: 'linuxcnc',
        connected: false,
        state: 'disconnected',
      });
    });

    it('should update device status', () => {
      const dm = deviceManager as unknown as {
        updateDeviceStatus: (deviceId: string, status: DeviceStatus) => void;
      };

      const status: DeviceStatus = {
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

      dm.updateDeviceStatus('test-device', status);

      const device = deviceManager.getDevice('test-device');
      expect(device?.state).toBe('idle');
      expect(device?.connected).toBe(true);
      expect(device?.status).toEqual(status);
      expect(mockStateManager.broadcastDeviceStatus).toHaveBeenCalledWith('test-device', status);
    });

    it('should handle state change', () => {
      const dm = deviceManager as unknown as {
        handleStateChange: (deviceId: string, oldState: string, newState: string) => void;
      };

      dm.handleStateChange('test-device', 'idle', 'running');

      const device = deviceManager.getDevice('test-device');
      expect(device?.state).toBe('running');
      expect(device?.connected).toBe(true);
      expect(mockStateManager.broadcastStateChange).toHaveBeenCalledWith('test-device', 'idle', 'running');
    });

    it('should handle disconnected state', () => {
      const dm = deviceManager as unknown as {
        handleStateChange: (deviceId: string, oldState: string, newState: string) => void;
      };

      dm.handleStateChange('test-device', 'idle', 'disconnected');

      const device = deviceManager.getDevice('test-device');
      expect(device?.connected).toBe(false);
    });

    it('should handle position update', () => {
      const dm = deviceManager as unknown as {
        devices: Map<string, Device>;
        handlePositionUpdate: (deviceId: string, position: DeviceStatus['position']) => void;
      };

      // First set a status on the device
      const device = dm.devices.get('test-device');
      if (device) {
        device.status = {
          state: 'running',
          position: { x: 0, y: 0, z: 0 },
          work_position: { x: 0, y: 0, z: 0 },
          feed_rate: 0,
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
      }

      const newPosition = { x: 100, y: 200, z: 50 };
      dm.handlePositionUpdate('test-device', newPosition);

      const updatedDevice = deviceManager.getDevice('test-device');
      expect(updatedDevice?.status?.position).toEqual(newPosition);
      expect(mockStateManager.broadcastPosition).toHaveBeenCalledWith('test-device', newPosition);
    });

    it('should handle error', () => {
      const dm = deviceManager as unknown as {
        handleError: (deviceId: string, message: string) => void;
      };

      dm.handleError('test-device', 'Connection timeout');

      const device = deviceManager.getDevice('test-device');
      expect(device?.state).toBe('alarm');
      expect(mockStateManager.broadcastError).toHaveBeenCalledWith('test-device', 'Connection timeout');
    });
  });

  describe('Device List', () => {
    it('should return all devices as array', () => {
      const dm = deviceManager as unknown as {
        devices: Map<string, Device>;
      };

      dm.devices.set('device-1', {
        id: 'device-1',
        name: 'Device 1',
        type: 'cnc',
        driver: 'linuxcnc',
        connected: true,
        state: 'idle',
      });

      dm.devices.set('device-2', {
        id: 'device-2',
        name: 'Device 2',
        type: 'laser',
        driver: 'grbl',
        connected: false,
        state: 'disconnected',
      });

      const devices = deviceManager.getDevices();
      expect(devices).toHaveLength(2);
      expect(devices.map(d => d.id)).toContain('device-1');
      expect(devices.map(d => d.id)).toContain('device-2');
    });
  });
});
