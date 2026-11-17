/**
 * The colours of a project with pieces (step 3 of the plan for "multiple patterns"): the
 * yarns its pieces use, a new blank piece that starts with them, and "Use the same colours
 * in every piece".
 *
 * Projects exist only in the web app, so there is no Python twin. Every change to a
 * pattern goes through the ported edits in logic/edit.ts (newPattern, addPaletteEntry,
 * recolorPaletteEntry, renamePaletteEntry), which the golden fixtures already check.
 */
import { addPaletteEntry, newPattern, recolorPaletteEntry, renamePaletteEntry } from '../logic/edit.ts'
import { deltaE, hexToLab, type Lab } from '../logic/lab.ts'
import type { Pattern, PaletteEntry } from '../model/types.ts'

/** How close two colours are to count as one yarn: the import's fixed merge, ΔE 15 in
 *  CIELAB (core/detect/palette.py DEFAULT_DELTA_E; docs/dev/areas/detection.md). */
export const SAME_COLOUR_DELTA_E = 15

/** A yarn of the project: one hex, with the name its most-used entry gives it, and the
 *  stitches of that hex across every piece. */
export interface ProjectColour {
  hex: string
  name: string
  count: number
}

/**
 * Every colour the pieces use, one per hex, most stitches first (the first is usually the
 * background). A hex's name is the one its entry with the most stitches has; ties go to the
 * earlier piece, then the earlier entry.
 */
export function projectColours(patterns: readonly Pattern[]): ProjectColour[] {
  const byHex = new Map<string, ProjectColour & { top: number; order: number }>()
  let order = 0
  for (const p of patterns) {
    for (const e of p.palette) {
      const hex = e.hex.toLowerCase()
      const c = byHex.get(hex)
      if (!c) byHex.set(hex, { hex, name: e.name, count: e.count, top: e.count, order: order++ })
      else {
        c.count += e.count
        if (e.count > c.top) {
          c.top = e.count
          c.name = e.name
        }
      }
    }
  }
  return [...byHex.values()].sort((a, b) => b.count - a.count || a.order - b.order).map(({ hex, name, count }) => ({ hex, name, count }))
}

/** How a project's pieces are worked, which a new piece takes from its first piece: a
 *  sweater's back is made the same way as its front. */
const HOW_WORKED = ['start_direction', 'alternate_direction', 'bottom_up', 'craft', 'filet_mesh'] as const

/**
 * A new blank piece: every cell `background`, with the project's other colours in its
 * palette ready to paint with (no stitches yet), worked the way `like` is.
 */
export function blankPiece(
  spec: { name: string; cols: number; rows: number },
  colours: readonly Pick<ProjectColour, 'hex' | 'name'>[],
  background: string,
  like: Pattern | null,
  now?: number,
): Pattern {
  const bg = colours.find((c) => c.hex === background) ?? { hex: background, name: 'Background' }
  let p = newPattern(spec.cols, spec.rows, bg.hex, { name: spec.name, colourName: bg.name, ...(now === undefined ? {} : { now }) })
  for (const c of colours) if (c.hex !== bg.hex) p = addPaletteEntry(p, c.hex, c.name)
  if (like) p = { ...p, ...Object.fromEntries(HOW_WORKED.map((k) => [k, like[k]])) }
  return p
}

/** One palette entry of one piece taking another piece's colour (and its name). */
export interface ColourChange {
  entryId: string
  from: { hex: string; name: string }
  to: { hex: string; name: string }
}

/**
 * "Use the same colours in every piece": colours of different pieces that are the same
 * yarn (within ΔE 15) are given one hex and one name, so the pieces look alike and the
 * project's yarn list counts them as one. Pieces imported from different photos rarely
 * agree to the hex.
 *
 * Only palette entries change, never cells, so no stitch moves and no Work progress is
 * touched. The earliest piece in the project's order that has a colour is the one the
 * others take it from, so the first piece never changes: the order is the crocheter's, and
 * a new, nearly blank piece can't recolour the pieces already made (within a piece, its
 * colours with the most stitches are matched first). Two colours of the same piece are
 * never made one, since that would merge them: each takes a different one, or stays.
 *
 * Returns, for each pattern in order, the changes to make to it (empty when none).
 */
export function sameColoursPlan(patterns: readonly Pattern[], threshold = SAME_COLOUR_DELTA_E): ColourChange[][] {
  const entries = patterns
    .flatMap((p, piece) => p.palette.map((e, i) => ({ piece, i, e })))
    .sort((a, b) => a.piece - b.piece || b.e.count - a.e.count || a.i - b.i)
  const kept: { hex: string; name: string; lab: Lab; pieces: Set<number> }[] = []
  const plan: ColourChange[][] = patterns.map(() => [])
  for (const { piece, e } of entries) {
    const hex = e.hex.toLowerCase()
    const lab = hexToLab(hex)
    let best: (typeof kept)[number] | null = null
    let bestD = Infinity
    for (const k of kept) {
      if (k.pieces.has(piece)) continue
      const d = k.hex === hex ? 0 : deltaE(lab, k.lab)
      if (d <= threshold && d < bestD) {
        best = k
        bestD = d
      }
    }
    if (!best) {
      kept.push({ hex, name: e.name, lab, pieces: new Set([piece]) })
      continue
    }
    best.pieces.add(piece)
    if (best.hex !== hex || best.name !== e.name) {
      plan[piece]!.push({ entryId: e.id, from: { hex: e.hex, name: e.name }, to: { hex: best.hex, name: best.name } })
    }
  }
  return plan
}

/** A pattern with `changes` made to its palette: each entry's hex and name. */
export function applyColourChanges(p: Pattern, changes: readonly ColourChange[]): Pattern {
  let out = p
  for (const c of changes) {
    if (c.to.hex !== c.from.hex) out = recolorPaletteEntry(out, c.entryId, c.to.hex)
    if (c.to.name !== c.from.name) out = renamePaletteEntry(out, c.entryId, c.to.name)
  }
  return out
}

/** The entry a change is for, to show it (its stitches). */
export function entryOf(p: Pattern, change: ColourChange): PaletteEntry | undefined {
  return p.palette.find((e) => e.id === change.entryId)
}
