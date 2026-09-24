/**
 * Black or white text on a colour swatch. The desktop computes this twice, both times as
 * Rec. 709 luma > 140 (confirm_window.py:423, design_window.py:397); this is the one copy.
 *
 * Not the same decision as the swatch *outline* in chips.py:55 (`r + g + b > 180`), which
 * picks a border to draw around a swatch against the chip. Keep that separate.
 */

export type TextOn = '#000000' | '#ffffff'

/** Parse '#rgb' or '#rrggbb' (case-insensitive) to [r, g, b]. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new TypeError(`Not a hex colour: ${JSON.stringify(hex)}`)
  let h = m[1]!
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

export function luma(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The text colour to draw on `hex`: black on light swatches, white on dark ones. */
export function contrastOn(hex: string): TextOn {
  return luma(hex) > 140 ? '#000000' : '#ffffff'
}
