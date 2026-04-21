/**
 * Globális Express error middleware.
 *
 * Forrás-szerinti viselkedés:
 *   - AppError leszármazott → saját httpStatus + JSON ({ error, code, [details] }).
 *   - Axios hiba (isAxiosError) → bridge response status + detail átemelés.
 *   - Bármi más → 500, 'Internal server error'.
 *
 * Az `err: unknown` szigorúan típusos: nincs `any`, csak type-guard-ok.
 */

import type { Request, Response, NextFunction } from 'express';
import { isAxiosError } from 'axios';
import { AppError, BridgeUnavailableError, BridgeBadResponseError } from '../../errors/AppError.js';
import { sendAppError, sendError } from './sendError.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('api:errors');

interface BridgeErrorBody {
  detail?: string;
}

function extractAxiosDetail(err: unknown): string | undefined {
  if (!isAxiosError(err)) return undefined;
  const data = err.response?.data as BridgeErrorBody | string | undefined;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && typeof data.detail === 'string') {
    return data.detail;
  }
  return err.message;
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    if (err.httpStatus >= 500) {
      log.error(`${err.name} (${err.httpStatus}): ${err.message}`);
    }
    sendAppError(res, err);
    return;
  }

  if (isAxiosError(err)) {
    const status = err.response?.status;
    const detail = extractAxiosDetail(err) ?? 'Bridge hiba';
    if (status === undefined) {
      log.error('Bridge unavailable:', err.message);
      sendAppError(res, new BridgeUnavailableError(detail));
      return;
    }
    if (status >= 500) {
      log.error(`Bridge ${status}:`, detail);
      sendAppError(res, new BridgeBadResponseError(detail));
      return;
    }
    sendError(res, status, detail, { code: 'bridge_error' });
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  log.error('Unhandled error:', message);
  sendError(res, 500, message, { code: 'internal_error' });
}
