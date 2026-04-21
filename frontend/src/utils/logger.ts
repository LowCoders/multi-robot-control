/**
 * Egységesített frontend logger.
 *
 * Szintforrások (preferencia sorrendben):
 *   1. localStorage.getItem('logLevel')      — runtime override (rebuild nélkül)
 *   2. import.meta.env.VITE_LOG_LEVEL        — build-time .env-ből
 *   3. import.meta.env.DEV ? 'debug' : 'warn' — default
 *
 * Példa:
 *   import { createLogger } from '../utils/logger'
 *   const log = createLogger('devices')
 *   log.info('Connected', { id })
 *
 * Runtime debug aktiválás (devtools console):
 *   localStorage.setItem('logLevel', 'debug'); location.reload();
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function normalize(raw: string | null | undefined): LogLevel | null {
  if (!raw) return null
  const v = raw.toLowerCase().trim()
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v
  if (v === 'warning') return 'warn'
  return null
}

interface ViteEnv {
  VITE_LOG_LEVEL?: string
  DEV?: boolean
}

function readViteEnv(): ViteEnv {
  try {
    const meta = import.meta as unknown as { env?: ViteEnv }
    return meta.env ?? {}
  } catch {
    return {}
  }
}

function resolveLevel(): LogLevel {
  if (typeof window !== 'undefined') {
    try {
      const ls = normalize(window.localStorage?.getItem('logLevel'))
      if (ls) return ls
    } catch {
      // localStorage nem mindig elérhető (privát mód, SSR), nyugodtan ignoráljuk
    }
  }

  const env = readViteEnv()
  const fromEnv = normalize(env.VITE_LOG_LEVEL)
  if (fromEnv) return fromEnv

  return env.DEV === true ? 'debug' : 'warn'
}

const activeLevel: LogLevel = resolveLevel()
const activeValue: number = LEVEL_VALUE[activeLevel]

function format(level: LogLevel, category: string | null, msg: unknown): string {
  const prefix = category ? `[${category}] ` : ''
  return `[${level.toUpperCase()}] ${prefix}${typeof msg === 'string' ? msg : JSON.stringify(msg)}`
}

export interface Logger {
  debug: (msg: unknown, ...args: unknown[]) => void
  info: (msg: unknown, ...args: unknown[]) => void
  warn: (msg: unknown, ...args: unknown[]) => void
  error: (msg: unknown, ...args: unknown[]) => void
  child: (category: string) => Logger
  readonly level: LogLevel
}

function build(category: string | null): Logger {
  const enabled = (lvl: LogLevel): boolean => LEVEL_VALUE[lvl] >= activeValue

  return {
    debug(msg, ...args) {
      if (enabled('debug')) console.debug(format('debug', category, msg), ...args)
    },
    info(msg, ...args) {
      if (enabled('info')) console.info(format('info', category, msg), ...args)
    },
    warn(msg, ...args) {
      if (enabled('warn')) console.warn(format('warn', category, msg), ...args)
    },
    error(msg, ...args) {
      if (enabled('error')) console.error(format('error', category, msg), ...args)
    },
    child(sub: string): Logger {
      const next = category ? `${category}:${sub}` : sub
      return build(next)
    },
    level: activeLevel,
  }
}

export const logger: Logger = build(null)

export function createLogger(category: string): Logger {
  return build(category)
}
