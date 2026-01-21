/**
 * Device Store Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useDeviceStore } from './deviceStore';
import type { Device, DeviceStatus, Position } from '../types/device';

// Mock socket.io-client
const mockEmit = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: mockOn,
    off: mockOff,
    emit: mockEmit,
    disconnect: mockDisconnect,
    connected: true,
    active: true,
  })),
}));

const mockDevice: Device = {
  id: 'cnc-main',
  name: 'Main CNC',
  type: 'cnc_mill',
  driver: 'linuxcnc',
  connected: true,
  state: 'idle',
};

const mockStatus: DeviceStatus = {
  state: 'idle',
  position: { x: 100, y: 200, z: 50 },
  work_position: { x: 100, y: 200, z: 50 },
  feed_rate: 1000,
  spindle_speed: 5000,
  laser_power: 0,
  progress: 0,
  current_line: 0,
  total_lines: 0,
  current_file: null,
  error_message: null,
  feed_override: 100,
  spindle_override: 100,
};

describe('Device Store', () => {
  beforeEach(() => {
    // Reset store state using setState (compatible with immer)
    useDeviceStore.setState({
      devices: [],
      selectedDeviceId: null,
      connected: false,
      socket: null,
      notifications: [],
    });
    
    // Clear mocks
    mockEmit.mockClear();
    mockOn.mockClear();
    mockOff.mockClear();
    mockDisconnect.mockClear();
  });

  describe('Initial state', () => {
    it('should have empty devices array', () => {
      const state = useDeviceStore.getState();
      expect(state.devices).toEqual([]);
    });

    it('should have null selectedDeviceId', () => {
      const state = useDeviceStore.getState();
      expect(state.selectedDeviceId).toBeNull();
    });

    it('should not be connected', () => {
      const state = useDeviceStore.getState();
      expect(state.connected).toBe(false);
    });

    it('should have null socket', () => {
      const state = useDeviceStore.getState();
      expect(state.socket).toBeNull();
    });
  });

  describe('setDevices', () => {
    it('should set devices', () => {
      act(() => {
        useDeviceStore.getState().setDevices([mockDevice]);
      });

      expect(useDeviceStore.getState().devices).toHaveLength(1);
      expect(useDeviceStore.getState().devices[0].id).toBe('cnc-main');
    });

    it('should replace existing devices', () => {
      act(() => {
        useDeviceStore.getState().setDevices([mockDevice]);
        useDeviceStore.getState().setDevices([{ ...mockDevice, id: 'laser-1', name: 'Laser' }]);
      });

      expect(useDeviceStore.getState().devices).toHaveLength(1);
      expect(useDeviceStore.getState().devices[0].id).toBe('laser-1');
    });
  });

  describe('updateDeviceStatus', () => {
    beforeEach(() => {
      act(() => {
        useDeviceStore.getState().setDevices([mockDevice]);
      });
    });

    it('should update device status', () => {
      act(() => {
        useDeviceStore.getState().updateDeviceStatus('cnc-main', mockStatus);
      });

      const device = useDeviceStore.getState().devices[0];
      expect(device.status).toEqual(mockStatus);
      expect(device.state).toBe('idle');
    });

    it('should update connected state based on status', () => {
      act(() => {
        useDeviceStore.getState().updateDeviceStatus('cnc-main', {
          ...mockStatus,
          state: 'disconnected',
        });
      });

      const device = useDeviceStore.getState().devices[0];
      expect(device.connected).toBe(false);
    });

    it('should not update non-existent device', () => {
      act(() => {
        useDeviceStore.getState().updateDeviceStatus('non-existent', mockStatus);
      });

      const device = useDeviceStore.getState().devices.find(d => d.id === 'non-existent');
      expect(device).toBeUndefined();
    });
  });

  describe('updateDevicePosition', () => {
    beforeEach(() => {
      act(() => {
        useDeviceStore.getState().setDevices([{ ...mockDevice, status: mockStatus }]);
      });
    });

    it('should update device position', () => {
      const newPosition: Position = { x: 50, y: 100, z: 25 };
      
      act(() => {
        useDeviceStore.getState().updateDevicePosition('cnc-main', newPosition);
      });

      const device = useDeviceStore.getState().devices[0];
      expect(device.status?.position).toEqual(newPosition);
    });

    it('should not update device without status', () => {
      act(() => {
        useDeviceStore.getState().setDevices([mockDevice]); // No status
      });

      const newPosition: Position = { x: 50, y: 100, z: 25 };
      
      act(() => {
        useDeviceStore.getState().updateDevicePosition('cnc-main', newPosition);
      });

      const device = useDeviceStore.getState().devices[0];
      expect(device.status).toBeUndefined();
    });
  });

  describe('updateDeviceState', () => {
    beforeEach(() => {
      act(() => {
        useDeviceStore.getState().setDevices([mockDevice]);
      });
    });

    it('should update device state', () => {
      act(() => {
        useDeviceStore.getState().updateDeviceState('cnc-main', 'running');
      });

      const device = useDeviceStore.getState().devices[0];
      expect(device.state).toBe('running');
    });

    it('should update connected based on new state', () => {
      act(() => {
        useDeviceStore.getState().updateDeviceState('cnc-main', 'disconnected');
      });

      const device = useDeviceStore.getState().devices[0];
      expect(device.connected).toBe(false);
    });

    it('should mark as connected when not disconnected', () => {
      act(() => {
        useDeviceStore.getState().updateDeviceState('cnc-main', 'idle');
      });

      const device = useDeviceStore.getState().devices[0];
      expect(device.connected).toBe(true);
    });
  });

  describe('selectDevice', () => {
    it('should select device', () => {
      act(() => {
        useDeviceStore.getState().selectDevice('cnc-main');
      });

      expect(useDeviceStore.getState().selectedDeviceId).toBe('cnc-main');
    });

    it('should allow null selection', () => {
      act(() => {
        useDeviceStore.getState().selectDevice('cnc-main');
        useDeviceStore.getState().selectDevice(null);
      });

      expect(useDeviceStore.getState().selectedDeviceId).toBeNull();
    });
  });

  describe('Commands (with socket)', () => {
    let mockSocket: { emit: typeof mockEmit; on: typeof mockOn; disconnect: typeof mockDisconnect };

    beforeEach(() => {
      mockSocket = {
        emit: mockEmit,
        on: mockOn,
        disconnect: mockDisconnect,
      };
      
      // Set socket in store
      const store = useDeviceStore.getState();
      (store as unknown as { socket: typeof mockSocket }).socket = mockSocket;
    });

    describe('sendCommand', () => {
      it('should emit device:command event', () => {
        act(() => {
          useDeviceStore.getState().sendCommand('cnc-main', 'home');
        });

        expect(mockEmit).toHaveBeenCalledWith('device:command', {
          deviceId: 'cnc-main',
          command: 'home',
          params: undefined,
        });
      });

      it('should include params when provided', () => {
        act(() => {
          useDeviceStore.getState().sendCommand('cnc-main', 'run', { fromLine: 100 });
        });

        expect(mockEmit).toHaveBeenCalledWith('device:command', {
          deviceId: 'cnc-main',
          command: 'run',
          params: { fromLine: 100 },
        });
      });
    });

    describe('jog', () => {
      it('should emit device:jog event', () => {
        act(() => {
          useDeviceStore.getState().jog('cnc-main', 'X', 10, 1000);
        });

        expect(mockEmit).toHaveBeenCalledWith('device:jog', {
          deviceId: 'cnc-main',
          axis: 'X',
          distance: 10,
          feedRate: 1000,
        });
      });
    });

    describe('jogStop', () => {
      it('should emit device:jog:stop event', () => {
        act(() => {
          useDeviceStore.getState().jogStop('cnc-main');
        });

        expect(mockEmit).toHaveBeenCalledWith('device:jog:stop', {
          deviceId: 'cnc-main',
        });
      });
    });

    describe('sendMDI', () => {
      it('should emit device:mdi event', () => {
        act(() => {
          useDeviceStore.getState().sendMDI('cnc-main', 'G0 X0 Y0');
        });

        expect(mockEmit).toHaveBeenCalledWith('device:mdi', {
          deviceId: 'cnc-main',
          gcode: 'G0 X0 Y0',
        });
      });
    });
  });

  describe('Commands (without socket)', () => {
    it('should not throw when socket is null', () => {
      expect(() => {
        act(() => {
          useDeviceStore.getState().sendCommand('cnc-main', 'home');
        });
      }).not.toThrow();
    });

    it('should not emit when socket is null', () => {
      act(() => {
        useDeviceStore.getState().sendCommand('cnc-main', 'home');
      });

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should call socket.disconnect when socket exists', () => {
      const mockSocket = {
        emit: mockEmit,
        on: mockOn,
        off: mockOff,
        disconnect: mockDisconnect,
        connected: true,
        active: true,
      };
      
      // Use setState for immer compatibility
      useDeviceStore.setState({ socket: mockSocket as unknown as ReturnType<typeof import('socket.io-client').io> });

      act(() => {
        useDeviceStore.getState().disconnect();
      });

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should reset socket and connected state', () => {
      const mockSocket = {
        emit: mockEmit,
        on: mockOn,
        off: mockOff,
        disconnect: mockDisconnect,
        connected: true,
        active: true,
      };
      
      // Use setState for immer compatibility
      useDeviceStore.setState({ 
        socket: mockSocket as unknown as ReturnType<typeof import('socket.io-client').io>,
        connected: true 
      });

      act(() => {
        useDeviceStore.getState().disconnect();
      });

      expect(useDeviceStore.getState().socket).toBeNull();
      expect(useDeviceStore.getState().connected).toBe(false);
    });

    it('should do nothing when socket is null', () => {
      expect(() => {
        act(() => {
          useDeviceStore.getState().disconnect();
        });
      }).not.toThrow();
    });
  });
});
