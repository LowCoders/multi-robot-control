/**
 * Domain hibák alapja: típusbiztos error-leszármazási hierarchia.
 *
 * A globális Express error middleware ezekből olvassa ki a HTTP státuszt és
 * a stabil hiba-kódot. A kívülről jövő (axios, ismeretlen) hibákat egységesen
 * 500-ra fordítja.
 *
 * Új hibatípus felvételéhez:
 *   1) Új class extends AppError, megfelelő `code` és `httpStatus`.
 *   2) A dobás helyén `throw new XError('msg')`.
 *   3) A globális handler automatikusan formázza ({ error, code }).
 */

export interface AppErrorJson {
  error: string;
  code: string;
}

export abstract class AppError extends Error {
  abstract readonly httpStatus: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON(): AppErrorJson {
    return { error: this.message, code: this.code };
  }
}

export class NotFoundError extends AppError {
  readonly httpStatus = 404;
  readonly code = 'not_found';
}

export class ValidationError extends AppError {
  readonly httpStatus = 400;
  readonly code = 'validation_error';
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    if (details !== undefined) {
      this.details = details;
    }
  }

  override toJSON(): AppErrorJson & { details?: unknown } {
    const base = { ...super.toJSON() } as AppErrorJson & { details?: unknown };
    if (this.details !== undefined) base.details = this.details;
    return base;
  }
}

export class ConflictError extends AppError {
  readonly httpStatus = 409;
  readonly code = 'conflict';
}

export class ForbiddenError extends AppError {
  readonly httpStatus = 403;
  readonly code = 'forbidden';
}

export class BridgeUnavailableError extends AppError {
  readonly httpStatus = 503;
  readonly code = 'bridge_unavailable';
}

export class BridgeBadResponseError extends AppError {
  readonly httpStatus = 502;
  readonly code = 'bridge_bad_response';
}
