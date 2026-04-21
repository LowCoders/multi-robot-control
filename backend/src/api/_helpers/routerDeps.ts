/**
 * RouterDeps: minden createXRouter közös bemenete.
 *
 * Ez egy lazán implementált Dependency Injection minta: a router-factory-k
 * egyetlen, jól tipizált deps objektumot kapnak, így új függőség (pl.
 * bridgeClient) bevezetése nem töri a hívási helyet.
 *
 * Backward compat: a régi `createXRouter(deviceManager, stateManager)`
 * szignatúrák a `createApiRoutes`-ban élnek; az új helperek csak az új,
 * destrukturált formát használják.
 */

import type { DeviceManager } from '../../devices/DeviceManager.js';
import type { StateManager } from '../../state/StateManager.js';

export interface RouterDeps {
  deviceManager: DeviceManager;
  stateManager: StateManager;
}
