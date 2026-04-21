/**
 * App-szintű beállítások (bridge host/port + realtime ráta).
 *
 * Az értékek startupkor a `system.yaml`-ből töltődnek (`initAppSettings`).
 * A `constants.ts`-ben definiált default-okat csak akkor használjuk, ha a
 * config nincs megadva.
 */

import type { AppConfig } from '../../config/index.js';
import {
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  POSITION_UPDATE_RATE_HZ,
  STATUS_UPDATE_RATE_HZ,
} from '../../config/constants.js';

export interface AppSettings {
  bridgeHost: string;
  bridgePort: number;
  positionUpdateRate: number;
  statusUpdateRate: number;
}

export const appSettings: AppSettings = {
  bridgeHost: DEFAULT_BRIDGE_HOST,
  bridgePort: DEFAULT_BRIDGE_PORT,
  positionUpdateRate: POSITION_UPDATE_RATE_HZ,
  statusUpdateRate: STATUS_UPDATE_RATE_HZ,
};

/**
 * Inicializálja az alapértékeket a system.yaml-ből (a backend startup-jakor
 * hívódik). Ha a config nincs megadva, a hardcoded fallback marad.
 */
export function initAppSettings(config?: AppConfig): void {
  if (!config) return;
  if (config.server?.bridge?.host) {
    appSettings.bridgeHost = config.server.bridge.host;
  }
  if (config.server?.bridge?.port) {
    appSettings.bridgePort = config.server.bridge.port;
  }
  if (config.realtime?.position_update_rate) {
    appSettings.positionUpdateRate = config.realtime.position_update_rate;
  }
  if (config.realtime?.status_update_rate) {
    appSettings.statusUpdateRate = config.realtime.status_update_rate;
  }
}
