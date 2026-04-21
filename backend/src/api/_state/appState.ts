/**
 * Backward-compat barrel re-export.
 *
 * A korábbi monolit `appState.ts` szétbontva három domain-modulra:
 *   - `settingsState.ts` — bridge host/port + realtime ráta
 *   - `automationState.ts` — automation rules
 *   - `jobQueueState.ts` — job queue + execution mode
 *
 * Az itteni re-exportok megőrzik a régi importpath-okat, így a routerek és
 * tesztek továbbra is `from './_state/appState.js'`-szel hivatkozhatnak.
 */

export type { AppSettings } from './settingsState.js';
export { appSettings, initAppSettings } from './settingsState.js';

export type { AutomationRule } from './automationState.js';
export { automationRules } from './automationState.js';

export type { Job, ExecutionMode } from './jobQueueState.js';
export {
  jobRepository,
  jobQueue,
  executionModeRef,
  getExecutionMode,
  setExecutionMode,
  startNextPendingJob,
} from './jobQueueState.js';
