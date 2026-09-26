/**
 * The structural panel's form (ui/design/StructurePanel.tsx), kept by the Design screen
 * because the border and padding sections drive the canvas preview.
 */
import type { Pattern } from '../model/types.ts'
import type { Sides } from './structure.ts'

export type Section = 'border' | 'pad' | 'scale' | 'rows'

export interface StructureForm {
  readonly open: Section | null
  readonly border: {
    readonly top: string
    readonly right: string
    readonly bottom: string
    readonly left: string
    readonly linked: boolean
    /** A palette index, or null for the pattern's border colour. */
    readonly colour: number | null
  }
  readonly pad: {
    readonly width: string
    readonly height: string
    /** Added columns on the left and rows on top; null centres. */
    readonly left: number | null
    readonly top: number | null
    readonly colour: number | null
  }
  readonly scale: number
  /** Working row number and column number, as on the chart's axes. */
  readonly row: string
  readonly col: string
}

export function initialForm(p: Pick<Pattern, 'cols' | 'rows'>): StructureForm {
  return {
    open: null,
    border: { top: '1', right: '1', bottom: '1', left: '1', linked: true, colour: null },
    pad: { width: String(p.cols), height: String(p.rows), left: null, top: null, colour: null },
    scale: 2,
    row: '1',
    col: '1',
  }
}

/** A whole number typed in a field, or null. */
export function parseWhole(s: string): number | null {
  const t = s.trim()
  if (!/^[-+]?\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : null
}

/** The border's four sides as numbers (anything not a whole number counts as 0). */
export function formSides(f: StructureForm['border']): Sides {
  const n = (s: string) => parseWhole(s) ?? 0
  return { top: n(f.top), right: n(f.right), bottom: n(f.bottom), left: n(f.left) }
}

/** The image row for a working row number, as the chart numbers rows. */
export function rowForNumber(p: Pick<Pattern, 'rows' | 'bottom_up'>, n: number): number {
  return p.bottom_up ? p.rows - n : n - 1
}

/** The pad target kept at least the pattern's size, without clobbering a larger one
 *  typed (design_window.py `_after_edit`). The same form when nothing changes. */
export function keepPadValid(f: StructureForm, p: Pick<Pattern, 'cols' | 'rows'>): StructureForm {
  const w = parseWhole(f.pad.width)
  const h = parseWhole(f.pad.height)
  const width = w === null || w < p.cols ? String(p.cols) : f.pad.width
  const height = h === null || h < p.rows ? String(p.rows) : f.pad.height
  return width === f.pad.width && height === f.pad.height ? f : { ...f, pad: { ...f.pad, width, height } }
}
