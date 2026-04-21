/**
 * REST API Routes — orchestrator.
 *
 * A monolit `routes.ts` szétbontva domain-routerekre a `routes/` alá.
 * Ez a fájl már csak az egyes router-factory-kat fűzi össze egy közös
 * `Router`-ré, amit a `server.ts` mountol az `/api` prefix alatt.
 *
 * Minden route-mintázat változatlan: a contract snapshot teszt
 * (`routes.contract.test.ts`) bit-pontosan ugyanazt a (method, path) listát
 * kell, hogy lássa, mint a refaktor előtt.
 */

import { Router } from 'express';
import { DeviceManager } from '../devices/DeviceManager.js';
import { StateManager } from '../state/StateManager.js';
import { AppConfig } from '../config/index.js';
import { initAppSettings } from './_state/appState.js';
import { createSettingsRouter } from './routes/settings.routes.js';
import { createDevicesYamlRouter } from './routes/devicesYaml.routes.js';
import { createAutomationRouter } from './routes/automation.routes.js';
import { createJobsRouter } from './routes/jobs.routes.js';
import { createGcodeRouter } from './routes/gcode.routes.js';
import { createDevicesRouter } from './routes/devices.routes.js';
import { createDeviceGrblRouter } from './routes/deviceGrbl.routes.js';
import { createDeviceConfigRouter } from './routes/deviceConfig.routes.js';
import { createDeviceMotionRouter } from './routes/deviceMotion.routes.js';
import { createDeviceRobotRouter } from './routes/deviceRobot.routes.js';
import { createDeviceDiagnosticsRouter } from './routes/deviceDiagnostics.routes.js';
import { createStatsRouter } from './routes/stats.routes.js';

export function createApiRoutes(
  deviceManager: DeviceManager,
  stateManager: StateManager,
  config?: AppConfig
): Router {
  initAppSettings(config);

  const router = Router();

  router.use(createSettingsRouter());
  router.use(createDevicesYamlRouter(deviceManager));
  router.use(createAutomationRouter());
  router.use(createJobsRouter(deviceManager));
  router.use(createGcodeRouter());
  router.use(createDevicesRouter(deviceManager, stateManager));
  router.use(createDeviceGrblRouter(deviceManager));
  router.use(createDeviceConfigRouter(deviceManager, stateManager));
  router.use(createDeviceMotionRouter(deviceManager));
  router.use(createDeviceRobotRouter(deviceManager));
  router.use(createDeviceDiagnosticsRouter(deviceManager));
  router.use(createStatsRouter(deviceManager, stateManager));

  return router;
}
