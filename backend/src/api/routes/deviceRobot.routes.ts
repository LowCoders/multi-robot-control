/**
 * /devices/:id/{gripper,sucker,enable,disable,calibrate,teach,*}
 *
 * Robot-arm specifikus végpontok.
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { requireDeviceId } from '../_helpers/requireParam.js';
import { DeviceManager } from '../../devices/DeviceManager.js';

export function createDeviceRobotRouter(deviceManager: DeviceManager): Router {
  const router = Router();

  router.post(
    '/devices/:id/gripper/on',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.gripperOn(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/gripper/off',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.gripperOff(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/sucker/on',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.suckerOn(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/sucker/off',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.suckerOff(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/enable',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.robotEnable(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/disable',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.robotDisable(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/calibrate',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.robotCalibrate(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/calibrate-limits',
    asyncHandler(async (req: Request, res: Response) => {
      const options = req.body || {};
      const result = await deviceManager.calibrateLimits(requireDeviceId(req), options);
      res.json(result);
    })
  );

  router.get(
    '/devices/:id/calibration-status',
    asyncHandler(async (req: Request, res: Response) => {
      const status = await deviceManager.getCalibrationStatus(requireDeviceId(req));
      res.json(status);
    })
  );

  router.post(
    '/devices/:id/calibration-stop',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.stopCalibration(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/save-calibration',
    asyncHandler(async (req: Request, res: Response) => {
      const result = await deviceManager.saveCalibration(requireDeviceId(req), req.body);
      res.json(result);
    })
  );

  router.post(
    '/devices/:id/teach/record',
    asyncHandler(async (req: Request, res: Response) => {
      const result = await deviceManager.teachRecord(requireDeviceId(req));
      res.json(result || { success: false });
    })
  );

  router.post(
    '/devices/:id/teach/play',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.teachPlay(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/teach/clear',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.teachClear(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.get(
    '/devices/:id/teach/positions',
    asyncHandler(async (req: Request, res: Response) => {
      const positions = await deviceManager.teachGetPositions(requireDeviceId(req));
      res.json({ positions });
    })
  );

  return router;
}
