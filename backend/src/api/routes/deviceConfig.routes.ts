/**
 * /devices/:id/machine-config, /devices/:id/reload-config, /devices/:id/gcode
 *
 * Eszköz-konfigurációs (file-alapú machine-config) és gcode olvasó végpontok.
 */

import { Router, Request, Response } from 'express';
import { promises as fs, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { requireDeviceId } from '../_helpers/requireParam.js';
import { getDefaultMachineConfig } from '../_helpers/machineConfig.js';
import { DeviceManager } from '../../devices/DeviceManager.js';
import { StateManager } from '../../state/StateManager.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { sendError } from '../_helpers/sendError.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('api:deviceConfig');

const MACHINE_CONFIG_DIR = path.join(process.cwd(), '..', 'config', 'machines');

if (!existsSync(MACHINE_CONFIG_DIR)) {
  mkdirSync(MACHINE_CONFIG_DIR, { recursive: true });
}

export function createDeviceConfigRouter(
  deviceManager: DeviceManager,
  stateManager: StateManager
): Router {
  const router = Router();

  router.get(
    '/devices/:id/machine-config',
    asyncHandler(async (req: Request, res: Response) => {
      const deviceId = requireDeviceId(req);
      const device = deviceManager.getDevice(deviceId);
      const configPath = path.join(MACHINE_CONFIG_DIR, `${deviceId}.json`);

      try {
        if (existsSync(configPath)) {
          const content = await fs.readFile(configPath, 'utf-8');
          res.json(JSON.parse(content));
        } else {
          const deviceType = device?.type ?? 'cnc_mill';
          const deviceName = device?.name ?? deviceId;
          const defaultConfig = getDefaultMachineConfig(deviceType, deviceId, deviceName);
          res.json(defaultConfig);
        }
      } catch (error) {
        log.error('Error reading machine config:', error);
        sendError(res, 500, 'Konfiguráció olvasási hiba', { code: 'machine_config_read_failed' });
      }
    })
  );

  router.put(
    '/devices/:id/machine-config',
    asyncHandler(async (req: Request, res: Response) => {
      const deviceId = requireDeviceId(req);
      const config = req.body;

      if (!config || !config.axes || !config.workEnvelope) {
        throw new ValidationError('Érvénytelen konfiguráció: axes és workEnvelope kötelező');
      }

      const configPath = path.join(MACHINE_CONFIG_DIR, `${deviceId}.json`);

      try {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        res.json({ success: true, message: 'Konfiguráció mentve' });
      } catch (error) {
        log.error('Error saving machine config:', error);
        sendError(res, 500, 'Konfiguráció mentési hiba', { code: 'machine_config_write_failed' });
      }
    })
  );

  router.post(
    '/devices/:id/reload-config',
    asyncHandler(async (req: Request, res: Response) => {
      const deviceId = requireDeviceId(req);

      try {
        const result = await deviceManager.reloadConfig(deviceId);

        const capabilities = await deviceManager.getDeviceCapabilities(deviceId);
        if (capabilities) {
          stateManager.broadcastCapabilities(deviceId, capabilities);
        }

        res.json(result);
      } catch (error) {
        log.error('Config reload error:', error);
        sendError(res, 500, 'Konfiguráció újratöltési hiba', { code: 'reload_config_failed' });
      }
    })
  );

  router.get(
    '/devices/:id/gcode',
    asyncHandler(async (req: Request, res: Response) => {
      const deviceId = requireDeviceId(req);
      const status = await deviceManager.getDeviceStatus(deviceId);
      if (!status) throw new NotFoundError('Eszköz nem található');
      if (!status.current_file) throw new NotFoundError('Nincs betöltött fájl');

      try {
        const content = await fs.readFile(status.current_file, 'utf-8');
        const lines = content.split('\n');

        res.json({
          filepath: status.current_file,
          filename: status.current_file.split('/').pop(),
          lines,
          totalLines: lines.length,
          currentLine: status.current_line || 0,
          state: status.state,
          progress: status.progress || 0,
        });
      } catch (error) {
        log.error('Failed to read G-code file:', error);
        sendError(res, 500, 'Fájl olvasási hiba', { code: 'gcode_read_failed' });
      }
    })
  );

  return router;
}
