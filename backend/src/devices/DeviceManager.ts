/**
 * Device Manager — vékony orchestrátor.
 *
 * Felelőssége: a Bridge HTTP API + Bridge WS + DevicePoller összekötése
 * és a `StateManager`-en keresztüli broadcast a frontend felé. A HTTP
 * hívások a `BridgeClient` típusos kliensbe, a WS pedig a `BridgeWsClient`-be
 * lett kiemelve. Ez a fájl így már csak orchestrálja a részeket és tartja a
 * `Map<string, Device>` cache-t.
 *
 * Backward compatible: a route-ok és tesztek minden korábbi public method-ra
 * (jog, run, gripperOn, …) ugyanúgy hivatkozhatnak.
 */

import { DeviceConfigEntry } from '../config/index.js';
import { StateManager } from '../state/StateManager.js';
import { createLogger } from '../utils/logger.js';
import { BridgeClient, JogDiagnostics } from './bridgeClient.js';
import {
  BridgeWsClient,
  BridgeMessage,
  StatusMsg,
  StateChangeMsg,
  PositionMsg,
  ErrorMsg,
  JobCompleteMsg,
  JobProgressMsg,
  ControlStateMsg,
  ControlDeniedMsg,
} from './BridgeWsClient.js';
import { DevicePoller } from './DevicePoller.js';

const log = createLogger('devices');

// =============================================================================
// PUBLIC TYPES
// =============================================================================

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
  gripper_state?: 'open' | 'closed' | 'unknown';
  sucker_state?: boolean;
  endstop_states?: Record<string, boolean>;
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
  supports_soft_limits?: boolean;
  supports_streaming_jog?: boolean;
  supports_hard_jog_stop?: boolean;
  supports_panel_controller?: boolean;
  max_feed_rate: number;
  max_spindle_speed: number;
  max_laser_power: number;
  work_envelope: {
    x: number;
    y: number;
    z: number;
  };
  axis_limits?: Record<string, AxisLimit>;
}

export interface DeviceControlState {
  owner: 'host' | 'panel' | 'none';
  lock_state: 'granted' | 'requested' | 'denied';
  reason?: string | null;
  version: number;
  last_changed_by?: string;
  requested_owner?: string | null;
  can_take_control?: boolean;
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
  control?: DeviceControlState;
}

// =============================================================================
// MANAGER
// =============================================================================

export class DeviceManager {
  private readonly devices = new Map<string, Device>();
  private readonly stateManager: StateManager;
  private readonly bridge: BridgeClient;
  private readonly ws: BridgeWsClient;
  private readonly poller: DevicePoller;

  constructor(bridgeUrl: string, stateManager: StateManager) {
    this.stateManager = stateManager;
    this.bridge = new BridgeClient(bridgeUrl);
    this.ws = new BridgeWsClient(bridgeUrl, (msg) => this.handleBridgeMessage(msg));
    this.poller = new DevicePoller({
      listDevices: () => Array.from(this.devices.values()),
      refreshStatus: async (id) => {
        await this.getDeviceStatus(id);
      },
      tryAutoClaim: async (id) => {
        await this.tryAutoClaimHost(id, 'poll');
      },
    });
  }

  async initialize(deviceConfigs: DeviceConfigEntry[]): Promise<void> {
    log.info('DeviceManager inicializálás...');

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

    await this.ws.connect();
    await this.refreshDevices();
    this.poller.start();

    log.info(`DeviceManager inicializálva, ${this.devices.size} eszköz`);
  }

  cleanup(): void {
    log.info('DeviceManager cleanup...');
    this.poller.stop();
    this.ws.cleanup();
  }

  // ---------------- AUTO-CLAIM POLICY ----------------

