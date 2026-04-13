/**
 * WebSocket Server - Socket.IO event handlers
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { DeviceManager } from '../devices/DeviceManager.js';
import { StateManager } from '../state/StateManager.js';

const VALID_AXES = new Set(['X', 'Y', 'Z']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function setupWebSocket(
  io: SocketIOServer,
  deviceManager: DeviceManager,
  stateManager: StateManager
): void {
  io.on('connection', (socket: Socket) => {
    // Kliens regisztráció
    stateManager.registerClient(socket);
    
    // Kezdeti adatok küldése (with error handling)
    sendInitialData(socket, deviceManager).catch((err) => {
      console.error('Error sending initial data:', err);
    });
    
    // =========================================
    // SUBSCRIPTION EVENTS
    // =========================================
    
    socket.on('subscribe:device', (deviceId: string) => {
      stateManager.subscribeToDevice(socket.id, deviceId);
      socket.emit('subscribed', { deviceId });
    });
    
    socket.on('unsubscribe:device', (deviceId: string) => {
      stateManager.unsubscribeFromDevice(socket.id, deviceId);
      socket.emit('unsubscribed', { deviceId });
    });
    
    // =========================================
    // DEVICE COMMANDS
    // =========================================
    
    socket.on('device:command', async (data: {
      deviceId: string;
      command: string;
      params?: Record<string, unknown>;
    }) => {
      const { deviceId, command, params } = data;
      let success = false;
      
      try {
        switch (command) {
          case 'run':
            success = await deviceManager.run(deviceId, (params?.fromLine as number) || 0);
            break;
          case 'pause':
            success = await deviceManager.pause(deviceId);
            break;
          case 'resume':
            success = await deviceManager.resume(deviceId);
            break;
          case 'stop':
            success = await deviceManager.stop(deviceId);
            break;
          case 'home':
            success = await deviceManager.home(deviceId, params?.axes as string[], params?.feedRate as number | undefined);
            break;
          case 'reset':
            success = await deviceManager.reset(deviceId);
            break;
          case 'connect':
            success = await deviceManager.connectDevice(deviceId);
            if (success) {
              const capabilities = await deviceManager.getDeviceCapabilities(deviceId);
              if (capabilities) {
                stateManager.broadcastCapabilities(deviceId, capabilities);
              }
              const control = await deviceManager.getDeviceControlState(deviceId);
              if (control) {
                stateManager.broadcastControlState(deviceId, control);
              }
            }
            break;
          case 'disconnect':
            success = await deviceManager.disconnectDevice(deviceId);
            break;
          case 'take_control':
            {
              const requestedOwner = (params?.owner as 'host' | 'panel') || 'host';
              const result = await deviceManager.requestControl(
                deviceId,
                requestedOwner,
                'host_takeback'
              );
              success = result?.granted === true;
              if (result?.state) {
                if (success) {
                  stateManager.broadcastControlState(deviceId, result.state);
                } else {
                  stateManager.broadcastControlDenied(
                    deviceId,
                    result.reason || 'denied',
                    result.state
                  );
                }
              }
            }
            break;
          case 'release_control':
            {
              const result = await deviceManager.releaseControl(deviceId, 'host_release');
              success = result?.granted === true;
              if (result?.state) {
                stateManager.broadcastControlState(deviceId, result.state);
              }
            }
            break;
        }
      } catch (error) {
        console.error(`WebSocket device:command error (${command}):`, error);
        success = false;
      }
      
      socket.emit('device:command:result', {
        deviceId,
        command,
        success,
      });
    });
    
    // Jog
    socket.on('device:jog', async (data: {
      deviceId: string;
      axis: string;
      distance: number;
      feedRate: number;
      mode?: string;
    }) => {
      const { deviceId, axis, distance, feedRate, mode } = data;
      let success = false;
      
      try {
        success = await deviceManager.jog(deviceId, axis, distance, feedRate, mode);
      } catch (error) {
        console.error('WebSocket device:jog error:', error);
      }
      
      // Log jog command to MDI console
      const isContinuous = Math.abs(distance) > 1000;
      const jogCommand = isContinuous 
        ? `[JOG] ${axis}${distance > 0 ? '+' : '-'} F${feedRate} (folyamatos)`
        : `[JOG] G91 G0 ${axis}${distance} F${feedRate}`;
      
      socket.emit('device:mdi:result', {
        deviceId,
        gcode: jogCommand,
        response: success ? 'ok' : 'error',
      });
      
      socket.emit('device:jog:result', {
        deviceId,
        success,
      });
    });

    socket.on('device:jog:start', async (data: {
      deviceId: string;
      axis: string;
      direction: number;
      feedRate: number;
      mode?: string;
      heartbeatTimeout?: number;
      tickMs?: number;
    }) => {
      const {
        deviceId,
        axis,
        direction,
        feedRate,
        mode,
        heartbeatTimeout = 0.5,
        tickMs = 40,
      } = data;
      let success = false;
      let errorMessage: string | undefined;

      if (!isNonEmptyString(deviceId)) {
        errorMessage = 'Érvénytelen deviceId';
      } else if (!isNonEmptyString(axis) || !VALID_AXES.has(axis.toUpperCase())) {
        errorMessage = 'Érvénytelen axis (X/Y/Z)';
      } else if (!isFiniteNumber(direction) || direction === 0) {
        errorMessage = 'Érvénytelen direction (nem lehet 0)';
      } else if (!isFiniteNumber(feedRate) || feedRate <= 0) {
        errorMessage = 'Érvénytelen feedRate';
      } else if (!isFiniteNumber(heartbeatTimeout) || heartbeatTimeout <= 0) {
        errorMessage = 'Érvénytelen heartbeatTimeout';
      } else if (!isFiniteNumber(tickMs) || tickMs <= 0) {
        errorMessage = 'Érvénytelen tickMs';
      }

      if (errorMessage) {
        socket.emit('device:jog:start:result', {
          deviceId,
          success: false,
          error: errorMessage,
        });
        return;
      }

      try {
        success = await deviceManager.jogSessionStart(
          deviceId,
          axis.toUpperCase(),
          direction,
          feedRate,
          mode,
          heartbeatTimeout,
          tickMs,
        );
      } catch (error) {
        console.error('WebSocket device:jog:start error:', error);
        errorMessage = error instanceof Error ? error.message : 'Jog start hiba';
      }

      socket.emit('device:jog:start:result', {
        deviceId,
        success,
        error: success ? undefined : errorMessage,
      });
    });

    socket.on('device:jog:beat', async (data: {
      deviceId: string;
      axis?: string;
      direction?: number;
      feedRate?: number;
      mode?: string;
    }) => {
      const { deviceId, axis, direction, feedRate, mode } = data;
      let success = false;
      let errorMessage: string | undefined;

      if (!isNonEmptyString(deviceId)) {
        errorMessage = 'Érvénytelen deviceId';
      } else if (axis !== undefined && (!isNonEmptyString(axis) || !VALID_AXES.has(axis.toUpperCase()))) {
        errorMessage = 'Érvénytelen axis (X/Y/Z)';
      } else if (direction !== undefined && (!isFiniteNumber(direction) || direction === 0)) {
        errorMessage = 'Érvénytelen direction (nem lehet 0)';
      } else if (feedRate !== undefined && (!isFiniteNumber(feedRate) || feedRate <= 0)) {
        errorMessage = 'Érvénytelen feedRate';
      }

      if (errorMessage) {
        socket.emit('device:jog:beat:result', {
          deviceId,
          success: false,
          error: errorMessage,
        });
        return;
      }

      try {
        success = await deviceManager.jogSessionBeat(
          deviceId,
          axis?.toUpperCase(),
          direction,
          feedRate,
          mode
        );
      } catch (error) {
        console.error('WebSocket device:jog:beat error:', error);
        errorMessage = error instanceof Error ? error.message : 'Jog beat hiba';
      }

      socket.emit('device:jog:beat:result', {
        deviceId,
        success,
        error: success ? undefined : errorMessage,
      });
    });
    
    socket.on('device:jog:stop', async (data: { deviceId: string; hardStop?: boolean }) => {
      if (!isNonEmptyString(data.deviceId)) {
        socket.emit('device:jog:stop:result', {
          deviceId: data.deviceId,
          success: false,
          error: 'Érvénytelen deviceId',
        });
        return;
      }

      let success = false;
      let errorMessage: string | undefined;
      
      try {
        success = await deviceManager.jogSessionStop(data.deviceId, data.hardStop === true);
        if (!success) {
          success = await deviceManager.jogStop(data.deviceId);
        }
      } catch (error) {
        console.error('WebSocket device:jog:stop error:', error);
        errorMessage = error instanceof Error ? error.message : 'Jog stop hiba';
      }
      
      // Log jog stop to MDI console
      socket.emit('device:mdi:result', {
        deviceId: data.deviceId,
        gcode: '[JOG STOP]',
        response: success ? 'ok' : 'error',
      });
      
      socket.emit('device:jog:stop:result', {
        deviceId: data.deviceId,
        success,
        error: success ? undefined : errorMessage,
      });
    });
    
    // MDI (G-code)
    socket.on('device:mdi', async (data: {
      deviceId: string;
      gcode: string;
    }) => {
      const { deviceId, gcode } = data;
      let response = 'error';
      
      try {
        response = await deviceManager.sendGCode(deviceId, gcode);
      } catch (error) {
        console.error('WebSocket device:mdi error:', error);
      }
      
      socket.emit('device:mdi:result', {
        deviceId,
        gcode,
        response,
      });
    });
    
    // Override
    socket.on('device:override', async (data: {
      deviceId: string;
      type: 'feed' | 'spindle';
      percent: number;
    }) => {
      const { deviceId, type, percent } = data;
      let success = false;
      
      try {
        if (type === 'feed') {
          success = await deviceManager.setFeedOverride(deviceId, percent);
        } else if (type === 'spindle') {
          success = await deviceManager.setSpindleOverride(deviceId, percent);
        }
      } catch (error) {
        console.error('WebSocket device:override error:', error);
      }
      
      socket.emit('device:override:result', {
        deviceId,
        type,
        percent,
        success,
      });
    });
    
    // =========================================
    // STATUS REQUESTS
    // =========================================
    
    socket.on('device:get:status', async (data: { deviceId: string }) => {
      try {
        const status = await deviceManager.getDeviceStatus(data.deviceId);
        socket.emit('device:status', {
          deviceId: data.deviceId,
          status,
        });
      } catch (error) {
        console.error('WebSocket device:get:status error:', error);
        socket.emit('device:status', {
          deviceId: data.deviceId,
          status: null,
        });
      }
    });
    
    socket.on('devices:get:all', () => {
      const devices = deviceManager.getDevices();
      socket.emit('devices:list', { devices });
    });
    
    // =========================================
    // PING/PONG
    // =========================================
    
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });
    
    // =========================================
    // DISCONNECT
    // =========================================
    
    socket.on('disconnect', () => {
      stateManager.unregisterClient(socket.id);
    });
  });
}

async function sendInitialData(
  socket: Socket,
  deviceManager: DeviceManager
): Promise<void> {
  // Eszközök listája
  const devices = deviceManager.getDevices();
  socket.emit('devices:list', { devices });
  
  // Minden eszköz státusza
  for (const device of devices) {
    const status = await deviceManager.getDeviceStatus(device.id);
    if (status) {
      socket.emit('device:status', {
        deviceId: device.id,
        status,
      });
    }
  }
}
