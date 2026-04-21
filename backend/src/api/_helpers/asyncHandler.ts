/**
 * Async route handler wrapper: Promise-ben dobott hibákat továbbadja a
 * `next`-en keresztül az Express error middleware-nek.
 *
 * Az `unknown` visszatérés engedélyezi a `return res.json(...)` mintát is,
 * amit Express megenged ugyan, de TS szerint nem `void`.
 */

import type { Request, Response, NextFunction } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
