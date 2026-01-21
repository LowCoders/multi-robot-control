/**
 * State Manager - Állapot kezelés és broadcast
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { DeviceStatus } from '../devices/DeviceManager.js';

export interface ClientInfo {
  id: string;
  socket: Socket;
  subscribedDevices: Set<string>;
}

interface PositionUpdate {
  position: { x: number; y: number; z: number; a?: number; b?: number; c?: number };
  timestamp: number;
}

export class StateManager {
  private io: SocketIOServer;
  private clients: Map<string, ClientInfo> = new Map();
  
  // Position throttling (50ms = 20 updates/sec max)
  private static readonly POSITION_THROTTLE_MS = 50;
  private pendingPositions: Map<string, PositionUpdate> = new Map();
  private positionTimers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(io: SocketIOServer) {
    this.io = io;
  }
  
  // =========================================
  // CLIENT MANAGEMENT
  // =========================================
  
  registerClient(socket: Socket): void {
    const clientInfo: ClientInfo = {
      id: socket.id,
      socket,
      subscribedDevices: new Set(),
    };
    
    this.clients.set(socket.id, clientInfo);
    console.log(`Kliens csatlakozva: ${socket.id}`);
  }
  
  unregisterClient(socketId: string): void {
    this.clients.delete(socketId);
    console.log(`Kliens lecsatlakozva: ${socketId}`);
  }
  
  subscribeToDevice(socketId: string, deviceId: string): void {
    const client = this.clients.get(socketId);
    if (client) {
      client.subscribedDevices.add(deviceId);
      client.socket.join(`device:${deviceId}`);
    }
  }
  
  unsubscribeFromDevice(socketId: string, deviceId: string): void {
    const client = this.clients.get(socketId);
    if (client) {
      client.subscribedDevices.delete(deviceId);
      client.socket.leave(`device:${deviceId}`);
    }
  }
  
  // =========================================
  // BROADCAST METHODS
  // =========================================
  
  broadcastToAll(event: string, data: unknown): void {
    this.io.emit(event, data);
  }
  
  broadcastToDevice(deviceId: string, event: string, data: unknown): void {
    this.io.to(`device:${deviceId}`).emit(event, data);
  }
  
  broadcastDeviceStatus(deviceId: string, status: DeviceStatus): void {
    this.broadcastToAll('device:status', {
      deviceId,
      status,
      timestamp: Date.now(),
    });
  }
  
  broadcastStateChange(deviceId: string, oldState: string, newState: string): void {
    this.broadcastToAll('device:state_change', {
      deviceId,
      oldState,
      newState,
      timestamp: Date.now(),
    });
  }
  
  broadcastPosition(
    deviceId: string,
    position: { x: number; y: number; z: number; a?: number; b?: number; c?: number }
  ): void {
    // Throttle position updates to prevent network congestion
    // Store the latest position update
    this.pendingPositions.set(deviceId, {
      position,
      timestamp: Date.now(),
    });
    
    // If no timer exists for this device, create one
    if (!this.positionTimers.has(deviceId)) {
      const timer = setTimeout(() => {
        this.flushPositionUpdate(deviceId);
      }, StateManager.POSITION_THROTTLE_MS);
      
      this.positionTimers.set(deviceId, timer);
    }
  }
  
  private flushPositionUpdate(deviceId: string): void {
    // Clean up timer
    this.positionTimers.delete(deviceId);
    
    // Get and clear pending position
    const pending = this.pendingPositions.get(deviceId);
    if (pending) {
      this.pendingPositions.delete(deviceId);
      
      // Pozíció frissítés - MINDEN kliensnek (nem csak feliratkozottaknak)
      this.broadcastToAll('device:position', {
        deviceId,
        position: pending.position,
        timestamp: pending.timestamp,
      });
    }
  }
  
  /**
   * Flush all pending position updates immediately (for cleanup)
   */
  flushAllPositions(): void {
    for (const deviceId of this.pendingPositions.keys()) {
      const timer = this.positionTimers.get(deviceId);
      if (timer) {
        clearTimeout(timer);
      }
      this.flushPositionUpdate(deviceId);
    }
  }
  
  broadcastError(deviceId: string, message: string): void {
    this.broadcastToAll('device:error', {
      deviceId,
      message,
      severity: 'error',
      timestamp: Date.now(),
    });
  }
  
  broadcastJobComplete(deviceId: string, file: string): void {
    this.broadcastToAll('job:complete', {
      deviceId,
      file,
      timestamp: Date.now(),
    });
  }
  
  broadcastJobProgress(
    deviceId: string,
    progress: number,
    currentLine: number,
    totalLines: number
  ): void {
    this.broadcastToDevice(deviceId, 'job:progress', {
      deviceId,
      progress,
      currentLine,
      totalLines,
      timestamp: Date.now(),
    });
  }
  
  broadcastAutomationTriggered(
    ruleId: string,
    ruleName: string,
    actions: string[]
  ): void {
    this.broadcastToAll('automation:triggered', {
      ruleId,
      ruleName,
      actions,
      timestamp: Date.now(),
    });
  }
  
  // =========================================
  // STATS
  // =========================================
  
  getClientCount(): number {
    return this.clients.size;
  }
  
  getSubscribedClients(deviceId: string): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.subscribedDevices.has(deviceId)) {
        count++;
      }
    }
    return count;
  }
  
  // =========================================
  // CLEANUP
  // =========================================
  
  /**
   * Cleanup method for graceful shutdown
   * Flushes all pending updates and clears timers
   */
  cleanup(): void {
    console.log('StateManager cleanup...');
    
    // Clear all pending position timers
    for (const timer of this.positionTimers.values()) {
      clearTimeout(timer);
    }
    this.positionTimers.clear();
    this.pendingPositions.clear();
    
    // Clear clients
    this.clients.clear();
  }
}
