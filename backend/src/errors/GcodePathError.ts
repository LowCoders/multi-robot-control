/**
 * G-code path-műveletek (safeResolve, validateName) speciális hibája.
 *
 * Saját HTTP státuszt hordoz (400/403/404/500), így a global error
 * middleware vagy a régebbi `sendPathError` helper egyaránt használhatja.
 *
 * Az AppError-on keresztül illeszkedik az új error hierarchiába.
 */

import { AppError } from './AppError.js';

export class GcodePathError extends AppError {
  readonly httpStatus: number;
  readonly code = 'gcode_path_error';
  /** @deprecated `httpStatus` használandó. Megtartva backward-kompatibilitásként. */
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.httpStatus = status;
    this.status = status;
  }
}
