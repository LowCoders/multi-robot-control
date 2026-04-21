/**
 * /devices/* (alap CRUD + state + control + connect)
 *
 * Részletesen:
 *   - CRUD: GET /devices, GET /devices/:id, POST /devices
 *   - State: GET /devices/:id/status, GET /devices/:id/capabilities
 *   - Control: GET/POST control state, POST request, POST release
 *   - Connect: POST /devices/:id/connect, POST /devices/:id/disconnect
 *
 * A grbl/soft-limits, machine-config/gcode, motion, robot, diagnostics
 * endpointokat külön routerek kezelik (`deviceGrbl`, `deviceConfig`,
 * `deviceMotion`, `deviceRobot`, `deviceDiagnostics`).
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { requireDeviceId } from '../_helpers/requireParam.js';
import { DeviceManager } from '../../devices/DeviceManager.js';
import { StateManager } from '../../state/StateManager.js';
import { NotFoundError, ValidationError, ConflictError } from '../../errors/AppError.js';
import { sendError } from '../_helpers/sendError.js';

export function createDevicesRouter(
  deviceManager: DeviceManager,
  stateManager: StateManager
): Router {
  const router = Router();

  router.get('/devices', (_req: Request, res: Response) => {
    const devices = deviceManager.getDevices();
    res.json({ devices });
  });

  router.get('/devices/:id', (req: Request, res: Response) => {
    const device = deviceManager.getDevice(requireDeviceId(req));
    if (!device) throw new NotFoundError('Eszköz nem található');
    res.json(device);
  });

  router.post(
    '/devices',
    asyncHandler(async (req: Request, res: Response) => {
      const { id, name, type, driver, enabled, config } = req.body;

      if (!id || !name || !type || !driver) {
        throw new ValidationError('Hiányzó mezők: id, name, type, driver kötelező');
      }
      if (deviceManager.getDevice(id)) {
        throw new ConflictError('Eszköz már létezik ezzel az ID-val');
      }

      const success = await deviceManager.addDevice({
        id,
        name,
        type,
        driver,
        enabled: enabled !== false,
        config: config || {},
      });

      if (success) {
        res.status(201).json({ success: true, message: 'Eszköz sikeresen hozzáadva' });
      } else {
        sendError(res, 500, 'Nem sikerült hozzáadni az eszközt', { code: 'add_device_failed' });
      }
    })
  );

  router.get(
    '/devices/:id/status',
    asyncHandler(async (req: Request, res: Response) => {
      const status = await deviceManager.getDeviceStatus(requireDeviceId(req));
      if (!status) throw new NotFoundError('Eszköz nem található');
      res.json(status);
    })
  );

  router.get(
    '/devices/:id/capabilities',
    asyncHandler(async (req: Request, res: Response) => {
      const capabilities = await deviceManager.getDeviceCapabilities(requireDeviceId(req));
      if (!capabilities) throw new NotFoundError('Eszköz nem található');
      res.json(capabilities);
    })
  );

  router.get(
    '/devices/:id/control/state',
    asyncHandler(async (req: Request, res: Response) => {
      const control = await deviceManager.getDeviceControlState(requireDeviceId(req));
      if (!control) throw new NotFoundError('Control state nem érhető el');
      res.json(control);
    })
  );

  router.post(
    '/devices/:id/control/request',
    asyncHandler(async (req: Request, res: Response) => {
      const deviceId = requireDeviceId(req);
      const requestedOwnerRaw = req.body?.requested_owner;
      if (requestedOwnerRaw !== 'host' && requestedOwnerRaw !== 'panel') {
        throw new ValidationError('requested_owner csak host vagy panel lehet');
      }
      const result = await deviceManager.requestControl(
        deviceId,
        requestedOwnerRaw,
        req.body?.requested_by || 'api_request'
      );
      if (!result) {
        sendError(res, 500, 'Control request sikertelen', { code: 'control_request_failed' });
        return;
      }
      if (result.state) {
        if (result.granted) {
          stateManager.broadcastControlState(deviceId, result.state);
        } else {
          stateManager.broadcastControlDenied(
            deviceId,
            result.reason || 'denied',
            result.state
          );
        }
      }
      res.json(result);
    })
  );

  router.post(
    '/devices/:id/control/release',
    asyncHandler(async (req: Request, res: Response) => {
      const deviceId = requireDeviceId(req);
      const result = await deviceManager.releaseControl(
        deviceId,
        req.body?.requested_by || 'api_release'
      );
      if (!result) {
        sendError(res, 500, 'Control release sikertelen', { code: 'control_release_failed' });
        return;
      }
      if (result.state) {
        stateManager.broadcastControlState(deviceId, result.state);
      }
      res.json(result);
    })
  );

  router.post(
    '/devices/:id/connect',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.connectDevice(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/disconnect',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.disconnectDevice(requireDeviceId(req));
      res.json({ success });
    })
  );

  return router;
}
