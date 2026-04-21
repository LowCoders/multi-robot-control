/**
 * /devices/:id/soft-limits, /devices/:id/grbl-settings*
 *
 * GRBL/grblHAL-specifikus konfigurációs végpontok.
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { requireDeviceId } from '../_helpers/requireParam.js';
import { validateNumber } from '../_helpers/validators.js';
import { DeviceManager } from '../../devices/DeviceManager.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { sendError } from '../_helpers/sendError.js';

export function createDeviceGrblRouter(deviceManager: DeviceManager): Router {
  const router = Router();

  router.get(
    '/devices/:id/soft-limits',
    asyncHandler(async (req: Request, res: Response) => {
      const data = await deviceManager.getSoftLimits(requireDeviceId(req));
      if (!data) {
        throw new NotFoundError('Eszköz nem található vagy soft limits nem támogatott');
      }
      res.json(data);
    })
  );

  router.post(
    '/devices/:id/soft-limits',
    asyncHandler(async (req: Request, res: Response) => {
      const enabledRaw = req.query.enabled;
      if (enabledRaw === undefined) {
        throw new ValidationError('Hiányzó enabled query paraméter (true/false)');
      }

      const enabled = String(enabledRaw).toLowerCase() === 'true';
      const success = await deviceManager.setSoftLimits(requireDeviceId(req), enabled);
      if (!success) {
        sendError(res, 500, 'Soft limits állítás sikertelen', { code: 'soft_limits_failed' });
        return;
      }
      res.json({ success: true, soft_limits_enabled: enabled });
    })
  );

  router.get(
    '/devices/:id/grbl-settings',
    asyncHandler(async (req: Request, res: Response) => {
      const settings = await deviceManager.getGrblSettings(requireDeviceId(req));
      if (!settings) {
        throw new NotFoundError('Eszköz nem található vagy GRBL settings nem elérhető');
      }
      res.json({ settings });
    })
  );

  router.post(
    '/devices/:id/grbl-settings/batch',
    asyncHandler(async (req: Request, res: Response) => {
      const settings = req.body?.settings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new ValidationError('Érvénytelen settings payload');
      }

      // Accept either numeric or string values: numeric covers $1/$4/$100…
      // (axis/limit/etc.), string covers networking parameters such as
      // $71 (hostname), $73 (AP SSID), $74 (AP password), $75 (STA SSID),
      // $76 (STA password), which grblHAL stores as strings.
      for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
        const isStringValue = typeof value === 'string';
        if (!/^\d+$/.test(key) || (!validateNumber(value) && !isStringValue)) {
          throw new ValidationError(`Érvénytelen GRBL setting: ${key}`);
        }
      }

      const success = await deviceManager.setGrblSettingsBatch(
        requireDeviceId(req),
        settings as Record<string, number | string>
      );
      if (!success) {
        sendError(res, 500, 'GRBL settings mentés sikertelen', { code: 'grbl_settings_failed' });
        return;
      }

      res.json({ success: true });
    })
  );

  return router;
}