  private async tryAutoClaimHost(
    deviceId: string,
    trigger: 'startup' | 'connect' | 'poll'
  ): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device || !device.connected) return;
    if (!device.capabilities?.supports_panel_controller) return;
    if (!device.control) return;
    if (device.control.owner !== 'none') return;
    if (['running', 'paused', 'homing', 'probing', 'jog'].includes(device.state)) return;

    // Throttle csak a poll triggernél; startup/connect azonnal próbálkozik.
    if (trigger === 'poll') {
      if (!this.poller.shouldAutoClaim(deviceId)) return;
      this.poller.recordAutoClaim(deviceId);
    }

    const result = await this.requestControl(deviceId, 'host', `backend_autoclaim_${trigger}`);
    if (!result?.state) return;
    if (result.granted) {
      this.stateManager.broadcastControlState(deviceId, result.state as DeviceControlState);
      return;
    }
    this.stateManager.broadcastControlDenied(
      deviceId,
      result.reason || 'denied',
      result.state as DeviceControlState
    );
  }

  // ---------------- WS MESSAGE DISPATCH ----------------

  private handleBridgeMessage(message: BridgeMessage): void {
    switch (message.type) {
      case 'status':
        this.onStatus(message);
        break;
      case 'state_change':
        this.onStateChange(message);
        break;
      case 'position':
        this.onPosition(message);
        break;
      case 'error':
        this.onError(message);
        break;
      case 'job_complete':
        this.onJobComplete(message);
        break;
      case 'job_progress':
        this.onJobProgress(message);
        break;
      case 'control_state':
        this.onControlState(message);
        break;
      case 'control_denied':
        this.onControlDenied(message);
        break;
    }
  }

  private onStatus(msg: StatusMsg): void {
    if (!msg.device_id) return;
    this.updateDeviceStatus(msg.device_id, msg.status);
  }

  private onStateChange(msg: StateChangeMsg): void {
    if (!msg.device_id) return;
    const device = this.devices.get(msg.device_id);
    if (device) {
      device.state = msg.new_state;
      device.connected = msg.new_state !== 'disconnected';
    }
    this.stateManager.broadcastStateChange(msg.device_id, msg.old_state, msg.new_state);
  }

  private onPosition(msg: PositionMsg): void {
    if (!msg.device_id) return;
    const device = this.devices.get(msg.device_id);
    if (device && device.status) {
      device.status.position = msg.position;
    }
    this.stateManager.broadcastPosition(msg.device_id, msg.position);
  }

  private onError(msg: ErrorMsg): void {
    if (!msg.device_id) return;
    const device = this.devices.get(msg.device_id);
    if (device) {
      device.state = 'alarm';
      if (device.status) device.status.error_message = msg.message;
    }
    this.stateManager.broadcastError(msg.device_id, msg.message);
  }

  // ---------------- Kompatibilitási API a tesztek és külső hívók részére ----------------
  // Ezeket a régi tesztek és néhány külső modul közvetlenül hívja. Belül egyszerűen
  // delegálnak az új, üzenet-vezérelt belső handlerekre, így nem kell az egész tesztset-et
  // átírni a `BridgeWsClient` discriminated unionra.

  /** @internal */
  handleStateChange(deviceId: string, oldState: string, newState: string): void {
    this.onStateChange({
      type: 'state_change',
      device_id: deviceId,
      old_state: oldState,
      new_state: newState,
    });
  }

  /** @internal */
  handlePositionUpdate(deviceId: string, position: DeviceStatus['position']): void {
    this.onPosition({ type: 'position', device_id: deviceId, position });
  }

  /** @internal */
  handleError(deviceId: string, message: string): void {
    this.onError({ type: 'error', device_id: deviceId, message });
  }

  private onJobComplete(msg: JobCompleteMsg): void {
    if (!msg.device_id) return;
    this.stateManager.broadcastJobComplete(msg.device_id, msg.file);
  }

  private onJobProgress(msg: JobProgressMsg): void {
    if (!msg.device_id) return;
    const device = this.devices.get(msg.device_id);
    if (device && device.status) {
      device.status.progress = msg.progress;
      device.status.current_line = msg.current_line;
      device.status.total_lines = msg.total_lines;
    }
    this.stateManager.broadcastJobProgress(
      msg.device_id,
      msg.progress,
      msg.current_line,
      msg.total_lines
    );
  }

  private onControlState(msg: ControlStateMsg): void {
    if (!msg.device_id) return;
    const device = this.devices.get(msg.device_id);
    if (device) device.control = msg.control;
    this.stateManager.broadcastControlState(msg.device_id, msg.control);
  }

  private onControlDenied(msg: ControlDeniedMsg): void {
    if (!msg.device_id) return;
    const device = this.devices.get(msg.device_id);
    if (device) device.control = msg.control;
    this.stateManager.broadcastControlDenied(msg.device_id, msg.reason, msg.control);
  }

  private updateDeviceStatus(deviceId: string, status: DeviceStatus): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = status;
      device.state = status.state;
      device.connected = status.state !== 'disconnected';
      this.stateManager.broadcastDeviceStatus(deviceId, status);
    }
  }

  // ===========================================================================
  // PUBLIC API — devices CRUD + state
  // ===========================================================================

  getDevices(): Device[] {
    return Array.from(this.devices.values());
  }

  getDevice(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }

  async refreshDevices(): Promise<void> {
    try {
      const data = await this.bridge.listDevices();
      const bridgeDevices = (data as { devices?: BridgeDeviceListEntry[] }).devices ?? [];

      for (const bd of bridgeDevices) {
        const device = this.devices.get(bd.id);
        if (device) {
          device.connected = bd.connected;
          device.state = bd.state;
          if (bd.simulated !== undefined) device.simulated = bd.simulated;
          if (bd.connectionInfo !== undefined) device.connectionInfo = bd.connectionInfo;
          if (bd.lastError !== undefined) device.lastError = bd.lastError;
          if (bd.control !== undefined) device.control = bd.control as DeviceControlState;
        }
      }

      for (const bd of bridgeDevices) {
        await this.getDeviceCapabilities(bd.id);
        await this.getDeviceControlState(bd.id);
        await this.tryAutoClaimHost(bd.id, 'startup');
      }
    } catch (error) {
      log.error('Eszközök frissítési hiba:', error);
    }
  }

  async addDevice(config: {
    id: string;
    name: string;
    type: string;
    driver: string;
    enabled: boolean;
    config: Record<string, unknown>;
  }): Promise<boolean> {
    const ok = await this.bridge.addDevice(config);
    if (!ok) return false;

    await this.refreshDevices();
    this.devices.set(config.id, {
      id: config.id,
      name: config.name,
      type: config.type,
      driver: config.driver,
      connected: false,
      state: 'disconnected',
    });
    return true;
  }

  async getDeviceStatus(deviceId: string): Promise<DeviceStatus | null> {
    const status = (await this.bridge.getDeviceStatus(deviceId)) as DeviceStatus | null;
    if (status) this.updateDeviceStatus(deviceId, status);
    return status;
  }

  async getDeviceCapabilities(deviceId: string): Promise<DeviceCapabilities | null> {
    const capabilities = (await this.bridge.getDeviceCapabilities(
      deviceId
    )) as DeviceCapabilities | null;
    const device = this.devices.get(deviceId);
    if (device && capabilities) device.capabilities = capabilities;
    return capabilities;
  }

  async getDeviceControlState(deviceId: string): Promise<DeviceControlState | null> {
    const control = (await this.bridge.getDeviceControlState(
      deviceId
    )) as DeviceControlState | null;
    if (!control) return null;
    const device = this.devices.get(deviceId);
    const prev = device?.control ? JSON.stringify(device.control) : null;
    const next = JSON.stringify(control);
    if (device) device.control = control;
    if (prev !== next) this.stateManager.broadcastControlState(deviceId, control);
    return control;
  }

  async requestControl(
    deviceId: string,
    owner: 'host' | 'panel',
    requestedBy: string = 'backend_request'
  ): Promise<{ granted: boolean; reason?: string; state?: DeviceControlState } | null> {
    const result = await this.bridge.requestControl(deviceId, owner, requestedBy);
    if (!result) return null;
    if (result.state) {
      const device = this.devices.get(deviceId);
      if (device) device.control = result.state as DeviceControlState;
    }
    return result as { granted: boolean; reason?: string; state?: DeviceControlState };
  }

  async releaseControl(
    deviceId: string,
    requestedBy: string = 'backend_release'
  ): Promise<{ granted: boolean; reason?: string; state?: DeviceControlState } | null> {
    const result = await this.bridge.releaseControl(deviceId, requestedBy);
    if (!result) return null;
    if (result.state) {
      const device = this.devices.get(deviceId);
      if (device) device.control = result.state as DeviceControlState;
    }
    return result as { granted: boolean; reason?: string; state?: DeviceControlState };
  }

  async connectDevice(deviceId: string): Promise<boolean> {
    const ok = await this.bridge.connectDevice(deviceId);
    if (!ok) return false;
    await this.getDeviceCapabilities(deviceId);
    await this.getDeviceControlState(deviceId);
    await this.tryAutoClaimHost(deviceId, 'connect');
    return true;
  }

  async disconnectDevice(deviceId: string): Promise<boolean> {
    return this.bridge.disconnectDevice(deviceId);
  }

  // ===========================================================================
  // MOTION
  // ===========================================================================

  async home(deviceId: string, axes?: string[], feedRate?: number): Promise<boolean> {
    return this.bridge.home(deviceId, axes, feedRate);
  }

  async jog(
    deviceId: string,
    axis: string,
    distance: number,
    feedRate: number,
    mode?: string
  ): Promise<boolean> {
    return this.bridge.jog(deviceId, axis, distance, feedRate, mode);
  }

  async jogStop(deviceId: string): Promise<boolean> {
    return this.bridge.jogStop(deviceId);
  }

  async jogSessionStart(
    deviceId: string,
    axis: string,
    direction: number,
    feedRate: number,
    mode?: string,
    heartbeatTimeout: number = 0.5,
    tickMs: number = 40
  ): Promise<boolean> {
    return this.bridge.jogSessionStart(deviceId, {
      axis,
      direction,
      feed_rate: feedRate,
      mode: mode || null,
      heartbeat_timeout: heartbeatTimeout,
      tick_ms: tickMs,
    });
  }

  async jogSessionBeat(
    deviceId: string,
    axis?: string,
    direction?: number,
    feedRate?: number,
    mode?: string
  ): Promise<boolean> {
    return this.bridge.jogSessionBeat(deviceId, {
      axis: axis || null,
      direction: direction ?? null,
      feed_rate: feedRate ?? null,
      mode: mode || null,
    });
  }

  async jogSessionStop(deviceId: string, hardStop: boolean = false): Promise<boolean> {
    return this.bridge.jogSessionStop(deviceId, hardStop);
  }

  async getJogDiagnostics(deviceId: string): Promise<JogDiagnostics | null> {
    return this.bridge.getJogDiagnostics(deviceId);
  }

  async sendGCode(deviceId: string, gcode: string): Promise<string> {
    return this.bridge.sendGCode(deviceId, gcode);
  }

  async loadFile(deviceId: string, filepath: string): Promise<boolean> {
    return this.bridge.loadFile(deviceId, filepath);
  }

  async run(deviceId: string, fromLine: number = 0): Promise<boolean> {
    return this.bridge.run(deviceId, fromLine);
  }

  async pause(deviceId: string): Promise<boolean> {
    return this.bridge.pause(deviceId);
  }

  async resume(deviceId: string): Promise<boolean> {
    return this.bridge.resume(deviceId);
  }

  async stop(deviceId: string): Promise<boolean> {
    return this.bridge.stop(deviceId);
  }

  async reset(deviceId: string): Promise<boolean> {
    return this.bridge.reset(deviceId);
  }

  async setFeedOverride(deviceId: string, percent: number): Promise<boolean> {
    return this.bridge.setFeedOverride(deviceId, percent);
  }

  async setSpindleOverride(deviceId: string, percent: number): Promise<boolean> {
    return this.bridge.setSpindleOverride(deviceId, percent);
  }

  // ===========================================================================
  // SOFT LIMITS / GRBL
  // ===========================================================================

  async setSoftLimits(deviceId: string, enabled: boolean): Promise<boolean> {
    return this.bridge.setSoftLimits(deviceId, enabled);
  }

  async getSoftLimits(deviceId: string): Promise<{ soft_limits_enabled: boolean } | null> {
    return this.bridge.getSoftLimits(deviceId);
  }

  async getGrblSettings(deviceId: string): Promise<Record<string, number> | null> {
    return this.bridge.getGrblSettings(deviceId);
  }

  async setGrblSettingsBatch(
    deviceId: string,
    settings: Record<string, number | string>
  ): Promise<boolean> {
    return this.bridge.setGrblSettingsBatch(deviceId, settings);
  }

  // ===========================================================================
  // ROBOT
  // ===========================================================================

  gripperOn(deviceId: string): Promise<boolean> {
    return this.bridge.gripperOn(deviceId);
  }
  gripperOff(deviceId: string): Promise<boolean> {
    return this.bridge.gripperOff(deviceId);
  }
  suckerOn(deviceId: string): Promise<boolean> {
    return this.bridge.suckerOn(deviceId);
  }
  suckerOff(deviceId: string): Promise<boolean> {
    return this.bridge.suckerOff(deviceId);
  }
  robotEnable(deviceId: string): Promise<boolean> {
    return this.bridge.robotEnable(deviceId);
  }
  robotDisable(deviceId: string): Promise<boolean> {
    return this.bridge.robotDisable(deviceId);
  }
  robotCalibrate(deviceId: string): Promise<boolean> {
    return this.bridge.robotCalibrate(deviceId);
  }

  // ===========================================================================
  // CALIBRATION
  // ===========================================================================

  calibrateLimits(deviceId: string, options: Record<string, unknown> = {}): Promise<unknown> {
    return this.bridge.calibrateLimits(deviceId, options);
  }
  getCalibrationStatus(deviceId: string): Promise<unknown> {
    return this.bridge.getCalibrationStatus(deviceId);
  }
  stopCalibration(deviceId: string): Promise<boolean> {
    return this.bridge.stopCalibration(deviceId);
  }
  saveCalibration(deviceId: string, payload: unknown): Promise<unknown> {
    return this.bridge.saveCalibration(deviceId, payload);
  }

  // ===========================================================================
  // TEACH
  // ===========================================================================

  teachRecord(deviceId: string): Promise<unknown> {
    return this.bridge.teachRecord(deviceId);
  }
  teachPlay(deviceId: string): Promise<boolean> {
    return this.bridge.teachPlay(deviceId);
  }
  teachClear(deviceId: string): Promise<boolean> {
    return this.bridge.teachClear(deviceId);
  }
  teachGetPositions(deviceId: string): Promise<unknown[]> {
    return this.bridge.teachGetPositions(deviceId);
  }

  // ===========================================================================
  // DIAGNOSTICS / MOTOR TUNING
  // ===========================================================================

  runDiagnostics(deviceId: string, moveTest: boolean = false): Promise<unknown> {
    return this.bridge.runDiagnostics(deviceId, moveTest);
  }
  runFirmwareProbe(deviceId: string): Promise<unknown> {
    return this.bridge.runFirmwareProbe(deviceId);
  }
  runEndstopTest(
    deviceId: string,
    stepSize: number = 5.0,
    speed: number = 15,
    maxAngle: number = 200.0
  ): Promise<unknown> {
    return this.bridge.runEndstopTest(deviceId, stepSize, speed, maxAngle);
  }
  runMotionTest(deviceId: string, testAngle: number = 30.0): Promise<unknown> {
    return this.bridge.runMotionTest(deviceId, testAngle);
  }
  getTestProgress(deviceId: string, after: number = 0): Promise<unknown> {
    return this.bridge.getTestProgress(deviceId, after);
  }
  cancelTest(deviceId: string): Promise<unknown> {
    return this.bridge.cancelTest(deviceId);
  }

  /**
   * Konfiguráció újratöltése a JSON fájlból.
   * A MachineConfigTab mentése után hívandó, hogy az új beállítások
   * (pl. tengely invertálás, scale, limitek) azonnal életbe lépjenek.
   */
  reloadConfig(deviceId: string): Promise<unknown> {
    return this.bridge.reloadConfig(deviceId);
  }
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

interface BridgeDeviceListEntry {
  id: string;
  name: string;
  type: string;
  connected: boolean;
  state: string;
  simulated?: boolean;
  connectionInfo?: string;
  lastError?: string | null;
  control?: unknown;
}
