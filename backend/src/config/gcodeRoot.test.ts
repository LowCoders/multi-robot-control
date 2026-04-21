import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  GCODE_ROOT,
  validateName,
  safeResolve,
  isGcodeExtension,
  relativeFromRoot,
} from './gcodeRoot.js';
import { GcodePathError } from '../errors/GcodePathError.js';

describe('validateName', () => {
  it('elfogadja az egyszerű ASCII fájlneveket', () => {
    expect(() => validateName('test.gcode')).not.toThrow();
    expect(() => validateName('CNC Job (1).nc')).not.toThrow();
    expect(() => validateName('part_v2.ngc')).not.toThrow();
  });

  it('elutasít nem-string értéket', () => {
    expect(() => validateName(undefined)).toThrow(GcodePathError);
    expect(() => validateName(123)).toThrow(GcodePathError);
  });

  it('elutasítja a rezervált neveket', () => {
    expect(() => validateName('')).toThrow(GcodePathError);
    expect(() => validateName('.')).toThrow(GcodePathError);
    expect(() => validateName('..')).toThrow(GcodePathError);
  });

  it('elutasítja a path-szeparátort és a null bájtot', () => {
    expect(() => validateName('foo/bar')).toThrow(GcodePathError);
    expect(() => validateName('foo\\bar')).toThrow(GcodePathError);
    expect(() => validateName('foo\0bar')).toThrow(GcodePathError);
  });
});

describe('safeResolve', () => {
  it('elutasítja a string-en kívüli inputot', () => {
    expect(() => safeResolve(undefined)).toThrow(GcodePathError);
    expect(() => safeResolve('')).toThrow(GcodePathError);
  });

  it('blokkol minden GCODE_ROOT-on kívüli abszolút útvonalat', () => {
    expect(() => safeResolve('/etc/passwd')).toThrow(GcodePathError);
    expect(() => safeResolve('/tmp/escape.gcode')).toThrow(GcodePathError);
  });

  it('elutasítja a null bájtot tartalmazó útvonalat', () => {
    expect(() => safeResolve('foo\0bar.gcode')).toThrow(GcodePathError);
  });

  it('feloldja a relatív útvonalat a GCODE_ROOT-hoz képest', () => {
    const resolved = safeResolve('subdir/test.gcode');
    expect(resolved.startsWith(GCODE_ROOT)).toBe(true);
    expect(resolved).toBe(path.join(GCODE_ROOT, 'subdir', 'test.gcode'));
  });

  it('mustExist + nem létező út → 404 GcodePathError', () => {
    let caught: unknown;
    try {
      safeResolve('definitely-not-here.gcode', { mustExist: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GcodePathError);
    expect((caught as GcodePathError).httpStatus).toBe(404);
  });
});

describe('isGcodeExtension', () => {
  it('felismeri a tipikus G-code kiterjesztéseket', () => {
    expect(isGcodeExtension('a.nc')).toBe(true);
    expect(isGcodeExtension('a.gcode')).toBe(true);
    expect(isGcodeExtension('a.NGC')).toBe(true);
  });

  it('elutasítja a nem G-code kiterjesztéseket', () => {
    expect(isGcodeExtension('a.png')).toBe(false);
    expect(isGcodeExtension('readme.md')).toBe(false);
  });
});

describe('relativeFromRoot', () => {
  it('a GCODE_ROOT-ot magát "."-nak adja vissza', () => {
    expect(relativeFromRoot(GCODE_ROOT)).toBe('.');
  });

  it('a relatív részt adja vissza alkönyvtáraknál', () => {
    const sub = path.join(GCODE_ROOT, 'a', 'b.gcode');
    expect(relativeFromRoot(sub)).toBe(path.join('a', 'b.gcode'));
  });
});
