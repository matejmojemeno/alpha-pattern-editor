/**
 * The crafts a pattern can be followed in (§15): what the Work stage calls one cell, the
 * order its chart is read in, and whether it shows where to carry yarn.
 *
 * Every reading order here is taken from a source named in ./README.md; a craft whose
 * source doesn't say something leaves that setting as the pattern has it (`order` only
 * lists what is sourced). The pattern stores the craft's id (`Pattern.craft`); an id this
 * build doesn't know reads as tapestry crochet, and is kept unchanged when saved.
 */
import type { Pattern } from '../model/types.ts'

export type CraftId = 'tapestry' | 'intarsia-crochet' | 'stranded-knit' | 'intarsia-knit' | 'bracelet' | 'bead-loom'

/** The pattern's reading order, as far as a craft's source sets it. */
export type CraftOrder = Partial<Pick<Pattern, 'start_direction' | 'alternate_direction' | 'bottom_up'>>

export interface Craft {
  readonly id: CraftId
  readonly label: string
  /** One cell, and many: "stitch"/"stitches", "knot"/"knots", "bead"/"beads". */
  readonly unit: string
  readonly units: string
  /** The reading order picking the craft sets. */
  readonly order: CraftOrder
  /** Whether "Show where to carry yarn" applies: tapestry crochet, worked over the
   *  strands (logic/carry.ts). Intarsia uses a bobbin per area, stranded knitting floats
   *  the yarn behind, and bracelets and beads carry nothing. */
  readonly carries: boolean
  /** Whether rows that don't turn (`alternate_direction` off) are rounds, worked in the
   *  round, as in crochet and knitting. A bracelet's or a loom's rows all run the same way. */
  readonly inRounds: boolean
}

/** Flat crochet: bottom right first, turning every row. */
const CROCHET_FLAT: CraftOrder = { bottom_up: true, start_direction: 'RTL', alternate_direction: true }
/** Flat knitting: right-side rows right to left, wrong-side rows left to right. */
const KNIT_FLAT: CraftOrder = { bottom_up: true, start_direction: 'RTL', alternate_direction: true }

export const CRAFTS: readonly Craft[] = [
  { id: 'tapestry', label: 'Tapestry crochet', unit: 'stitch', units: 'stitches', order: CROCHET_FLAT, carries: true, inRounds: true },
  { id: 'intarsia-crochet', label: 'Intarsia crochet', unit: 'stitch', units: 'stitches', order: CROCHET_FLAT, carries: false, inRounds: true },
  { id: 'stranded-knit', label: 'Stranded knitting (Fair Isle)', unit: 'stitch', units: 'stitches', order: KNIT_FLAT, carries: false, inRounds: true },
  { id: 'intarsia-knit', label: 'Intarsia knitting', unit: 'stitch', units: 'stitches', order: KNIT_FLAT, carries: false, inRounds: true },
  {
    id: 'bracelet',
    label: 'Alpha friendship bracelet',
    unit: 'knot',
    units: 'knots',
    // From the top, the first row left to right, and back.
    order: { bottom_up: false, start_direction: 'LTR', alternate_direction: true },
    carries: false,
    inRounds: false,
  },
  {
    id: 'bead-loom',
    label: 'Bead loom',
    unit: 'bead',
    units: 'beads',
    // Every row is woven the same way. Which corner to start from depends on the hand
    // and the loom; no source settles it, so it stays as the pattern has it.
    order: { alternate_direction: false },
    carries: false,
    inRounds: false,
  },
]

export const DEFAULT_CRAFT: CraftId = 'tapestry'

const BY_ID = new Map<string, Craft>(CRAFTS.map((c) => [c.id, c]))

export const isCraftId = (v: unknown): v is CraftId => typeof v === 'string' && BY_ID.has(v)

/** The pattern's craft; an id this build doesn't know is tapestry crochet. */
export function craftOf(p: Pick<Pattern, 'craft'>): Craft {
  return BY_ID.get(p.craft) ?? BY_ID.get(DEFAULT_CRAFT)!
}

/** `p` made in `id`: the craft recorded, and the reading order its source sets. */
export function withCraft(p: Pattern, id: CraftId): Pattern {
  return { ...p, ...BY_ID.get(id)!.order, craft: id }
}

/** "1 stitch", "3 knots". */
export function countOf(craft: Craft, n: number): string {
  return `${n} ${n === 1 ? craft.unit : craft.units}`
}

/** Does picking `id` change the order or the direction rows are read in? */
export function changesOrder(p: Pattern, id: CraftId): boolean {
  const next = withCraft(p, id)
  return next.bottom_up !== p.bottom_up || next.alternate_direction !== p.alternate_direction || next.start_direction !== p.start_direction
}

