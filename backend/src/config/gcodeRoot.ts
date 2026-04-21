/**
 * G-code gyökérkönyvtár konfiguráció és biztonságos útvonal-feloldás.
 *
 * A gyökeret a `.env` fájl `GCODE_ROOT_DIR` változója határozza meg. Az
 * érték lehet abszolút (pl. `/srv/nc_files`) vagy relatív; relatív útvonal
 * esetén a workspace gyökeréhez (a backend cwd egy szinttel feljebb)
 * képest értelmezzük.
 *
 * A megengedett kiterjesztések és a max fájlméret a `config/system.yaml`
 * `files` szakaszából jönnek (single source of truth), fallback default-okkal.
 */

import { realpathSync, existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { GcodePathError } from '../errors/GcodePathError.js';

export { GcodePathError };

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
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

const DEFAULT_EXTENSIONS = ['.nc', '.gcode', '.ngc', '.tap', '.txt'];
const DEFAULT_MAX_FILE_SIZE_MB = 5;

interface SystemFilesYaml {
  files?: {
    max_file_size?: number;
    allowed_extensions?: string[];
  };
}

function loadFilesConfigSync(): { extensions: string[]; maxFileSize: number } {
  const yamlPath = path.resolve(WORKSPACE_ROOT, 'config', 'system.yaml');
  let extensions = DEFAULT_EXTENSIONS;
  let maxMb = DEFAULT_MAX_FILE_SIZE_MB;

  if (existsSync(yamlPath)) {
    try {
      const raw = readFileSync(yamlPath, 'utf-8');
      const parsed = parseYaml(raw) as SystemFilesYaml | null;
      const files = parsed?.files;
      if (files) {
        if (Array.isArray(files.allowed_extensions) && files.allowed_extensions.length > 0) {
          extensions = files.allowed_extensions
            .filter((e) => typeof e === 'string')
            .map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`));
        }
        if (typeof files.max_file_size === 'number' && files.max_file_size > 0) {
          maxMb = files.max_file_size;
        }
      }
    } catch {
      // marad a default
    }
  }

  return {
    extensions,
    maxFileSize: Math.floor(maxMb * 1024 * 1024),
  };
}

const filesConfig = loadFilesConfigSync();

export const GCODE_ROOT: string = ensureRootExists(resolveConfiguredRoot());

export const GCODE_EXTENSIONS: readonly string[] = filesConfig.extensions;

export const GCODE_MAX_FILE_SIZE: number = filesConfig.maxFileSize;

// Fájl- és könyvtárnév alap szanitálás: csak látható ASCII, nincs '/'.
const SAFE_NAME_RE = /^[A-Za-z0-9._\-+ ()\[\]]{1,255}$/;
const FORBIDDEN_NAMES = new Set(['', '.', '..']);

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
  return GCODE_EXTENSIONS.includes(ext);
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
