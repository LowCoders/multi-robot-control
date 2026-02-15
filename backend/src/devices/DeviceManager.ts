/**
 * Device Manager - Eszközök kezelése a Python bridge-en keresztül
 */

import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { DeviceConfigEntry } from '../config/index.js';
import { StateManager } from '../state/StateManager.js';

export interface DeviceStatus {
  state: string;
  position: {
    x: number;
    y: number;
    z: number;
    a?: number;
    b?: number;
    c?: number;
  };
  work_position: {
    x: number;
    y: number;
    z: number;
  };
  feed_rate: number;
  spindle_speed: number;
  laser_power: number;
  progress: number;
  current_line: number;
  total_lines: number;
  current_file: string | null;
  error_message: string | null;
  feed_override: number;
  spindle_override: number;
  // Robot arm specific
  gripper_state?: 'open' | 'closed' | 'unknown';
  sucker_state?: boolean;
  // Endstop states per axis (true = triggered)
  endstop_states?: Record<string, boolean>;
  // Endstop blocked directions: {'Y': 'positive', ...}
  endstop_blocked?: Record<string, string>;
}

export interface AxisLimit {
  min: number;
  max: number;
}

export interface DeviceCapabilities {
  axes: string[];
  has_spindle: boolean;
  has_laser: boolean;
  has_coolant: boolean;
  has_probe: boolean;
  has_tool_changer: boolean;
  has_gripper: boolean;
  has_sucker: boolean;
  max_feed_rate: number;
  max_spindle_speed: number;
  max_laser_power: number;
  work_envelope: {
    x: number;
    y: number;
    z: number;
  };
  // Per-axis software limits
  axis_limits?: Record<string, AxisLimit>;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  driver: string;
  connected: boolean;
  state: string;
  simulated?: boolean;
  connectionInfo?: string;
  lastError?: string | null;
  status?: DeviceStatus;
  capabilities?: DeviceCapabilities;
}

export class DeviceManager {
  private bridgeUrl: string;
  private http: AxiosInstance;
  private bridgeWs: WebSocket | null = null;
  private devices: Map<string, Device> = new Map();
  private stateManager: StateManager;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private statusPollTimer: NodeJS.Timeout | null = null;
  
  // Poll status every 500ms for active jobs
  private static readonly STATUS_POLL_INTERVAL = 500;
  
  constructor(bridgeUrl: string, stateManager: StateManager) {
    this.bridgeUrl = bridgeUrl;
    this.stateManager = stateManager;
    
    this.http = axios.create({
      baseURL: bridgeUrl,
      timeout: 10000,
    });
  }
  
  async initialize(deviceConfigs: DeviceConfigEntry[]): Promise<void> {
    console.log('DeviceManager inicializálás...');
    
    // Eszközök inicializálása a konfigból
    for (const config of deviceConfigs) {
      if (config.enabled !== false) {
        this.devices.set(config.id, {
          id: config.id,
          name: config.name,
          type: config.type,
          driver: config.driver,
          connected: false,
          state: 'disconnected',
        });
      }
    }
    
    // Bridge WebSocket csatlakozás
    await this.connectToBridge();
    
    // Eszközök lekérdezése a bridge-től
    await this.refreshDevices();
    
    // Start periodic status polling
    this.startStatusPolling();
    
    console.log(`DeviceManager inicializálva, ${this.devices.size} eszköz`);
  }
  
  /**
   * Start periodic status polling for all devices
   * This ensures status updates (current_line, current_file, etc.) are broadcast
   */
  private startStatusPolling(): void {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
    }
    
    this.statusPollTimer = setInterval(async () => {
      await this.pollAllDeviceStatus();
    }, DeviceManager.STATUS_POLL_INTERVAL);
    
