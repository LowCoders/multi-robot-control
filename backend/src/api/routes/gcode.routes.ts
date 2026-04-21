/**
 * /gcode/* — G-code fájlrendszer (a GCODE_ROOT-on belül).
 *
 * Biztonsági elvek:
 *   * `safeResolve` minden bemenetet validál (no symlink-escape, no path-traversal).
 *   * Új entitások nevét `validateName` szanitálja, kiterjesztést whitelist ellenőrzi.
 *   * Mentésnél a tartalom mérete max GCODE_MAX_FILE_SIZE.
 *   * Delete a GCODE_ROOT-ot nem engedi törölni.
 */

import { Router, Request, Response } from 'express';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { asyncHandler } from '../_helpers/asyncHandler.js';
import { sendPathError } from '../_helpers/gcodePathError.js';
import {
  GCODE_ROOT,
  GCODE_EXTENSIONS,
  GCODE_MAX_FILE_SIZE,
  isDirectory,
  isFile,
  isGcodeExtension,
  relativeFromRoot,
  safeResolve,
  validateName,
} from '../../config/gcodeRoot.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('api:gcode');

export function createGcodeRouter(): Router {
  const router = Router();

  router.get(
    '/gcode/file',
    asyncHandler(async (req: Request, res: Response) => {
      const filepath = req.query.path as string;
      if (!filepath) {
        res.status(400).json({ error: 'Fájl útvonal szükséges' });
        return;
      }

      let resolved: string;
      try {
        resolved = safeResolve(filepath, { mustExist: true });
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }

      if (!isFile(resolved)) {
        res.status(400).json({ error: 'A megadott útvonal nem fájl' });
        return;
      }
      if (!isGcodeExtension(resolved)) {
        res
          .status(400)
          .json({ error: `Nem engedélyezett fájlkiterjesztés (${GCODE_EXTENSIONS.join(', ')})` });
        return;
      }

      try {
        const content = await fs.readFile(resolved, 'utf-8');
        const lines = content.split('\n');

        res.json({
          filepath: resolved,
          relpath: relativeFromRoot(resolved),
          filename: path.basename(resolved),
          lines,
          totalLines: lines.length,
        });
      } catch (error) {
        log.error(`Failed to read G-code file: ${resolved}`, error);
        res.status(500).json({ error: 'Fájl olvasási hiba' });
      }
    })
  );

  router.get(
    '/gcode/list',
    asyncHandler(async (req: Request, res: Response) => {
      const reqDir = (req.query.dir as string) || GCODE_ROOT;

      let dir: string;
      try {
        dir = safeResolve(reqDir, { mustExist: false });
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }

      try {
        if (!existsSync(dir)) {
          res.json({
            dir,
            relpath: relativeFromRoot(dir),
            root: GCODE_ROOT,
            parent: null,
            files: [],
            dirs: [],
          });
          return;
        }
        if (!isDirectory(dir)) {
          res.status(400).json({ error: 'A megadott útvonal nem könyvtár' });
          return;
        }

        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files: Array<{ name: string; path: string; size: number; mtime: number }> = [];
        const dirs: Array<{ name: string; path: string }> = [];

        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue;
            dirs.push({ name: entry.name, path: full });
          } else if (entry.isFile()) {
            if (!isGcodeExtension(entry.name)) continue;
            try {
              const stat = await fs.stat(full);
              files.push({
                name: entry.name,
                path: full,
                size: stat.size,
                mtime: stat.mtimeMs,
              });
            } catch {
              // Ignore files we cannot stat
            }
          }
        }

        dirs.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => b.mtime - a.mtime);

        const parent = path.dirname(dir);
        const canGoUp =
          dir !== GCODE_ROOT &&
          (parent === GCODE_ROOT || parent.startsWith(GCODE_ROOT + path.sep));

        res.json({
          dir,
          relpath: relativeFromRoot(dir),
          root: GCODE_ROOT,
          parent: canGoUp ? parent : null,
          files,
          dirs,
        });
      } catch (error) {
        log.error(`Failed to list G-code dir: ${dir}`, error);
        res.status(500).json({ error: 'Könyvtár olvasási hiba' });
      }
    })
  );

  router.post(
    '/gcode/file',
    asyncHandler(async (req: Request, res: Response) => {
      const { path: filepath, content, overwrite } = req.body as {
        path?: string;
        content?: string;
        overwrite?: boolean;
      };

      if (!filepath || typeof filepath !== 'string') {
        res.status(400).json({ error: 'Fájl útvonal szükséges' });
        return;
      }
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'Tartalom szükséges (string)' });
        return;
      }
      if (Buffer.byteLength(content, 'utf-8') > GCODE_MAX_FILE_SIZE) {
        res.status(413).json({ error: `Túl nagy tartalom (max ${GCODE_MAX_FILE_SIZE} bájt)` });
        return;
      }

      let resolved: string;
      try {
        resolved = safeResolve(filepath, { mustExist: false });
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }

      const basename = path.basename(resolved);
      try {
        validateName(basename);
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }
      if (!isGcodeExtension(basename)) {
        res
          .status(400)
          .json({ error: `Nem engedélyezett fájlkiterjesztés (${GCODE_EXTENSIONS.join(', ')})` });
        return;
      }

      try {
        const exists = existsSync(resolved);
        if (exists) {
          if (!isFile(resolved)) {
            res.status(400).json({ error: 'A megadott útvonal nem fájl' });
            return;
          }
          if (overwrite !== true) {
            res.status(409).json({ error: 'A fájl már létezik (overwrite=true szükséges)' });
            return;
          }
        }

        const dir = path.dirname(resolved);
        if (!existsSync(dir)) {
          await fs.mkdir(dir, { recursive: true });
        }

        const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        await fs.writeFile(resolved, normalized, 'utf-8');

        const stat = await fs.stat(resolved);
        res.json({
          success: true,
          filepath: resolved,
          relpath: relativeFromRoot(resolved),
          filename: path.basename(resolved),
          size: stat.size,
          mtime: stat.mtimeMs,
        });
      } catch (error) {
        log.error(`Failed to save G-code file: ${resolved}`, error);
        res.status(500).json({ error: 'Fájl mentési hiba' });
      }
    })
  );

  router.post(
    '/gcode/mkdir',
    asyncHandler(async (req: Request, res: Response) => {
      const { parent, name } = req.body as { parent?: string; name?: string };

      if (!parent || typeof parent !== 'string') {
        res.status(400).json({ error: 'Szülő útvonal szükséges' });
        return;
      }
      try {
        validateName(name);
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }

      let parentResolved: string;
      try {
        parentResolved = safeResolve(parent, { mustExist: true });
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }
      if (!isDirectory(parentResolved)) {
        res.status(400).json({ error: 'A szülő útvonal nem könyvtár' });
        return;
      }

      const target = path.join(parentResolved, name as string);
      let resolvedTarget: string;
      try {
        resolvedTarget = safeResolve(target, { mustExist: false });
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }

      if (existsSync(resolvedTarget)) {
        res.status(409).json({ error: 'Már létezik egy ilyen nevű elem' });
        return;
      }

      try {
        await fs.mkdir(resolvedTarget);
        res.status(201).json({
          success: true,
          path: resolvedTarget,
          relpath: relativeFromRoot(resolvedTarget),
          name,
        });
      } catch (error) {
        log.error(`Failed to mkdir: ${resolvedTarget}`, error);
        res.status(500).json({ error: 'Könyvtár létrehozási hiba' });
      }
    })
  );

  router.post(
    '/gcode/delete',
    asyncHandler(async (req: Request, res: Response) => {
      const { path: target, recursive } = req.body as {
        path?: string;
        recursive?: boolean;
      };

      if (!target || typeof target !== 'string') {
        res.status(400).json({ error: 'Útvonal szükséges' });
        return;
      }

      let resolved: string;
      try {
        resolved = safeResolve(target, { mustExist: true });
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }

      if (resolved === GCODE_ROOT) {
        res.status(403).json({ error: 'A gyökérkönyvtár nem törölhető' });
        return;
      }

      try {
        if (isDirectory(resolved)) {
          if (recursive !== true) {
            const entries = await fs.readdir(resolved);
            if (entries.length > 0) {
              res.status(409).json({ error: 'A könyvtár nem üres (recursive=true szükséges)' });
              return;
            }
            await fs.rmdir(resolved);
          } else {
            await fs.rm(resolved, { recursive: true, force: false });
          }
        } else if (isFile(resolved)) {
          if (!isGcodeExtension(resolved)) {
            res.status(403).json({ error: 'Csak G-code fájlok törölhetők' });
            return;
          }
          await fs.unlink(resolved);
        } else {
          res.status(400).json({ error: 'Ismeretlen fájltípus' });
          return;
        }

        res.json({
          success: true,
          path: resolved,
          relpath: relativeFromRoot(resolved),
        });
      } catch (error) {
        log.error(`Failed to delete: ${resolved}`, error);
        res.status(500).json({ error: 'Törlési hiba' });
      }
    })
  );

  router.post(
    '/gcode/rename',
    asyncHandler(async (req: Request, res: Response) => {
      const { path: target, newName } = req.body as { path?: string; newName?: string };

      if (!target || typeof target !== 'string') {
        res.status(400).json({ error: 'Útvonal szükséges' });
        return;
      }
      try {
        validateName(newName);
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }

      let resolved: string;
      try {
        resolved = safeResolve(target, { mustExist: true });
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }
      if (resolved === GCODE_ROOT) {
        res.status(403).json({ error: 'A gyökérkönyvtár nem nevezhető át' });
        return;
      }

      const isFileTarget = isFile(resolved);
      if (isFileTarget && !isGcodeExtension(newName as string)) {
        res
          .status(400)
          .json({ error: `Nem engedélyezett fájlkiterjesztés (${GCODE_EXTENSIONS.join(', ')})` });
        return;
      }

      const newPath = path.join(path.dirname(resolved), newName as string);
      let resolvedNew: string;
      try {
        resolvedNew = safeResolve(newPath, { mustExist: false });
      } catch (err) {
        if (sendPathError(res, err)) return;
        throw err;
      }
      if (existsSync(resolvedNew)) {
        res.status(409).json({ error: 'Már létezik egy ilyen nevű elem' });
        return;
      }

      try {
        await fs.rename(resolved, resolvedNew);
        res.json({
          success: true,
          oldPath: resolved,
          path: resolvedNew,
          relpath: relativeFromRoot(resolvedNew),
          name: newName,
        });
      } catch (error) {
        log.error(`Failed to rename: ${resolved} -> ${resolvedNew}`, error);
        res.status(500).json({ error: 'Átnevezési hiba' });
      }
    })
  );

  return router;
}
