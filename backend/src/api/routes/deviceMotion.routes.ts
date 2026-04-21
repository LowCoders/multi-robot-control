/**
 * /devices/:id/{home,jog,gcode,load,run,run-buffer,pause,resume,stop,reset,*-override}
 *
 * "Motion" = aktív mozgatás / vezérlés. A `run-buffer` itt él, mert a
 * scratch-fájl mentés is része a mozgásindítási folyamatnak.
 */

import { Router, Request, Response } from 'express';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { requireDeviceId } from '../_helpers/requireParam.js';
import {
  validateAxis,
  validateAxesArray,
  validateNumber,
  validatePercent,
  validateString,
} from '../_helpers/validators.js';
import { ValidationError } from '../../errors/AppError.js';
import {
  GCODE_ROOT,
  GCODE_MAX_FILE_SIZE,
  relativeFromRoot,
} from '../../config/gcodeRoot.js';
import { DeviceManager } from '../../devices/DeviceManager.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('api:device-motion');

export function createDeviceMotionRouter(deviceManager: DeviceManager): Router {
  const router = Router();

  router.post(
    '/devices/:id/home',
    asyncHandler(async (req: Request, res: Response) => {
      const { axes } = req.body;
      if (axes !== undefined && !validateAxesArray(axes)) {
        throw new ValidationError('Érvénytelen tengelyek. Használj: X, Y, Z, A, B, C');
      }
      const success = await deviceManager.home(requireDeviceId(req), axes);
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/jog',
    asyncHandler(async (req: Request, res: Response) => {
      const { axis, distance, feed_rate } = req.body;
      if (!validateAxis(axis)) {
        throw new ValidationError('Érvénytelen tengely. Használj: X, Y, Z, A, B, C');
      }
      if (!validateNumber(distance)) {
        throw new ValidationError('Érvénytelen távolság érték');
      }
      if (!validateNumber(feed_rate) || feed_rate <= 0) {
        throw new ValidationError('Érvénytelen feed rate (pozitív szám kell)');
      }
      const success = await deviceManager.jog(requireDeviceId(req), axis, distance, feed_rate);
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/jog/stop',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.jogStop(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/gcode',
    asyncHandler(async (req: Request, res: Response) => {
      const { gcode } = req.body;
      if (!validateString(gcode)) {
        throw new ValidationError('Érvénytelen G-code (nem lehet üres)');
      }
      const response = await deviceManager.sendGCode(requireDeviceId(req), gcode);
      res.json({ response });
    })
  );

  router.post(
    '/devices/:id/load',
    asyncHandler(async (req: Request, res: Response) => {
      const { filepath } = req.body;
      if (!validateString(filepath)) {
        throw new ValidationError('Érvénytelen fájl útvonal');
      }
      const success = await deviceManager.loadFile(requireDeviceId(req), filepath);
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/run',
    asyncHandler(async (req: Request, res: Response) => {
      const fromLineRaw = req.query.from_line as string;
      const fromLine = fromLineRaw ? parseInt(fromLineRaw, 10) : 0;
      if (fromLineRaw && (isNaN(fromLine) || fromLine < 0)) {
        throw new ValidationError('Érvénytelen from_line (nem-negatív egész szám kell)');
      }
      const success = await deviceManager.run(requireDeviceId(req), fromLine);
      res.json({ success });
    })
  );

  /**
   * Atomi „futtasd a buffer aktuális tartalmát" végpont.
   *
   * Egyedi nevű scratch fájlba menti a body content-jét, takarítja a régi
   * scratch fájlokat, betölti és elindítja az eszközön.
   */
  router.post(
    '/devices/:id/run-buffer',
    asyncHandler(async (req: Request, res: Response) => {
      const deviceId = requireDeviceId(req);
      const { content, fromLine } = req.body as { content?: string; fromLine?: number };

      if (typeof content !== 'string') {
        throw new ValidationError('Tartalom szükséges (string)');
      }
      if (Buffer.byteLength(content, 'utf-8') > GCODE_MAX_FILE_SIZE) {
        res.status(413).json({ error: `Túl nagy tartalom (max ${GCODE_MAX_FILE_SIZE} bájt)` });
        return;
      }
      const fromLineNum =
        typeof fromLine === 'number' && fromLine >= 0 ? Math.floor(fromLine) : 0;

      const safeId = deviceId.replace(/[^A-Za-z0-9._\-+]/g, '_') || 'device';
      const scratchDir = path.join(GCODE_ROOT, '.scratch');
      const scratchName = `${safeId}-${Date.now()}.nc`;
      const scratchAbs = path.join(scratchDir, scratchName);

      try {
        if (!existsSync(scratchDir)) {
          await fs.mkdir(scratchDir, { recursive: true });
        }
        const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        await fs.writeFile(scratchAbs, normalized, 'utf-8');

        try {
          const entries = await fs.readdir(scratchDir);
          const prefix = `${safeId}-`;
          await Promise.all(
            entries
              .filter((e) => e !== scratchName && e.startsWith(prefix) && e.endsWith('.nc'))
              .map((e) =>
                fs.unlink(path.join(scratchDir, e)).catch(() => {
                  // takarítás, hibát ignoráljuk
                })
              )
          );
        } catch {
          // olvasási hibát is ignoráljuk
        }

        const loadOk = await deviceManager.loadFile(deviceId, scratchAbs);
        if (!loadOk) {
          res
            .status(502)
            .json({ error: 'A vezérlő nem tudta betölteni a scratch fájlt', filepath: scratchAbs });
          return;
        }

        const runOk = await deviceManager.run(deviceId, fromLineNum);
        if (!runOk) {
          res
            .status(502)
            .json({ error: 'A vezérlő nem indította el a programot', filepath: scratchAbs });
          return;
        }

        res.json({
          success: true,
          filepath: scratchAbs,
          relpath: relativeFromRoot(scratchAbs),
          size: Buffer.byteLength(normalized, 'utf-8'),
        });
      } catch (error) {
        log.error(`run-buffer hiba (${deviceId}):`, error);
        res.status(500).json({ error: 'Belső hiba a run-buffer feldolgozása során' });
      }
    })
  );

  router.post(
    '/devices/:id/pause',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.pause(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/resume',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.resume(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/stop',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.stop(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/reset',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await deviceManager.reset(requireDeviceId(req));
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/feed-override',
    asyncHandler(async (req: Request, res: Response) => {
      const { percent } = req.body;
      if (!validatePercent(percent)) {
        throw new ValidationError('Érvénytelen százalék (0-200 közötti szám kell)');
      }
      const success = await deviceManager.setFeedOverride(requireDeviceId(req), percent);
      res.json({ success });
    })
  );

  router.post(
    '/devices/:id/spindle-override',
    asyncHandler(async (req: Request, res: Response) => {
      const { percent } = req.body;
      if (!validatePercent(percent)) {
        throw new ValidationError('Érvénytelen százalék (0-200 közötti szám kell)');
      }
      const success = await deviceManager.setSpindleOverride(requireDeviceId(req), percent);
      res.json({ success });
    })
  );

  return router;
}
