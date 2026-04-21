/**
 * Egységes hibaválasz formátum: { error, code, details? }.
 *
 * A globális Express error middleware ezt használja az AppError leszármazottak
 * esetén; route handler-ekben ritkán kell direktben — inkább `throw new XError(...)`
 * mintát ajánljuk, és hagyjuk, hogy az error middleware lecsapja.
 */

import type { Response } from 'express';
import { AppError } from '../../errors/AppError.js';

export interface ErrorPayload {
  error: string;
  code?: string;
  details?: unknown;
}

export function sendError(
  res: Response,
  status: number,
  message: string,
  opts?: { code?: string; details?: unknown }
): void {
  const payload: ErrorPayload = { error: message };
  if (opts?.code) payload.code = opts.code;
  if (opts?.details !== undefined) payload.details = opts.details;
  res.status(status).json(payload);
}

export function sendAppError(res: Response, err: AppError): void {
  res.status(err.httpStatus).json(err.toJSON());
}
