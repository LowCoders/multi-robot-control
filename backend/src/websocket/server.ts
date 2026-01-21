/**
 * WebSocket Server - Socket.IO event handlers
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { DeviceManager } from '../devices/DeviceManager.js';
import { StateManager } from '../state/StateManager.js';

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
            success = await deviceManager.home(deviceId, params?.axes as string[]);
            break;
          case 'reset':
            success = await deviceManager.reset(deviceId);
            break;
          case 'connect':
            success = await deviceManager.connectDevice(deviceId);
            break;
          case 'disconnect':
            success = await deviceManager.disconnectDevice(deviceId);
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
    }) => {
      const { deviceId, axis, distance, feedRate } = data;
      let success = false;
      
      try {
        success = await deviceManager.jog(deviceId, axis, distance, feedRate);
      } catch (error) {
        console.error('WebSocket device:jog error:', error);
      }
      
      socket.emit('device:jog:result', {
        deviceId,
        success,
      });
    });
    
    socket.on('device:jog:stop', async (data: { deviceId: string }) => {
      let success = false;
      
      try {
        success = await deviceManager.jogStop(data.deviceId);
      } catch (error) {
        console.error('WebSocket device:jog:stop error:', error);
      }
      
      socket.emit('device:jog:stop:result', {
        deviceId: data.deviceId,
        success,
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
