/**
 * /stats — egyszerű rendszerstatisztika a Dashboard-hoz.
 */

import { Router, Request, Response } from 'express';
import { DeviceManager } from '../../devices/DeviceManager.js';
import { StateManager } from '../../state/StateManager.js';

export function createStatsRouter(
  deviceManager: DeviceManager,
  stateManager: StateManager
): Router {
  const router = Router();

  router.get('/stats', (_req: Request, res: Response) => {
    res.json({
      connectedClients: stateManager.getClientCount(),
      devices: deviceManager.getDevices().length,
    });
  });

  return router;
}
