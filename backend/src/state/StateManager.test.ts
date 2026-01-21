/**
 * StateManager Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateManager } from './StateManager.js';
import { Server as SocketIOServer, Socket } from 'socket.io';

// Mock Socket.IO
const createMockSocket = (id: string): Partial<Socket> => ({
  id,
  join: vi.fn(),
  leave: vi.fn(),
});

const createMockIO = (): Partial<SocketIOServer> => ({
  emit: vi.fn(),
  to: vi.fn().mockReturnThis(),
});

describe('StateManager', () => {
  let stateManager: StateManager;
  let mockIO: Partial<SocketIOServer>;

  beforeEach(() => {
    mockIO = createMockIO();
    stateManager = new StateManager(mockIO as SocketIOServer);
  });

  describe('Client Management', () => {
    it('should register a client', () => {
      const mockSocket = createMockSocket('client-1');
      
      stateManager.registerClient(mockSocket as Socket);
      
      expect(stateManager.getClientCount()).toBe(1);
    });

    it('should unregister a client', () => {
      const mockSocket = createMockSocket('client-1');
      
      stateManager.registerClient(mockSocket as Socket);
      expect(stateManager.getClientCount()).toBe(1);
      
      stateManager.unregisterClient('client-1');
      expect(stateManager.getClientCount()).toBe(0);
    });

    it('should handle multiple clients', () => {
      const socket1 = createMockSocket('client-1');
      const socket2 = createMockSocket('client-2');
      const socket3 = createMockSocket('client-3');
      
      stateManager.registerClient(socket1 as Socket);
      stateManager.registerClient(socket2 as Socket);
      stateManager.registerClient(socket3 as Socket);
      
      expect(stateManager.getClientCount()).toBe(3);
      
      stateManager.unregisterClient('client-2');
      expect(stateManager.getClientCount()).toBe(2);
    });
  });

  describe('Device Subscription', () => {
    it('should subscribe client to device', () => {
      const mockSocket = createMockSocket('client-1');
      stateManager.registerClient(mockSocket as Socket);
      
      stateManager.subscribeToDevice('client-1', 'device-cnc');
      
      expect(mockSocket.join).toHaveBeenCalledWith('device:device-cnc');
      expect(stateManager.getSubscribedClients('device-cnc')).toBe(1);
    });

    it('should unsubscribe client from device', () => {
      const mockSocket = createMockSocket('client-1');
      stateManager.registerClient(mockSocket as Socket);
      
      stateManager.subscribeToDevice('client-1', 'device-cnc');
      expect(stateManager.getSubscribedClients('device-cnc')).toBe(1);
      
      stateManager.unsubscribeFromDevice('client-1', 'device-cnc');
      expect(mockSocket.leave).toHaveBeenCalledWith('device:device-cnc');
      expect(stateManager.getSubscribedClients('device-cnc')).toBe(0);
    });

    it('should count subscribed clients per device', () => {
      const socket1 = createMockSocket('client-1');
      const socket2 = createMockSocket('client-2');
      const socket3 = createMockSocket('client-3');
      
      stateManager.registerClient(socket1 as Socket);
      stateManager.registerClient(socket2 as Socket);
      stateManager.registerClient(socket3 as Socket);
      
      stateManager.subscribeToDevice('client-1', 'device-cnc');
      stateManager.subscribeToDevice('client-2', 'device-cnc');
      stateManager.subscribeToDevice('client-3', 'device-laser');
      
      expect(stateManager.getSubscribedClients('device-cnc')).toBe(2);
      expect(stateManager.getSubscribedClients('device-laser')).toBe(1);
    });

    it('should not fail for non-existent client', () => {
      expect(() => {
        stateManager.subscribeToDevice('non-existent', 'device-cnc');
      }).not.toThrow();
    });
  });

  describe('Broadcast Methods', () => {
    it('should broadcast to all clients', () => {
      stateManager.broadcastToAll('test-event', { foo: 'bar' });
      
      expect(mockIO.emit).toHaveBeenCalledWith('test-event', { foo: 'bar' });
    });

    it('should broadcast device status', () => {
      const status = {
        state: 'idle',
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

      stateManager.broadcastDeviceStatus('device-cnc', status);

      expect(mockIO.emit).toHaveBeenCalledWith('device:status', expect.objectContaining({
        deviceId: 'device-cnc',
        status,
        timestamp: expect.any(Number),
      }));
    });

    it('should broadcast state change', () => {
      stateManager.broadcastStateChange('device-cnc', 'idle', 'running');

      expect(mockIO.emit).toHaveBeenCalledWith('device:state_change', expect.objectContaining({
        deviceId: 'device-cnc',
        oldState: 'idle',
        newState: 'running',
        timestamp: expect.any(Number),
      }));
    });

    it('should broadcast error', () => {
      stateManager.broadcastError('device-cnc', 'Connection lost');

      expect(mockIO.emit).toHaveBeenCalledWith('device:error', expect.objectContaining({
        deviceId: 'device-cnc',
        message: 'Connection lost',
        severity: 'error',
        timestamp: expect.any(Number),
      }));
    });

    it('should broadcast job complete', () => {
      stateManager.broadcastJobComplete('device-cnc', '/path/to/file.nc');

      expect(mockIO.emit).toHaveBeenCalledWith('job:complete', expect.objectContaining({
        deviceId: 'device-cnc',
        file: '/path/to/file.nc',
        timestamp: expect.any(Number),
      }));
    });

    it('should broadcast automation triggered', () => {
      stateManager.broadcastAutomationTriggered('rule-1', 'Test Rule', ['run', 'notify']);

      expect(mockIO.emit).toHaveBeenCalledWith('automation:triggered', expect.objectContaining({
        ruleId: 'rule-1',
        ruleName: 'Test Rule',
        actions: ['run', 'notify'],
        timestamp: expect.any(Number),
      }));
    });

    it('should broadcast position to device room', async () => {
      const position = { x: 100, y: 50, z: 25 };
      
      stateManager.broadcastPosition('device-cnc', position);
      
      // Flush pending throttled updates
      stateManager.flushAllPositions();

      expect(mockIO.to).toHaveBeenCalledWith('device:device-cnc');
      expect(mockIO.emit).toHaveBeenCalledWith('device:position', expect.objectContaining({
        deviceId: 'device-cnc',
        position,
        timestamp: expect.any(Number),
      }));
    });

    it('should broadcast job progress to device room', () => {
      stateManager.broadcastJobProgress('device-cnc', 50, 100, 200);

      expect(mockIO.to).toHaveBeenCalledWith('device:device-cnc');
      expect(mockIO.emit).toHaveBeenCalledWith('job:progress', expect.objectContaining({
        deviceId: 'device-cnc',
        progress: 50,
        currentLine: 100,
        totalLines: 200,
        timestamp: expect.any(Number),
      }));
    });
  });
});
