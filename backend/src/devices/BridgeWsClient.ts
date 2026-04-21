/**
 * BridgeWsClient: a Python bridge WebSocket-jének tipizált, újracsatlakozó kliense.
 *
 * Az üzeneteket egy egyszerű subscriber callback-en keresztül adja át a
 * `DeviceManager`-nek; a connection lifecycle (open/close/error/reconnect) itt
 * el van rejtve. A polling ezzel ortogonális — azt a `DevicePoller` végzi.
 *
 * A `BridgeMessage` discriminated union biztosítja a típusos handler-eket:
 * a switch case-ben a `device_id`, `position`, `progress` stb. mezőket
 * a TS pontosan ki tudja olvasni.
 */

import WebSocket from 'ws';
import { createLogger } from '../utils/logger.js';
import type { DeviceStatus, DeviceControlState } from './DeviceManager.js';

const log = createLogger('bridge-ws');

// =============================================================================
// MESSAGE TYPES
// =============================================================================

interface BaseMsg<T extends string> {
  type: T;
  device_id?: string;
}

export interface StatusMsg extends BaseMsg<'status'> {
  status: DeviceStatus;
}

export interface StateChangeMsg extends BaseMsg<'state_change'> {
  old_state: string;
  new_state: string;
}

export interface PositionMsg extends BaseMsg<'position'> {
  position: DeviceStatus['position'];
}

export interface ErrorMsg extends BaseMsg<'error'> {
  message: string;
}

export interface JobCompleteMsg extends BaseMsg<'job_complete'> {
  file: string;
}

export interface JobProgressMsg extends BaseMsg<'job_progress'> {
  progress: number;
  current_line: number;
  total_lines: number;
}

export interface ControlStateMsg extends BaseMsg<'control_state'> {
  control: DeviceControlState;
}

export interface ControlDeniedMsg extends BaseMsg<'control_denied'> {
  reason: string;
  control: DeviceControlState;
}

export type BridgeMessage =
  | StatusMsg
  | StateChangeMsg
  | PositionMsg
  | ErrorMsg
  | JobCompleteMsg
  | JobProgressMsg
  | ControlStateMsg
  | ControlDeniedMsg;

export type BridgeMessageHandler = (msg: BridgeMessage) => void;

// =============================================================================
// CLIENT
// =============================================================================

const RECONNECT_DELAY_MS = 5_000;

export class BridgeWsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly handler: BridgeMessageHandler;
  private readonly wsUrl: string;
  private stopped = false;

  constructor(bridgeUrl: string, handler: BridgeMessageHandler) {
    this.wsUrl = bridgeUrl.replace('http', 'ws') + '/ws';
    this.handler = handler;
  }

  async connect(): Promise<void> {
    this.closeWs();

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          log.info('Bridge WebSocket csatlakozva');
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString()) as BridgeMessage;
            this.handler(message);
          } catch (e) {
            log.error('Bridge message parse error:', e);
          }
        });

        this.ws.on('close', () => {
          log.info('Bridge WebSocket lecsatlakozva');
          this.scheduleReconnect();
        });

        this.ws.on('error', (error) => {
          log.error('Bridge WebSocket hiba:', error.message);
          resolve();
        });
      } catch (error) {
        log.error('Bridge WebSocket csatlakozási hiba:', error);
        this.scheduleReconnect();
        resolve();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    this.closeWs();

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      log.info('Bridge újracsatlakozás...');
      void this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private closeWs(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (
          this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING
        ) {
          this.ws.close();
        }
      } catch {
        // close error: ignoráljuk
      }
      this.ws = null;
    }
  }

  cleanup(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeWs();
  }
}
