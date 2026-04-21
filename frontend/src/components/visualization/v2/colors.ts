/**
 * Egyedi, jól megkülönböztethető színek generálása az alkatrészekhez.
 * HSL színtéren a hue-t a golden ratio konjugáltjával lépkedjük,
 * így tetszőleges N esetén az egymás utáni színek vizuálisan távoliak maradnak.
 */

const GOLDEN_RATIO_CONJUGATE = 0.618033988749895

/**
 * @param index - 0-tól indexelt sorszám
 * @param saturation - 0..1
 * @param lightness - 0..1
 * @param hueOffset - kezdő hue eltolás (0..1)
 */
export function generatePartColor(
  index: number,
  saturation = 0.65,
  lightness = 0.55,
  hueOffset = 0.12,
): string {
  const h = (hueOffset + index * GOLDEN_RATIO_CONJUGATE) % 1
  return hslToHex(h, saturation, lightness)
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}
