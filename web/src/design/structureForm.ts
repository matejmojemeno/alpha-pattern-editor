/**
 * The structural panel's form (ui/design/StructurePanel.tsx), kept by the Design screen
 * because the border section drives the canvas preview.
 *
 * The border's four sides are the form's truth. Its width and height are worked out from
 * them, except while one is being typed: then the text typed is kept, over the sides it
 * started from, and each whole number typed sets the sides afresh from those
 * (structure.ts `resizeSides`), so typing "70" never passes through a 7-wide pattern.
 */
import type { Pattern } from '../model/types.ts'
import { centreSides, resizeSides, sizeWith, type Sides } from './structure.ts'

export type Section = 'border' | 'scale'

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
    /** The width and height as typed, and the sides typing began from; null while
     *  neither is being typed. */
    readonly size: { readonly width: string; readonly height: string; readonly from: Sides } | null
  }
  readonly scale: number
}

export function initialForm(): StructureForm {
  return {
    open: null,
    border: { top: '1', right: '1', bottom: '1', left: '1', linked: true, colour: null, size: null },
    scale: 2,
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

/** The width and height fields' text: as typed, or the size the sides give. */
export function sizeText(f: StructureForm['border'], p: Pick<Pattern, 'cols' | 'rows'>): { width: string; height: string } {
  if (f.size) return { width: f.size.width, height: f.size.height }
  const { width, height } = sizeWith(p, formSides(f))
  return { width: String(width), height: String(height) }
}

const text = (s: Sides) => ({ top: String(s.top), right: String(s.right), bottom: String(s.bottom), left: String(s.left) })
const even = (s: Sides) => s.top === s.right && s.right === s.bottom && s.bottom === s.left

/** The sides set as given; "Same on every side" stays on only while they are. */
export function withSides(f: StructureForm, s: Sides): StructureForm {
  return { ...f, border: { ...f.border, ...text(s), linked: f.border.linked && even(s), size: null } }
}

/** Width or height typed: the sides that give it, the other kept. */
export function typeSize(f: StructureForm, p: Pick<Pattern, 'cols' | 'rows'>, axis: 'width' | 'height', value: string): StructureForm {
  const b = f.border
  const size = { ...sizeText(b, p), [axis]: value, from: b.size?.from ?? formSides(b) }
  const s = resizeSides(p, size.from, parseWhole(size.width), parseWhole(size.height))
  return { ...f, border: { ...b, ...text(s), linked: b.linked && even(s), size } }
}

/** Done typing the size: the fields show the size the sides give again. */
export function endSize(f: StructureForm): StructureForm {
  return f.border.size ? { ...f, border: { ...f.border, size: null } } : f
}

/** The sides turned a quarter with the pattern: what was added across it is added down
 *  it, so the size set turns with it (as the desktop's pad target does). */
export function turnSides(f: StructureForm): StructureForm {
  const s = formSides(f.border)
  return endSize(withSides(f, { top: s.left, bottom: s.right, left: s.top, right: s.bottom }))
}

/** The pattern centred in the same size. */
export function centred(f: StructureForm): StructureForm {
  return withSides(f, centreSides(formSides(f.border)))
}

/** Whether the pattern is centred as `centred` would place it. */
export function isCentred(f: StructureForm): boolean {
  const s = formSides(f.border)
  const c = centreSides(s)
  return c.left === s.left && c.top === s.top
}
