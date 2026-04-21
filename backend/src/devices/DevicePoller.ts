/**
 * DevicePoller: periodikus status- és auto-claim safety-net.
 *
 * A bridge a fontos változásokat WS-en pusholja; ez a poll csak a ritka
 * drift-eket veszi fel (current_file, teljes status snapshot, ownership
 * recovery WS-reconnect után). A futás során minden tick-en végigmegy
 * a `provider()` által visszaadott eszközökön.
 */

import { createLogger } from '../utils/logger.js';
import {
  STATUS_POLL_INTERVAL_MS,
  AUTO_CLAIM_THROTTLE_MS,
} from '../config/constants.js';

const log = createLogger('device-poller');

export interface PollableDevice {
  id: string;
  connected: boolean;
  state: string;
  control?: { owner: 'host' | 'panel' | 'none' };
  capabilities?: { supports_panel_controller?: boolean };
}

export interface DevicePollerCallbacks {
  /** A "naprakész" eszközlistát adja vissza (DeviceManager belső map-jéből). */
  listDevices: () => PollableDevice[];
  /** Egyetlen eszköz status-ának frissítése (HTTP). */
  refreshStatus: (deviceId: string) => Promise<void>;
  /** Auto-claim host policy meghívása "poll" trigger okkal. */
  tryAutoClaim: (deviceId: string) => Promise<void>;
}

export class DevicePoller {
  private timer: NodeJS.Timeout | null = null;
  private autoClaimAttemptAt = new Map<string, number>();
  private readonly intervalMs: number;
  private readonly callbacks: DevicePollerCallbacks;

  constructor(callbacks: DevicePollerCallbacks, intervalMs: number = STATUS_POLL_INTERVAL_MS) {
    this.callbacks = callbacks;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    log.info(`Status polling (safety-net) started, interval=${this.intervalMs}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Megnézi, hogy a `deviceId`-t most lehet-e auto-claim-elni "poll" triggerrel
   * (throttle alapján). Külső consumer is használhatja a state-et.
   */
  shouldAutoClaim(deviceId: string): boolean {
    const now = Date.now();
    const last = this.autoClaimAttemptAt.get(deviceId) ?? 0;
    return now - last >= AUTO_CLAIM_THROTTLE_MS;
  }

  recordAutoClaim(deviceId: string): void {
    this.autoClaimAttemptAt.set(deviceId, Date.now());
  }

  private async tick(): Promise<void> {
    const devices = this.callbacks.listDevices();
    for (const device of devices) {
      if (!device.connected) continue;
      try {
        await this.callbacks.refreshStatus(device.id);
        if (device.control && device.control.owner === 'none' && this.shouldAutoClaim(device.id)) {
          this.recordAutoClaim(device.id);
          await this.callbacks.tryAutoClaim(device.id);
        }
      } catch {
        // Polling hibát csendben elnyeljük — a device lehet épp busy
      }
    }
  }
}
