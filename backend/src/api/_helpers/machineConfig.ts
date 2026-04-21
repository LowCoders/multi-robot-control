/**
 * Alap machine-config generátor.
 *
 * A defaults JSON-ok a `config/machines/_defaults/<type>.json` alatt élnek
 * és sémájuk megegyezik a frontend `MachineConfig` típussal
 * (`frontend/src/types/machine-config.ts`). Egyetlen forrás-tárhely az új
 * gép-konfigurációhoz, így a backend és a frontend nem fork-olja a
 * defaultokat.
 *
 * Ha egy típushoz nincs JSON, fallback a `cnc_mill`.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

const DEFAULTS_DIR = path.resolve(process.cwd(), '..', 'config', 'machines', '_defaults');

export type DefaultMachineConfig = Record<string, unknown> & {
  id: string;
  name: string;
  type: string;
};

const cache = new Map<string, Record<string, unknown>>();

function loadDefaultsForType(type: string): Record<string, unknown> {
  if (cache.has(type)) {
    return JSON.parse(JSON.stringify(cache.get(type)!));
  }

  const candidate = path.join(DEFAULTS_DIR, `${type}.json`);
  if (existsSync(candidate)) {
    const raw = readFileSync(candidate, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    cache.set(type, parsed);
    return JSON.parse(JSON.stringify(parsed));
  }

  // Fallback a cnc_mill-re
  const fallback = path.join(DEFAULTS_DIR, 'cnc_mill.json');
  if (existsSync(fallback)) {
    const raw = readFileSync(fallback, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    cache.set(type, parsed);
    return JSON.parse(JSON.stringify(parsed));
  }

  return { type: 'custom' };
}

/**
 * Az ismert gép-típusok listája a `_defaults/` alapján.
 * Hasznos fejlesztői ellenőrzéshez vagy UI dropdownhoz.
 */
export function listDefaultMachineTypes(): string[] {
  if (!existsSync(DEFAULTS_DIR)) return [];
  return readdirSync(DEFAULTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function getDefaultMachineConfig(
  deviceType: string,
  id: string,
  name: string
): DefaultMachineConfig {
  // Aliasok: bridge sokszor `cnc` vagy `5_axis` típusokat ad
  const normalized = normalizeType(deviceType);
  const base = loadDefaultsForType(normalized);
  return {
    ...base,
    id,
    name,
    type: (base.type as string) ?? normalized,
  };
}

function normalizeType(type: string): string {
  if (!type) return 'custom';
  const t = type.toLowerCase();
  if (t === '5_axis' || t === 'five_axis' || t.includes('5')) return '5axis';
  if (t === 'cnc' || t === 'mill') return 'cnc_mill';
  if (t === 'lathe') return 'cnc_lathe';
  if (t === 'laser') return 'laser_cutter';
  if (t === 'robotarm' || t === 'robot') return 'robot_arm';
  if (t === 'tubebender' || t === 'bender') return 'tube_bender';
  return t;
}
