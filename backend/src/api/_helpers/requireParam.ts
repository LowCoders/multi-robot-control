/**
 * Path-paraméter biztonságos kiolvasása.
 *
 * `noUncheckedIndexedAccess` mellett az `req.params.id` típusa `string | undefined`,
 * pedig az Express runtime garantálja a meglétét (különben nem mountolódna a route).
 * Ez a helper élesíti ezt a garanciát: ha valamiért hiányzik (pl. teszt), olvasható
 * hibát ad NotFoundError formájában.
 */

import type { Request } from 'express';
import { ValidationError } from '../../errors/AppError.js';

export function requireParam<K extends string>(req: Request, key: K): string {
  const value = req.params[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`Hiányzó vagy érvénytelen path paraméter: ${key}`);
  }
  return value;
}

export function requireDeviceId(req: Request): string {
  return requireParam(req, 'id');
}
