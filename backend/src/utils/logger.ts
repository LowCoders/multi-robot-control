/**
 * Egységesített logger.
 *
 * A szintet a BACKEND_LOG_LEVEL környezeti változó határozza meg, amennyiben
 * nincs megadva, a globális LOG_LEVEL-t használja, alapértelmezett: 'info'.
 *
 * Példa:
 *   import { createLogger } from './utils/logger.js'
 *   const log = createLogger('devices')
 *   log.info('Device connected', { id })
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  const raw = (process.env.BACKEND_LOG_LEVEL || process.env.LOG_LEVEL || 'info')
    .toLowerCase()
    .trim();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  if (raw === 'warning') return 'warn';
  return 'info';
}

const activeLevel: LogLevel = resolveLevel();
const activeValue: number = LEVEL_VALUE[activeLevel];

function ts(): string {
  return new Date().toISOString();
}

function format(level: LogLevel, category: string | null, msg: unknown): string {
  const prefix = category ? `[${category}] ` : '';
  return `[${ts()}] [${level.toUpperCase()}] ${prefix}${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
}

export interface Logger {
  debug: (msg: unknown, ...args: unknown[]) => void;
  info: (msg: unknown, ...args: unknown[]) => void;
  warn: (msg: unknown, ...args: unknown[]) => void;
  error: (msg: unknown, ...args: unknown[]) => void;
  child: (category: string) => Logger;
  readonly level: LogLevel;
}

function build(category: string | null): Logger {
  const enabled = (lvl: LogLevel): boolean => LEVEL_VALUE[lvl] >= activeValue;

  return {
    debug(msg, ...args) {
      if (enabled('debug')) console.debug(format('debug', category, msg), ...args);
    },
    info(msg, ...args) {
      if (enabled('info')) console.info(format('info', category, msg), ...args);
    },
    warn(msg, ...args) {
      if (enabled('warn')) console.warn(format('warn', category, msg), ...args);
    },
    error(msg, ...args) {
      if (enabled('error')) console.error(format('error', category, msg), ...args);
    },
    child(sub: string) {
      const next = category ? `${category}:${sub}` : sub;
      return build(next);
    },
    level: activeLevel,
  };
}

export const logger: Logger = build(null);

export function createLogger(category: string): Logger {
  return build(category);
}
