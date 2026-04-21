/**
 * /config/devices-yaml — devices.yaml raw nézet és enable/disable persist.
 */

import { Router, Request, Response } from 'express';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { parseDocument, isMap, isSeq } from 'yaml';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { DeviceManager } from '../../devices/DeviceManager.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('api:devices-yaml');

const DEVICES_YAML_PATH = path.join(process.cwd(), '..', 'config', 'devices.yaml');

export function createDevicesYamlRouter(deviceManager: DeviceManager): Router {
  const router = Router();

  router.get(
    '/config/devices-yaml',
    asyncHandler(async (_req: Request, res: Response) => {
      if (!existsSync(DEVICES_YAML_PATH)) {
        res.status(404).json({ error: 'devices.yaml nem található', path: DEVICES_YAML_PATH });
        return;
      }
      const raw = await fs.readFile(DEVICES_YAML_PATH, 'utf-8');
      let entries: Array<{
        id: string;
        name: string;
        type: string;
        driver: string;
        enabled: boolean;
        simulated: boolean;
      }> = [];
      try {
        const doc = parseDocument(raw);
        const seq = doc.get('devices');
        if (isSeq(seq)) {
          for (const item of seq.items) {
            if (!isMap(item)) continue;
            const js = item.toJS(doc) as Record<string, unknown>;
            const id = typeof js.id === 'string' ? js.id : '';
            if (!id) continue;
            entries.push({
              id,
              name: typeof js.name === 'string' ? js.name : id,
              type: typeof js.type === 'string' ? js.type : 'unknown',
              driver: typeof js.driver === 'string' ? js.driver : 'unknown',
              enabled: js.enabled !== false,
              simulated: js.simulated === true,
            });
          }
        }
      } catch (err) {
        entries = [];
        log.error('devices.yaml parse hiba:', err);
      }
      res.json({ raw, path: DEVICES_YAML_PATH, devices: entries });
    })
  );

  router.get(
    '/config/devices-yaml/:id',
    asyncHandler(async (req: Request, res: Response) => {
      if (!existsSync(DEVICES_YAML_PATH)) {
        res.status(404).json({ error: 'devices.yaml nem található' });
        return;
      }
      const raw = await fs.readFile(DEVICES_YAML_PATH, 'utf-8');
      const doc = parseDocument(raw);
      const seq = doc.get('devices');
      if (!isSeq(seq)) {
        res.status(500).json({ error: 'Hibás YAML struktúra' });
        return;
      }
      for (const item of seq.items) {
        if (!isMap(item)) continue;
        if (item.get('id') !== req.params.id) continue;
        const js = item.toJS(doc) as Record<string, unknown>;
        res.json(js);
        return;
      }
      res.status(404).json({ error: `Eszköz nem található a YAML-ben: ${req.params.id}` });
    })
  );

  router.patch(
    '/config/devices-yaml/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id;
      const patch = (req.body ?? {}) as {
        name?: unknown;
        driver?: unknown;
        type?: unknown;
        simulated?: unknown;
        config?: unknown;
      };

      if (!existsSync(DEVICES_YAML_PATH)) {
        res.status(404).json({ error: 'devices.yaml nem található' });
        return;
      }

      const raw = await fs.readFile(DEVICES_YAML_PATH, 'utf-8');
      const doc = parseDocument(raw);
      const seq = doc.get('devices');
      if (!isSeq(seq)) {
        res.status(500).json({ error: 'Hibás YAML struktúra' });
        return;
      }

      let updated = false;
      for (const item of seq.items) {
        if (!isMap(item)) continue;
        if (item.get('id') !== id) continue;

        if (typeof patch.name === 'string' && patch.name.length > 0) {
          item.set('name', patch.name);
        }
        if (typeof patch.driver === 'string' && patch.driver.length > 0) {
          item.set('driver', patch.driver);
        }
        if (typeof patch.type === 'string' && patch.type.length > 0) {
          item.set('type', patch.type);
        }
        if (typeof patch.simulated === 'boolean') {
          item.set('simulated', patch.simulated);
        }
        if (
          patch.config !== undefined &&
          patch.config !== null &&
          typeof patch.config === 'object'
        ) {
          item.set('config', patch.config);
        }
        updated = true;
        break;
      }

      if (!updated) {
        res.status(404).json({ error: `Eszköz nem található a YAML-ben: ${id}` });
        return;
      }

      await fs.writeFile(DEVICES_YAML_PATH, doc.toString(), 'utf-8');
      res.json({ success: true, id });
    })
  );

  router.post(
    '/config/devices-yaml/enable',
    asyncHandler(async (req: Request, res: Response) => {
      const { id, enabled } = req.body as { id?: string; enabled?: boolean };
      if (!id || typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'id (string) és enabled (boolean) kötelező' });
        return;
      }
      if (!existsSync(DEVICES_YAML_PATH)) {
        res.status(404).json({ error: 'devices.yaml nem található' });
        return;
      }

      const raw = await fs.readFile(DEVICES_YAML_PATH, 'utf-8');
      const doc = parseDocument(raw);
      const seq = doc.get('devices');
      if (!isSeq(seq)) {
        res.status(500).json({ error: 'Hibás YAML struktúra: a devices kulcs nem lista' });
        return;
      }

      let foundEntry: {
        id: string;
        name: string;
        type: string;
        driver: string;
        config: Record<string, unknown>;
      } | null = null;

      for (const item of seq.items) {
        if (!isMap(item)) continue;
        if (item.get('id') !== id) continue;
        item.set('enabled', enabled);
        const js = item.toJS(doc) as Record<string, unknown>;
        foundEntry = {
          id: String(js.id ?? id),
          name: String(js.name ?? id),
          type: String(js.type ?? 'unknown'),
          driver: String(js.driver ?? 'simulated'),
          config:
            js.config && typeof js.config === 'object'
              ? (js.config as Record<string, unknown>)
              : {},
        };
        break;
      }

      if (!foundEntry) {
        res.status(404).json({ error: `Eszköz nem található a YAML-ben: ${id}` });
        return;
      }

      await fs.writeFile(DEVICES_YAML_PATH, doc.toString(), 'utf-8');

      let bridgeLoaded: boolean | null = null;
      let bridgeError: string | null = null;
      if (enabled) {
        const existing = deviceManager.getDevice(id);
        if (!existing) {
          try {
            bridgeLoaded = await deviceManager.addDevice({
              id: foundEntry.id,
              name: foundEntry.name,
              type: foundEntry.type,
              driver: foundEntry.driver,
              enabled: true,
              config: foundEntry.config,
            });
          } catch (err) {
            bridgeError = err instanceof Error ? err.message : String(err);
          }
        } else {
          bridgeLoaded = true;
        }
      }

      res.json({ success: true, id, enabled, bridgeLoaded, bridgeError });
    })
  );

  return router;
}
