/**
 * EventEngine Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEngine, Rule } from './EventEngine.js';
import { DeviceManager } from '../devices/DeviceManager.js';
import { StateManager } from '../state/StateManager.js';

// Create mock managers
const createMockDeviceManager = (): Partial<DeviceManager> => ({
  getDevice: vi.fn(),
  getDevices: vi.fn().mockReturnValue([]),
  getDeviceStatus: vi.fn(),
  run: vi.fn().mockResolvedValue(true),
  pause: vi.fn().mockResolvedValue(true),
  resume: vi.fn().mockResolvedValue(true),
  stop: vi.fn().mockResolvedValue(true),
  loadFile: vi.fn().mockResolvedValue(true),
  sendGCode: vi.fn().mockResolvedValue('ok'),
});

const createMockStateManager = (): Partial<StateManager> => ({
  broadcastToAll: vi.fn(),
  broadcastAutomationTriggered: vi.fn(),
});

describe('EventEngine', () => {
  let eventEngine: EventEngine;
  let mockDeviceManager: Partial<DeviceManager>;
  let mockStateManager: Partial<StateManager>;

  beforeEach(() => {
    mockDeviceManager = createMockDeviceManager();
    mockStateManager = createMockStateManager();
    eventEngine = new EventEngine(
      mockDeviceManager as DeviceManager,
      mockStateManager as StateManager
    );
  });

  afterEach(() => {
    eventEngine.cleanup();
    vi.clearAllMocks();
  });

  describe('Rule Management', () => {
    it('should start with empty rules', () => {
      expect(eventEngine.getRules()).toEqual([]);
    });

    it('should get rule by id', () => {
      // Access private rules array
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'test-rule',
          name: 'Test Rule',
          enabled: true,
          trigger: { type: 'manual', event: 'test' },
          actions: [{ type: 'notify', message: 'Test' }],
        },
      ];

      const rule = eventEngine.getRule('test-rule');
      expect(rule).toBeDefined();
      expect(rule?.name).toBe('Test Rule');
    });

    it('should return undefined for non-existent rule', () => {
      const rule = eventEngine.getRule('non-existent');
      expect(rule).toBeUndefined();
    });

    it('should enable rule', () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'test-rule',
          name: 'Test Rule',
          enabled: false,
          trigger: { type: 'manual', event: 'test' },
          actions: [],
        },
      ];

      const result = eventEngine.enableRule('test-rule');
      expect(result).toBe(true);
      expect(eventEngine.getRule('test-rule')?.enabled).toBe(true);
    });

    it('should disable rule', () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'test-rule',
          name: 'Test Rule',
          enabled: true,
          trigger: { type: 'manual', event: 'test' },
          actions: [],
        },
      ];

      const result = eventEngine.disableRule('test-rule');
      expect(result).toBe(true);
      expect(eventEngine.getRule('test-rule')?.enabled).toBe(false);
    });

    it('should return false when enabling non-existent rule', () => {
      const result = eventEngine.enableRule('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('Trigger Matching', () => {
    beforeEach(() => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'job-complete-rule',
          name: 'Job Complete Rule',
          enabled: true,
          trigger: { type: 'job_complete', device: 'cnc-main' },
          actions: [{ type: 'notify', message: 'Job done!' }],
        },
        {
          id: 'state-change-rule',
          name: 'State Change Rule',
          enabled: true,
          trigger: { type: 'state_change', device: 'laser-1', to_state: 'idle' },
          actions: [{ type: 'run', device: 'cnc-main' }],
        },
        {
          id: 'manual-rule',
          name: 'Manual Start Rule',
          enabled: true,
          trigger: { type: 'manual', event: 'start_sequence' },
          actions: [{ type: 'run', device: 'all' }],
        },
        {
          id: 'disabled-rule',
          name: 'Disabled Rule',
          enabled: false,
          trigger: { type: 'manual', event: 'disabled_event' },
          actions: [{ type: 'stop', device: 'all' }],
        },
      ];
    });

    it('should trigger job_complete rule', async () => {
      await eventEngine.processEvent('job_complete', 'cnc-main', { file: 'test.nc' });

      expect(mockStateManager.broadcastAutomationTriggered).toHaveBeenCalledWith(
        'job-complete-rule',
        'Job Complete Rule',
        ['notify']
      );
    });

    it('should trigger state_change rule with correct to_state', async () => {
      await eventEngine.processEvent('state_change', 'laser-1', { 
        oldState: 'running', 
        newState: 'idle' 
      });

      expect(mockDeviceManager.run).toHaveBeenCalledWith('cnc-main');
      expect(mockStateManager.broadcastAutomationTriggered).toHaveBeenCalledWith(
        'state-change-rule',
        'State Change Rule',
        ['run']
      );
    });

    it('should not trigger state_change rule with wrong to_state', async () => {
      await eventEngine.processEvent('state_change', 'laser-1', { 
        oldState: 'idle', 
        newState: 'running' 
      });

      expect(mockDeviceManager.run).not.toHaveBeenCalled();
    });

    it('should trigger manual event rule', async () => {
      (mockDeviceManager.getDevices as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'cnc-main' },
        { id: 'laser-1' },
      ]);

      await eventEngine.triggerManualEvent('start_sequence');

      expect(mockDeviceManager.run).toHaveBeenCalledTimes(2);
    });

    it('should not trigger disabled rules', async () => {
      await eventEngine.triggerManualEvent('disabled_event');

      expect(mockDeviceManager.stop).not.toHaveBeenCalled();
    });

    it('should not trigger rule for wrong device', async () => {
      await eventEngine.processEvent('job_complete', 'laser-1', { file: 'test.nc' });

      // Should not trigger cnc-main specific rule
      expect(mockStateManager.broadcastAutomationTriggered).not.toHaveBeenCalledWith(
        'job-complete-rule',
        expect.any(String),
        expect.any(Array)
      );
    });
  });

  describe('Condition Evaluation', () => {
    beforeEach(() => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'conditional-rule',
          name: 'Conditional Rule',
          enabled: true,
          trigger: { type: 'manual', event: 'check_conditions' },
          conditions: [
            { device: 'cnc-main', state: 'idle' },
          ],
          actions: [{ type: 'run', device: 'laser-1' }],
        },
      ];
    });

    it('should execute actions when conditions are met', async () => {
      (mockDeviceManager.getDevice as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'cnc-main',
        state: 'idle',
      });

      await eventEngine.triggerManualEvent('check_conditions');

      expect(mockDeviceManager.run).toHaveBeenCalledWith('laser-1');
    });

    it('should not execute actions when conditions are not met', async () => {
      (mockDeviceManager.getDevice as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'cnc-main',
        state: 'running',
      });

      await eventEngine.triggerManualEvent('check_conditions');

      expect(mockDeviceManager.run).not.toHaveBeenCalled();
    });

    it('should not execute actions when device not found', async () => {
      (mockDeviceManager.getDevice as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      await eventEngine.triggerManualEvent('check_conditions');

      expect(mockDeviceManager.run).not.toHaveBeenCalled();
    });
  });

  describe('Action Execution', () => {
    beforeEach(() => {
      (mockDeviceManager.getDevices as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'cnc-main' },
        { id: 'laser-1' },
      ]);
    });

    it('should execute run action for single device', async () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'run-single',
          name: 'Run Single',
          enabled: true,
          trigger: { type: 'manual', event: 'run_single' },
          actions: [{ type: 'run', device: 'cnc-main' }],
        },
      ];

      await eventEngine.triggerManualEvent('run_single');

      expect(mockDeviceManager.run).toHaveBeenCalledWith('cnc-main');
      expect(mockDeviceManager.run).toHaveBeenCalledTimes(1);
    });

    it('should execute run action for all devices', async () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'run-all',
          name: 'Run All',
          enabled: true,
          trigger: { type: 'manual', event: 'run_all' },
          actions: [{ type: 'run', device: 'all' }],
        },
      ];

      await eventEngine.triggerManualEvent('run_all');

      expect(mockDeviceManager.run).toHaveBeenCalledTimes(2);
    });

    it('should execute pause action', async () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'pause-device',
          name: 'Pause Device',
          enabled: true,
          trigger: { type: 'manual', event: 'pause' },
          actions: [{ type: 'pause', device: 'cnc-main' }],
        },
      ];

      await eventEngine.triggerManualEvent('pause');

      expect(mockDeviceManager.pause).toHaveBeenCalledWith('cnc-main');
    });

    it('should execute stop action', async () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'stop-device',
          name: 'Stop Device',
          enabled: true,
          trigger: { type: 'manual', event: 'stop' },
          actions: [{ type: 'stop', device: 'laser-1' }],
        },
      ];

      await eventEngine.triggerManualEvent('stop');

      expect(mockDeviceManager.stop).toHaveBeenCalledWith('laser-1');
    });

    it('should execute load_file action', async () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'load-file',
          name: 'Load File',
          enabled: true,
          trigger: { type: 'manual', event: 'load' },
          actions: [{ type: 'load_file', device: 'cnc-main', file: '/path/to/file.nc' }],
        },
      ];

      await eventEngine.triggerManualEvent('load');

      expect(mockDeviceManager.loadFile).toHaveBeenCalledWith('cnc-main', '/path/to/file.nc');
    });

    it('should execute send_gcode action', async () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'send-gcode',
          name: 'Send G-Code',
          enabled: true,
          trigger: { type: 'manual', event: 'send_gcode' },
          actions: [{ type: 'send_gcode', device: 'laser-1', gcode: 'G0 X0 Y0' }],
        },
      ];

      await eventEngine.triggerManualEvent('send_gcode');

      expect(mockDeviceManager.sendGCode).toHaveBeenCalledWith('laser-1', 'G0 X0 Y0');
    });

    it('should execute notify action', async () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'notify',
          name: 'Notify',
          enabled: true,
          trigger: { type: 'manual', event: 'notify' },
          actions: [{ type: 'notify', message: 'Hello World', channel: 'ui', severity: 'info' }],
        },
      ];

      await eventEngine.triggerManualEvent('notify');

      expect(mockStateManager.broadcastToAll).toHaveBeenCalledWith('notification', expect.objectContaining({
        message: 'Hello World',
        channel: 'ui',
        severity: 'info',
      }));
    });
  });

  describe('Template Resolution', () => {
    it('should resolve trigger device in template', async () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'template-rule',
          name: 'Template Rule',
          enabled: true,
          trigger: { type: 'job_complete' },
          actions: [{ type: 'notify', message: 'Device {{trigger.device}} completed!' }],
        },
      ];

      await eventEngine.processEvent('job_complete', 'cnc-main', { file: 'test.nc' });

      expect(mockStateManager.broadcastToAll).toHaveBeenCalledWith('notification', expect.objectContaining({
        message: 'Device cnc-main completed!',
      }));
    });
  });

  describe('Position Trigger', () => {
    it('should match position trigger with condition', async () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'position-rule',
          name: 'Position Rule',
          enabled: true,
          trigger: { 
            type: 'position', 
            device: 'cnc-main',
            axis: 'Z',
            condition: '<',
            value: 10
          },
          actions: [{ type: 'notify', message: 'Z axis below 10!' }],
        },
      ];

      await eventEngine.processEvent('position', 'cnc-main', { 
        position: { x: 100, y: 50, z: 5 } 
      });

      expect(mockStateManager.broadcastToAll).toHaveBeenCalledWith('notification', expect.objectContaining({
        message: 'Z axis below 10!',
      }));
    });

    it('should not match position trigger when condition not met', async () => {
      const engine = eventEngine as unknown as { rules: Rule[] };
      engine.rules = [
        {
          id: 'position-rule',
          name: 'Position Rule',
          enabled: true,
          trigger: { 
            type: 'position', 
            device: 'cnc-main',
            axis: 'Z',
            condition: '<',
            value: 10
          },
          actions: [{ type: 'notify', message: 'Z axis below 10!' }],
        },
      ];

      await eventEngine.processEvent('position', 'cnc-main', { 
        position: { x: 100, y: 50, z: 15 } 
      });

      expect(mockStateManager.broadcastToAll).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup timers and flags', () => {
      const engine = eventEngine as unknown as { 
        flags: Map<string, unknown>;
        timers: Map<string, NodeJS.Timeout>;
      };

      // Add some flags and timers
      engine.flags.set('test-flag', true);
      engine.timers.set('test-timer', setTimeout(() => {}, 10000));

      eventEngine.cleanup();

      expect(engine.flags.size).toBe(0);
      expect(engine.timers.size).toBe(0);
    });
  });
});
