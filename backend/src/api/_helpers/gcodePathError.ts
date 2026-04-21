/**
 * G-code path-error → HTTP response mapping.
 *
 * A `GcodePathError` saját HTTP státuszt hordoz; ez a helper egységesen
 * elküldi a választ. Ha az `err` nem GcodePathError, `false`-t ad vissza,
 * és a hívó dobja tovább a hibát.
 */

import type { Response } from 'express';
import { GcodePathError } from '../../errors/GcodePathError.js';
import { sendAppError } from './sendError.js';

export function sendPathError(res: Response, err: unknown): boolean {
  if (err instanceof GcodePathError) {
    sendAppError(res, err);
    return true;
  }
  return false;
}
