/**
 * G-code gyökérkönyvtár konfiguráció és biztonságos útvonal-feloldás.
 *
 * A gyökeret a `.env` fájl `GCODE_ROOT_DIR` változója határozza meg. Az
 * érték lehet abszolút (pl. `/srv/nc_files`) vagy relatív; relatív útvonal
 * esetén a workspace gyökeréhez (a backend cwd egy szinttel feljebb)
 * képest értelmezzük.
 */

import { realpathSync, existsSync, mkdirSync, statSync } from 'fs';
import path from 'path';

const WORKSPACE_ROOT = path.resolve(process.cwd(), '..');

function resolveConfiguredRoot(): string {
  const raw = (process.env.GCODE_ROOT_DIR ?? '').trim() || './gcode';
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(WORKSPACE_ROOT, raw);
  return path.normalize(absolute);
}

function ensureRootExists(dir: string): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // realpath az indulás után, hogy symlinkeket is feloldjuk
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

export const GCODE_ROOT: string = ensureRootExists(resolveConfiguredRoot());

export const GCODE_EXTENSIONS = ['.nc', '.gcode', '.ngc', '.tap', '.txt'] as const;

// 5 MB max fájlméret mentésnél
export const GCODE_MAX_FILE_SIZE = 5 * 1024 * 1024;

// Fájl- és könyvtárnév alap szanitálás: csak látható ASCII, nincs '/'.
const SAFE_NAME_RE = /^[A-Za-z0-9._\-+ ()\[\]]{1,255}$/;
const FORBIDDEN_NAMES = new Set(['', '.', '..']);

export class GcodePathError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Validálja, hogy a megadott név önállóan biztonságos: nem tartalmaz
 * elérési-út szeparátort, null bájtot, és értelmes karakterekből áll.
 */
export function validateName(name: unknown): asserts name is string {
  if (typeof name !== 'string') {
    throw new GcodePathError('Érvénytelen név (string szükséges)');
  }
  if (FORBIDDEN_NAMES.has(name)) {
    throw new GcodePathError('Érvénytelen név');
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new GcodePathError('A név nem tartalmazhat elérési-út szeparátort');
  }
  if (!SAFE_NAME_RE.test(name)) {
    throw new GcodePathError('A név érvénytelen karaktereket tartalmaz');
  }
}

/**
 * Biztonságosan feloldja az input útvonalat a GCODE_ROOT-on belülre.
 * Ha az útvonal létezik, realpath-ot használunk, hogy a symlinkek mögé
 * is belássunk és kiszűrjük a "kifelé mutató" linkeket.
 *
 * Bemenet lehet:
 *  - abszolút útvonal a GCODE_ROOT alatt
 *  - relatív útvonal (a GCODE_ROOT-hoz képest értelmezzük)
 *
 * Visszaadja az absolute, normalizált útvonalat.
 */
export function safeResolve(inputPath: unknown, opts: { mustExist?: boolean } = {}): string {
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new GcodePathError('Útvonal szükséges');
  }
  if (inputPath.includes('\0')) {
    throw new GcodePathError('Érvénytelen útvonal');
  }

  const candidate = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(GCODE_ROOT, inputPath);

  // Először a string-szintű prefix ellenőrzés (feloldás előtt is szigorú)
  const rootWithSep = GCODE_ROOT.endsWith(path.sep) ? GCODE_ROOT : GCODE_ROOT + path.sep;
  if (candidate !== GCODE_ROOT && !candidate.startsWith(rootWithSep)) {
    throw new GcodePathError('Hozzáférés megtagadva (a GCODE_ROOT-on kívül)', 403);
  }

  // Ha a fájl/könyvtár létezik, realpath-ot használunk a symlink-escape ellen
  if (existsSync(candidate)) {
    let resolved: string;
    try {
      resolved = realpathSync(candidate);
    } catch {
      throw new GcodePathError('Útvonal nem oldható fel', 500);
    }
    if (resolved !== GCODE_ROOT && !resolved.startsWith(rootWithSep)) {
      throw new GcodePathError('Hozzáférés megtagadva (symlink a GCODE_ROOT-on kívülre)', 403);
    }
    return resolved;
  }

  if (opts.mustExist) {
    throw new GcodePathError('Útvonal nem található', 404);
  }

  // Még nem létező útvonal (pl. új fájl/könyvtár): a szülő szintén
  // nem mutathat ki a GCODE_ROOT-ból (symlink-escape ellen).
  const parent = path.dirname(candidate);
  if (existsSync(parent)) {
    let parentReal: string;
    try {
      parentReal = realpathSync(parent);
    } catch {
      throw new GcodePathError('Szülő könyvtár nem oldható fel', 500);
    }
    if (parentReal !== GCODE_ROOT && !parentReal.startsWith(rootWithSep)) {
      throw new GcodePathError('Hozzáférés megtagadva (szülő a GCODE_ROOT-on kívül)', 403);
    }
    return path.join(parentReal, path.basename(candidate));
  }

  return candidate;
}

/**
 * Visszaadja a GCODE_ROOT-hoz képesti relatív útvonalat (UI célra).
 */
export function relativeFromRoot(absPath: string): string {
  return path.relative(GCODE_ROOT, absPath) || '.';
}

export function isGcodeExtension(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return (GCODE_EXTENSIONS as readonly string[]).includes(ext);
}

export function isDirectory(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(absPath: string): boolean {
  try {
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
}
