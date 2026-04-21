/**
 * Bemeneti validátorok az API endpointokhoz.
 *
 * Megjegyzés: a `VALID_AXES` konstans egyetlen helyen van — a routes
 * szétbontása előtt 1-1 forrásból több helyen rontották el.
 */

export const VALID_AXES = ['X', 'Y', 'Z', 'A', 'B', 'C'] as const;

export function validateAxis(axis: unknown): axis is string {
  return (
    typeof axis === 'string' &&
    (VALID_AXES as readonly string[]).includes(axis.toUpperCase())
  );
}

export function validateNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

export function validatePercent(value: unknown): value is number {
  return validateNumber(value) && value >= 0 && value <= 200;
}

export function validateString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function validateAxesArray(axes: unknown): axes is string[] {
  if (!Array.isArray(axes)) return false;
  return axes.every((axis) => validateAxis(axis));
}
