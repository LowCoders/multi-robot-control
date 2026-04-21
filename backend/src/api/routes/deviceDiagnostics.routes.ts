/**
 * /devices/:id/{diagnostics,firmware-probe,endstop-test,motion-test,test-progress,cancel-test}
 *
 * Board / firmware diagnosztika és motorhangolási tesztek vezérlése.
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { requireDeviceId } from '../_helpers/requireParam.js';
import { DeviceManager } from '../../devices/DeviceManager.js';

export function createDeviceDiagnosticsRouter(deviceManager: DeviceManager): Router {
  const router = Router();

  router.post(
    '/devices/:id/diagnostics',
    asyncHandler(async (req: Request, res: Response) => {
      const moveTest = req.body?.move_test === true;
      const result = await deviceManager.runDiagnostics(requireDeviceId(req), moveTest);
      res.json(result);
    })
  );

  router.post(
    '/devices/:id/firmware-probe',
    asyncHandler(async (req: Request, res: Response) => {
      const result = await deviceManager.runFirmwareProbe(requireDeviceId(req));
      res.json(result);
    })
  );

  router.post(
    '/devices/:id/endstop-test',
    asyncHandler(async (req: Request, res: Response) => {
      const stepSize = typeof req.body?.step_size === 'number' ? req.body.step_size : 5.0;
      const speed = typeof req.body?.speed === 'number' ? req.body.speed : 15;
      const maxAngle = typeof req.body?.max_angle === 'number' ? req.body.max_angle : 200.0;
      const result = await deviceManager.runEndstopTest(
        requireDeviceId(req),
        stepSize,
        speed,
        maxAngle
      );
      res.json(result);
    })
  );

  router.post(
    '/devices/:id/motion-test',
    asyncHandler(async (req: Request, res: Response) => {
      const testAngle = typeof req.body?.test_angle === 'number' ? req.body.test_angle : 30.0;
      const result = await deviceManager.runMotionTest(requireDeviceId(req), testAngle);
      res.json(result);
    })
  );

  router.get(
    '/devices/:id/test-progress',
    asyncHandler(async (req: Request, res: Response) => {
      const after = parseInt(req.query.after as string) || 0;
      const result = await deviceManager.getTestProgress(requireDeviceId(req), after);
      res.json(result);
    })
  );

  router.post(
    '/devices/:id/cancel-test',
    asyncHandler(async (req: Request, res: Response) => {
      const result = await deviceManager.cancelTest(requireDeviceId(req));
      res.json(result);
    })
  );

  return router;
}