    console.log('Status polling started');
  }
  
  private async pollAllDeviceStatus(): Promise<void> {
    for (const device of this.devices.values()) {
      // Only poll status for connected devices
      if (device.connected) {
        try {
          const status = await this.getDeviceStatus(device.id);
          if (status) {
            // Status is already broadcast in updateDeviceStatus
          }
        } catch (error) {
          // Ignore polling errors, device might be busy
        }
      }
    }
  }
  
  private async connectToBridge(): Promise<void> {
    const wsUrl = this.bridgeUrl.replace('http', 'ws') + '/ws';
    
    // Close existing connection before creating new one
    this.closeBridgeWs();
    
    return new Promise((resolve) => {
      try {
        this.bridgeWs = new WebSocket(wsUrl);
        
        this.bridgeWs.on('open', () => {
          console.log('Bridge WebSocket csatlakozva');
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          resolve();
        });
        
        this.bridgeWs.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleBridgeMessage(message);
          } catch (e) {
            console.error('Bridge message parse error:', e);
          }
        });
        
        this.bridgeWs.on('close', () => {
          console.log('Bridge WebSocket lecsatlakozva');
          this.scheduleReconnect();
        });
        
        this.bridgeWs.on('error', (error) => {
          console.error('Bridge WebSocket hiba:', error.message);
          resolve(); // Ne blokkoljuk az inicializálást
        });
        
      } catch (error) {
        console.error('Bridge WebSocket csatlakozási hiba:', error);
        this.scheduleReconnect();
        resolve();
      }
    });
  }
  
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    // Clean up old WebSocket before reconnecting
    this.closeBridgeWs();
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log('Bridge újracsatlakozás...');
      await this.connectToBridge();
    }, 5000);
  }
  
  private closeBridgeWs(): void {
    if (this.bridgeWs) {
      try {
        // Remove all listeners to prevent memory leaks
        this.bridgeWs.removeAllListeners();
        if (this.bridgeWs.readyState === WebSocket.OPEN || 
            this.bridgeWs.readyState === WebSocket.CONNECTING) {
          this.bridgeWs.close();
        }
      } catch (e) {
        // Ignore close errors
      }
      this.bridgeWs = null;
    }
  }
  
  /**
   * Cleanup method for graceful shutdown
   */
  cleanup(): void {
    console.log('DeviceManager cleanup...');
    
    // Cancel reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Stop status polling
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
    
    // Close WebSocket connection
    this.closeBridgeWs();
  }
  
  private handleBridgeMessage(message: {
    type: string;
    device_id?: string;
    [key: string]: unknown;
  }): void {
    const { type, device_id } = message;
    
    switch (type) {
      case 'status':
        if (device_id) {
          this.updateDeviceStatus(device_id, message.status as DeviceStatus);
        }
        break;
        
      case 'state_change':
        if (device_id) {
          this.handleStateChange(
            device_id,
            message.old_state as string,
            message.new_state as string
          );
        }
        break;
        
      case 'position':
        if (device_id) {
          this.handlePositionUpdate(device_id, message.position as DeviceStatus['position']);
        }
        break;
        
      case 'error':
        if (device_id) {
          this.handleError(device_id, message.message as string);
        }
        break;
        
      case 'job_complete':
        if (device_id) {
          this.handleJobComplete(device_id, message.file as string);
        }
        break;
        
      case 'job_progress':
        if (device_id) {
          this.handleJobProgress(
            device_id,
            message.progress as number,
            message.current_line as number,
            message.total_lines as number
          );
        }
        break;
    }
  }
  
  private updateDeviceStatus(deviceId: string, status: DeviceStatus): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = status;
      device.state = status.state;
      device.connected = status.state !== 'disconnected';
      
      // Broadcast to clients
      this.stateManager.broadcastDeviceStatus(deviceId, status);
    }
  }
  
  private handleStateChange(deviceId: string, oldState: string, newState: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.state = newState;
      device.connected = newState !== 'disconnected';
      
      this.stateManager.broadcastStateChange(deviceId, oldState, newState);
    }
  }
  
  private handlePositionUpdate(deviceId: string, position: DeviceStatus['position']): void {
    const device = this.devices.get(deviceId);
    if (device && device.status) {
      device.status.position = position;
    }
    
    this.stateManager.broadcastPosition(deviceId, position);
  }
  
  private handleError(deviceId: string, message: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.state = 'alarm';
      if (device.status) {
        device.status.error_message = message;
      }
    }
    
    this.stateManager.broadcastError(deviceId, message);
  }
  
  private handleJobComplete(deviceId: string, file: string): void {
    this.stateManager.broadcastJobComplete(deviceId, file);
  }
  
  private handleJobProgress(
    deviceId: string,
    progress: number,
    currentLine: number,
    totalLines: number
  ): void {
    const device = this.devices.get(deviceId);
    if (device && device.status) {
      device.status.progress = progress;
      device.status.current_line = currentLine;
      device.status.total_lines = totalLines;
    }
    
    this.stateManager.broadcastJobProgress(deviceId, progress, currentLine, totalLines);
  }
  
  // =========================================
  // PUBLIC API
  // =========================================
  
  async refreshDevices(): Promise<void> {
    try {
      const response = await this.http.get('/devices');
      const bridgeDevices = response.data.devices as Array<{
        id: string;
        name: string;
        type: string;
        connected: boolean;
        state: string;
        simulated?: boolean;
        connectionInfo?: string;
        lastError?: string | null;
      }>;
      
      for (const bd of bridgeDevices) {
        const device = this.devices.get(bd.id);
        if (device) {
          device.connected = bd.connected;
          device.state = bd.state;
          device.simulated = bd.simulated;
          device.connectionInfo = bd.connectionInfo;
          device.lastError = bd.lastError;
        }
      }
    } catch (error) {
      console.error('Eszközök frissítési hiba:', error);
    }
  }
  
  getDevices(): Device[] {
    return Array.from(this.devices.values());
  }
  
  getDevice(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }
  
  async addDevice(config: {
    id: string;
    name: string;
    type: string;
    driver: string;
    enabled: boolean;
    config: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      // Add device via bridge
      const response = await this.http.post('/devices', config);
      
      if (response.data.success) {
        // Fetch updated device list
        await this.refreshDevices();
        
        // Also add to local devices map
        const newDevice: Device = {
          id: config.id,
          name: config.name,
          type: config.type,
          driver: config.driver,
          connected: false,
          state: 'disconnected',
          status: undefined,
        };
        this.devices.set(config.id, newDevice);
        
        return true;
      }
      return false;
    } catch (error) {
      console.error('Eszköz hozzáadási hiba:', error);
      return false;
    }
  }
  
  async getDeviceStatus(deviceId: string): Promise<DeviceStatus | null> {
    try {
      const response = await this.http.get(`/devices/${deviceId}/status`);
      const status = response.data as DeviceStatus;
      this.updateDeviceStatus(deviceId, status);
      return status;
    } catch (error) {
      console.error(`Státusz lekérdezési hiba (${deviceId}):`, error);
      return null;
    }
  }
  
  async getDeviceCapabilities(deviceId: string): Promise<DeviceCapabilities | null> {
    try {
      const response = await this.http.get(`/devices/${deviceId}/capabilities`);
      const capabilities = response.data as DeviceCapabilities;
      
      const device = this.devices.get(deviceId);
      if (device) {
        device.capabilities = capabilities;
      }
      
      return capabilities;
    } catch (error) {
      console.error(`Capabilities lekérdezési hiba (${deviceId}):`, error);
      return null;
    }
  }
  
  async connectDevice(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/connect`);
      return response.data.success;
    } catch (error) {
      console.error(`Csatlakozási hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async disconnectDevice(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/disconnect`);
      return response.data.success;
    } catch (error) {
      console.error(`Lecsatlakozási hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async home(deviceId: string, axes?: string[]): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/home`, { axes });
      return response.data.success;
    } catch (error) {
      console.error(`Homing hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async jog(
    deviceId: string,
    axis: string,
    distance: number,
    feedRate: number
  ): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/jog`, {
        axis,
        distance,
        feed_rate: feedRate,
      });
      return response.data.success;
    } catch (error) {
      console.error(`Jog hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async jogStop(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/jog/stop`);
      return response.data.success;
    } catch (error) {
      console.error(`Jog stop hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async sendGCode(deviceId: string, gcode: string): Promise<string> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/gcode`, { gcode });
      return response.data.response;
    } catch (error) {
      console.error(`G-code küldési hiba (${deviceId}):`, error);
      return 'error';
    }
  }
  
  async loadFile(deviceId: string, filepath: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/load`, { filepath });
      return response.data.success;
    } catch (error) {
      console.error(`Fájl betöltési hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async run(deviceId: string, fromLine: number = 0): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/run`, null, {
        params: { from_line: fromLine },
      });
      return response.data.success;
    } catch (error) {
      console.error(`Futtatási hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async pause(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/pause`);
      return response.data.success;
    } catch (error) {
      console.error(`Pause hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async resume(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/resume`);
      return response.data.success;
    } catch (error) {
      console.error(`Resume hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async stop(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/stop`);
      return response.data.success;
    } catch (error) {
      console.error(`Stop hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async reset(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/reset`);
      return response.data.success;
    } catch (error) {
      console.error(`Reset hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async setFeedOverride(deviceId: string, percent: number): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/feed-override`, {
        percent,
      });
      return response.data.success;
    } catch (error) {
      console.error(`Feed override hiba (${deviceId}):`, error);
      return false;
    }
  }
  
  async setSpindleOverride(deviceId: string, percent: number): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/spindle-override`, {
        percent,
      });
      return response.data.success;
    } catch (error) {
      console.error(`Spindle override hiba (${deviceId}):`, error);
      return false;
    }
  }

  // =========================================
  // ROBOT ARM SPECIFIKUS MŰVELETEK
  // =========================================

  async gripperOn(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/gripper/on`);
      return response.data.success;
    } catch (error) {
      console.error(`Gripper ON hiba (${deviceId}):`, error);
      return false;
    }
  }

  async gripperOff(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/gripper/off`);
      return response.data.success;
    } catch (error) {
      console.error(`Gripper OFF hiba (${deviceId}):`, error);
      return false;
    }
  }

  async suckerOn(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/sucker/on`);
      return response.data.success;
    } catch (error) {
      console.error(`Sucker ON hiba (${deviceId}):`, error);
      return false;
    }
  }

  async suckerOff(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/sucker/off`);
      return response.data.success;
    } catch (error) {
      console.error(`Sucker OFF hiba (${deviceId}):`, error);
      return false;
    }
  }

  async robotEnable(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/enable`);
      return response.data.success;
    } catch (error) {
      console.error(`Robot enable hiba (${deviceId}):`, error);
      return false;
    }
  }

  async robotDisable(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/disable`);
      return response.data.success;
    } catch (error) {
      console.error(`Robot disable hiba (${deviceId}):`, error);
      return false;
    }
  }

  async robotCalibrate(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/calibrate`);
      return response.data.success;
    } catch (error) {
      console.error(`Robot calibrate hiba (${deviceId}):`, error);
      return false;
    }
  }

  async teachRecord(deviceId: string): Promise<any> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/teach/record`);
      return response.data;
    } catch (error) {
      console.error(`Teach record hiba (${deviceId}):`, error);
      return null;
    }
  }

  async teachPlay(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/teach/play`);
      return response.data.success;
    } catch (error) {
      console.error(`Teach play hiba (${deviceId}):`, error);
      return false;
    }
  }

  async teachClear(deviceId: string): Promise<boolean> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/teach/clear`);
      return response.data.success;
    } catch (error) {
      console.error(`Teach clear hiba (${deviceId}):`, error);
      return false;
    }
  }

  async teachGetPositions(deviceId: string): Promise<any[]> {
    try {
      const response = await this.http.get(`/devices/${deviceId}/teach/positions`);
      return response.data.positions || [];
    } catch (error) {
      console.error(`Teach positions hiba (${deviceId}):`, error);
      return [];
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async runDiagnostics(deviceId: string, moveTest: boolean = false): Promise<any> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/diagnostics`, null, {
        params: { move_test: moveTest },
        timeout: 60000, // 60s - a diagnosztika sokáig tarthat
      });
      return response.data;
    } catch (error) {
      console.error(`Diagnosztika hiba (${deviceId}):`, error);
      throw error;
    }
  }

  // =========================================
  // MOTOR HANGOLÁS TESZTEK
  // =========================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async runFirmwareProbe(deviceId: string): Promise<any> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/firmware-probe`, null, {
        timeout: 120000, // 120s - sok parancsot próbál
      });
      return response.data;
    } catch (error) {
      console.error(`Firmware probe hiba (${deviceId}):`, error);
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async runEndstopTest(
    deviceId: string,
    stepSize: number = 5.0,
    speed: number = 15,
    maxAngle: number = 200.0,
  ): Promise<any> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/endstop-test`, null, {
        params: { step_size: stepSize, speed, max_angle: maxAngle },
        timeout: 300000, // 5 perc - lassú mozgás
      });
      return response.data;
    } catch (error) {
      console.error(`Endstop test hiba (${deviceId}):`, error);
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async runMotionTest(deviceId: string, testAngle: number = 30.0): Promise<any> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/motion-test`, null, {
        params: { test_angle: testAngle },
        timeout: 300000, // 5 perc - sok sebesség-teszt
      });
      return response.data;
    } catch (error) {
      console.error(`Motion test hiba (${deviceId}):`, error);
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getTestProgress(deviceId: string, after: number = 0): Promise<any> {
    try {
      const response = await this.http.get(`/devices/${deviceId}/test-progress`, {
        params: { after },
        timeout: 5000,
      });
      return response.data;
    } catch (error) {
      // Silently return empty if bridge unavailable
      return { entries: [], total: 0, running: false };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async cancelTest(deviceId: string): Promise<any> {
    try {
      const response = await this.http.post(`/devices/${deviceId}/cancel-test`, null, {
        timeout: 5000,
      });
      return response.data;
    } catch (error) {
      console.error(`Cancel test hiba (${deviceId}):`, error);
      throw error;
    }
  }
}
