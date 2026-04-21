/**
 * Zod-alapú request validátor middleware.
 *
 * Használat:
 *
 *   const Body = z.object({ name: z.string(), deviceId: z.string() })
 *   router.post('/jobs', validateBody(Body), asyncHandler(async (req, res) => {
 *     const { name, deviceId } = req.body  // tipusos!
 *     ...
 *   }))
 *
 * Hibás bemenet esetén ValidationError-t dob, amelyet a globális error
 * middleware egységes JSON-ra fordít: { error, code: 'validation_error', details }.
 */

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { ValidationError } from '../../errors/AppError.js';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new ValidationError('Érvénytelen kérés törzs', result.error.issues));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new ValidationError('Érvénytelen query paraméter', result.error.issues));
      return;
    }
    Object.assign(req.query, result.data);
    next();
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(new ValidationError('Érvénytelen path paraméter', result.error.issues));
      return;
    }
    Object.assign(req.params, result.data);
    next();
  };
}
