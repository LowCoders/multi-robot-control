/**
 * /settings — alkalmazás-szintű beállítások (in-memory + GCODE_ROOT info).
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { GCODE_ROOT } from '../../config/gcodeRoot.js';
import { appSettings } from '../_state/appState.js';

export function createSettingsRouter(): Router {
  const router = Router();

  router.get('/settings', (_req: Request, res: Response) => {
    res.json({ ...appSettings, gcodeRoot: GCODE_ROOT });
  });

  router.post(
    '/settings',
    asyncHandler(async (req: Request, res: Response) => {
      const { bridgeHost, bridgePort, positionUpdateRate, statusUpdateRate } = req.body;

      if (bridgeHost && typeof bridgeHost === 'string') {
        appSettings.bridgeHost = bridgeHost;
      }
      if (
        bridgePort &&
        typeof bridgePort === 'number' &&
        bridgePort > 0 &&
        bridgePort < 65536
      ) {
        appSettings.bridgePort = bridgePort;
      }
      if (
        positionUpdateRate &&
        typeof positionUpdateRate === 'number' &&
        positionUpdateRate >= 1 &&
        positionUpdateRate <= 50
      ) {
        appSettings.positionUpdateRate = positionUpdateRate;
      }
      if (
        statusUpdateRate &&
        typeof statusUpdateRate === 'number' &&
        statusUpdateRate >= 1 &&
        statusUpdateRate <= 20
      ) {
        appSettings.statusUpdateRate = statusUpdateRate;
      }

      res.json({ success: true, settings: { ...appSettings, gcodeRoot: GCODE_ROOT } });
    })
  );

  return router;
}
