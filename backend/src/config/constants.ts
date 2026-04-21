/**
 * Központi konstansok: alapértelmezett portok, timeoutok, throttle-ok.
 *
 * Itt élnek azok a "mágikus számok", amelyek korábban több fájlba is bele
 * voltak írva (`server.ts`, `index.ts`, `appState.ts`, `DeviceManager.ts`).
 * A futásidejű érték továbbra is a `system.yaml`-ből vagy az env-ből jön —
 * ezek csak a fallback default-ok.
 */

export const DEFAULT_BACKEND_PORT = 4001;
export const DEFAULT_BACKEND_HOST = '0.0.0.0';

export const DEFAULT_BRIDGE_HOST = 'localhost';
export const DEFAULT_BRIDGE_PORT = 4002;

/** Axios default timeout a Python bridge HTTP hívásokhoz (ms). */
export const BRIDGE_HTTP_TIMEOUT_MS = 10_000;

/** Status poll cadence a bridge state biztonsági hálójához (ms). */
export const STATUS_POLL_INTERVAL_MS = 2_500;

/** Auto-claim host throttle: minimum eltelt idő két próba között (ms). */
export const AUTO_CLAIM_THROTTLE_MS = 2_500;

/** Graceful shutdown felső határidő (ms). */
export const SHUTDOWN_GRACE_MS = 10_000;

/** Socket.IO ping-interval default (ms). */
export const WS_PING_INTERVAL_MS = 25_000;

/** Socket.IO ping-timeout default (ms). */
export const WS_PING_TIMEOUT_MS = 60_000;

/** Position throttling default (broadcast/sec). */
export const POSITION_UPDATE_RATE_HZ = 10;

/** Status throttling default (broadcast/sec). */
export const STATUS_UPDATE_RATE_HZ = 5;
