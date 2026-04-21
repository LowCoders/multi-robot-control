/**
 * BridgeClient: típusos vékony wrapper a Python FastAPI bridge köré.
 *
 * A `bridge-types.ts` (auto-generált a `scripts/generate-api-types.sh`
 * által) szolgáltatja a request/response típusokat — ahol igénybe vesszük
 * (status/capabilities/control_state stb.). A többi endpointnál (motion,
 * robot, calibration, …) a body/response shape-eket lokálisan írjuk le,
 * mert a bridge OpenAPI még nem fed le mindent (response_model bevezetés
 * a Drivers oldali külön TODO).
 *
 * Felelősségek:
 *   - egyetlen `axios` instance baseURL + timeout konfigurációval
 *   - tömör `safeGet/safePost` 404 → null kezeléssel, hogy a hívó kódból
 *     eltüntessük az ismétlődő `try/catch + log + return null` blokkokat
 *   - típusos `Promise<…>` minden hívásnál (nincs `Promise<any>`)
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, isAxiosError } from 'axios';
import type { components, paths } from '../api/bridge-types.js';
import { BRIDGE_HTTP_TIMEOUT_MS } from '../config/constants.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('bridge-client');

export type BridgeSchemas = components['schemas'];

export type BridgeGetResponse<P extends keyof paths> =
  paths[P] extends { get: { responses: { 200: { content: { 'application/json': infer T } } } } }
    ? T
    : never;

export type BridgePostBody<P extends keyof paths> =
  paths[P] extends { post: { requestBody: { content: { 'application/json': infer T } } } }
    ? T
    : never;

// =============================================================================
// LOKÁLIS TÍPUSOK (a bridge OpenAPI még nem írja le ezeket részletesen)
// =============================================================================

export interface SuccessResult {
  success: boolean;
  [key: string]: unknown;
}

export interface ControlActionResult {
  granted: boolean;
  reason?: string;
  state?: unknown;
}

export interface JogDiagnostics {
  grbl_version?: string | null;
  protocol?: string;
  streaming_error8_retries?: number;
  last_jog_trace?: {
    success?: boolean;
    state_before?: string | null;
    grbl_version?: string | null;
    protocol?: string;
    commands?: string[];
    responses?: string[];
    error_code?: number;
    error_message?: string;
    error?: string;
  };
}

export interface CalibrationStatus {
  running: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface DiagnosticsResult {
  [key: string]: unknown;
}

export interface TestProgressEntry {
  [key: string]: unknown;
}

export interface TestProgressResult {
  entries: TestProgressEntry[];
  total: number;
  running: boolean;
  [key: string]: unknown;
}

export interface TeachPosition {
  [key: string]: unknown;
}

// =============================================================================
// BRIDGE CLIENT
// =============================================================================

export class BridgeClient {
  readonly raw: AxiosInstance;

  constructor(bridgeUrl: string, timeoutMs: number = BRIDGE_HTTP_TIMEOUT_MS) {
    this.raw = axios.create({ baseURL: bridgeUrl, timeout: timeoutMs });
  }

  // ---------------- internals ----------------

  private async safeGet<T>(url: string, config?: AxiosRequestConfig): Promise<T | null> {
    try {
      const resp = await this.raw.get<T>(url, config);
      return resp.data;
    } catch (err) {
      if (this.is404(err)) return null;
      this.logError('GET', url, err);
      return null;
    }
  }

  private async safePost<T = SuccessResult>(
    url: string,
    body?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T | null> {
    try {
      const resp = await this.raw.post<T>(url, body ?? null, config);
      return resp.data;
    } catch (err) {
      this.logError('POST', url, err);
      return null;
    }
  }

  private async successPost(
    url: string,
    body?: unknown,
    config?: AxiosRequestConfig
  ): Promise<boolean> {
    const data = await this.safePost<SuccessResult>(url, body, config);
    return Boolean(data?.success);
  }

  /** Olyan "long-running" POST, ahol a hívó vagy a bridge választ várja vissza. */
  private async throwingPost<T>(
    url: string,
    body?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const resp = await this.raw.post<T>(url, body ?? null, config);
    return resp.data;
  }

  private is404(err: unknown): boolean {
    return isAxiosError(err) && (err as AxiosError).response?.status === 404;
  }

  private logError(method: string, url: string, err: unknown): void {
    const status = isAxiosError(err) ? err.response?.status ?? 'no-response' : 'thrown';
    const detail = err instanceof Error ? err.message : String(err);
    log.error(`${method} ${url} → ${status}: ${detail}`);
  }

  private encId(deviceId: string): string {
    return encodeURIComponent(deviceId);
  }

  // ---------------- DEVICES ----------------

  async listDevices(): Promise<BridgeGetResponse<'/devices'>> {
    const resp = await this.raw.get<BridgeGetResponse<'/devices'>>('/devices');
    return resp.data;
  }

  async addDevice(payload: {
    id: string;
    name: string;
    type: string;
    driver: string;
    enabled: boolean;
    config: Record<string, unknown>;
  }): Promise<boolean> {
    return this.successPost('/devices', payload);
  }

  async getDeviceStatus(
    deviceId: string
  ): Promise<BridgeGetResponse<'/devices/{device_id}/status'> | null> {
    return this.safeGet(`/devices/${this.encId(deviceId)}/status`);
  }

  async getDeviceCapabilities(
    deviceId: string
  ): Promise<BridgeGetResponse<'/devices/{device_id}/capabilities'> | null> {
    return this.safeGet(`/devices/${this.encId(deviceId)}/capabilities`);
  }

  async connectDevice(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/connect`);
  }

  async disconnectDevice(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/disconnect`);
  }

  // ---------------- CONTROL ----------------

  async getDeviceControlState(
    deviceId: string
  ): Promise<BridgeGetResponse<'/devices/{device_id}/control/state'> | null> {
    return this.safeGet(`/devices/${this.encId(deviceId)}/control/state`);
  }

  async requestControl(
    deviceId: string,
    owner: 'host' | 'panel',
    requestedBy: string
  ): Promise<ControlActionResult | null> {
    return this.safePost<ControlActionResult>(`/devices/${this.encId(deviceId)}/control/request`, {
      requested_owner: owner,
      requested_by: requestedBy,
    });
  }

  async releaseControl(
    deviceId: string,
    requestedBy: string
  ): Promise<ControlActionResult | null> {
    return this.safePost<ControlActionResult>(`/devices/${this.encId(deviceId)}/control/release`, {
      requested_by: requestedBy,
    });
  }

  // ---------------- MOTION ----------------

  async home(deviceId: string, axes?: string[], feedRate?: number): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/home`, {
      axes,
      feed_rate: feedRate,
    });
  }

  async jog(
    deviceId: string,
    axis: string,
    distance: number,
    feedRate: number,
    mode?: string
  ): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/jog`, {
      axis,
      distance,
      feed_rate: feedRate,
      mode: mode || null,
    });
  }

  async jogStop(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/jog/stop`);
  }

  async jogSessionStart(
    deviceId: string,
    payload: {
      axis: string;
      direction: number;
      feed_rate: number;
      mode?: string | null;
      heartbeat_timeout: number;
      tick_ms: number;
    }
  ): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/jog/session/start`, payload);
  }

  async jogSessionBeat(
    deviceId: string,
    payload: {
      axis?: string | null;
      direction?: number | null;
      feed_rate?: number | null;
      mode?: string | null;
    }
  ): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/jog/session/beat`, payload);
  }

  async jogSessionStop(deviceId: string, hardStop: boolean): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/jog/session/stop`, {
      hard_stop: hardStop,
    });
  }

  async getJogDiagnostics(deviceId: string): Promise<JogDiagnostics | null> {
    try {
      const resp = await this.raw.get<JogDiagnostics>(
        `/devices/${this.encId(deviceId)}/jog/diagnostics`
      );
      return resp.data ?? null;
    } catch (err) {
      const status = isAxiosError(err) ? err.response?.status : undefined;
      if (status !== 400 && status !== 404) {
        this.logError('GET', `/devices/${deviceId}/jog/diagnostics`, err);
      }
      return null;
    }
  }

  async sendGCode(deviceId: string, gcode: string): Promise<string> {
    const data = await this.safePost<{ response: string }>(
      `/devices/${this.encId(deviceId)}/gcode`,
      { gcode }
    );
    return data?.response ?? 'error';
  }

  async loadFile(deviceId: string, filepath: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/load`, { filepath });
  }

  async run(deviceId: string, fromLine: number): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/run`, null, {
      params: { from_line: fromLine },
    });
  }

  async pause(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/pause`);
  }

  async resume(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/resume`);
  }

  async stop(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/stop`);
  }

  async reset(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/reset`);
  }

  async setFeedOverride(deviceId: string, percent: number): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/feed-override`, { percent });
  }

  async setSpindleOverride(deviceId: string, percent: number): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/spindle-override`, { percent });
  }

  // ---------------- SOFT LIMITS / GRBL ----------------

  async setSoftLimits(deviceId: string, enabled: boolean): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/soft-limits`, null, {
      params: { enabled },
    });
  }

  async getSoftLimits(deviceId: string): Promise<{ soft_limits_enabled: boolean } | null> {
    return this.safeGet<{ soft_limits_enabled: boolean }>(
      `/devices/${this.encId(deviceId)}/soft-limits`
    );
  }

  async getGrblSettings(deviceId: string): Promise<Record<string, number> | null> {
    const data = await this.safeGet<{ settings?: Record<string, number> }>(
      `/devices/${this.encId(deviceId)}/grbl-settings`
    );
    return data?.settings ?? null;
  }

  async setGrblSettingsBatch(
    deviceId: string,
    settings: Record<string, number | string>
  ): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/grbl-settings/batch`, { settings });
  }

  // ---------------- ROBOT ----------------

  async gripperOn(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/gripper/on`);
  }
  async gripperOff(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/gripper/off`);
  }
  async suckerOn(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/sucker/on`);
  }
  async suckerOff(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/sucker/off`);
  }
  async robotEnable(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/enable`);
  }
  async robotDisable(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/disable`);
  }
  async robotCalibrate(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/calibrate`);
  }

  // ---------------- CALIBRATION (long-running) ----------------

  async calibrateLimits(
    deviceId: string,
    options: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.throwingPost(`/devices/${this.encId(deviceId)}/calibrate-limits`, options, {
      timeout: 300_000,
    });
  }

  async getCalibrationStatus(deviceId: string): Promise<CalibrationStatus> {
    const data = await this.safeGet<CalibrationStatus>(
      `/devices/${this.encId(deviceId)}/calibration-status`
    );
    return data ?? { running: false, message: 'Hiba történt' };
  }

  async stopCalibration(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/calibration-stop`);
  }

  async saveCalibration(deviceId: string, payload: unknown): Promise<unknown> {
    return this.throwingPost(`/devices/${this.encId(deviceId)}/save-calibration`, payload);
  }

  // ---------------- TEACH ----------------

  async teachRecord(deviceId: string): Promise<unknown> {
    return this.safePost<unknown>(`/devices/${this.encId(deviceId)}/teach/record`);
  }

  async teachPlay(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/teach/play`);
  }

  async teachClear(deviceId: string): Promise<boolean> {
    return this.successPost(`/devices/${this.encId(deviceId)}/teach/clear`);
  }

  async teachGetPositions(deviceId: string): Promise<TeachPosition[]> {
    const data = await this.safeGet<{ positions?: TeachPosition[] }>(
      `/devices/${this.encId(deviceId)}/teach/positions`
    );
    return data?.positions ?? [];
  }

  // ---------------- DIAGNOSTICS / TESTS (long-running) ----------------

  async runDiagnostics(deviceId: string, moveTest: boolean): Promise<DiagnosticsResult> {
    return this.throwingPost<DiagnosticsResult>(
      `/devices/${this.encId(deviceId)}/diagnostics`,
      null,
      {
        params: { move_test: moveTest },
        timeout: 60_000,
      }
    );
  }

  async runFirmwareProbe(deviceId: string): Promise<DiagnosticsResult> {
    return this.throwingPost<DiagnosticsResult>(
      `/devices/${this.encId(deviceId)}/firmware-probe`,
      null,
      { timeout: 120_000 }
    );
  }

  async runEndstopTest(
    deviceId: string,
    stepSize: number,
    speed: number,
    maxAngle: number
  ): Promise<DiagnosticsResult> {
    return this.throwingPost<DiagnosticsResult>(
      `/devices/${this.encId(deviceId)}/endstop-test`,
      null,
      { params: { step_size: stepSize, speed, max_angle: maxAngle }, timeout: 300_000 }
    );
  }

  async runMotionTest(deviceId: string, testAngle: number): Promise<DiagnosticsResult> {
    return this.throwingPost<DiagnosticsResult>(
      `/devices/${this.encId(deviceId)}/motion-test`,
      null,
      { params: { test_angle: testAngle }, timeout: 300_000 }
    );
  }

  async getTestProgress(deviceId: string, after: number): Promise<TestProgressResult> {
    try {
      const resp = await this.raw.get<TestProgressResult>(
        `/devices/${this.encId(deviceId)}/test-progress`,
        { params: { after }, timeout: 5_000 }
      );
      return resp.data;
    } catch {
      // Csendes fallback ha a bridge nem elérhető
      return { entries: [], total: 0, running: false };
    }
  }

  async cancelTest(deviceId: string): Promise<DiagnosticsResult> {
    return this.throwingPost<DiagnosticsResult>(
      `/devices/${this.encId(deviceId)}/cancel-test`,
      null,
      { timeout: 5_000 }
    );
  }

  async reloadConfig(deviceId: string): Promise<unknown> {
    return this.throwingPost(`/devices/${this.encId(deviceId)}/reload-config`);
  }
}

/** Backward-compatible factory az interface-alapú használathoz. */
export function createBridgeClient(
  bridgeUrl: string,
  timeoutMs: number = BRIDGE_HTTP_TIMEOUT_MS
): BridgeClient {
  return new BridgeClient(bridgeUrl, timeoutMs);
}
