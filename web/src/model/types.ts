/**
 * TypeScript mirrors of the dataclasses in alphareader/core/model.py and the `Run`
 * dataclass in alphareader/core/readout.py. The Python is the spec.
 *
 * Field names stay snake_case so they line up 1:1 with the Python and with the JSON
 * inside `.alpha` archives; a rename layer would be one more place for the two to drift.
 */

/** Reserved sentinel palette index for skipped / 0-knot cells (§14). */
export const SKIP_INDEX = 0xffff

export type Direction = 'LTR' | 'RTL'
export type Stage = 'design' | 'work'

export interface PaletteEntry {
  id: string
  hex: string // '#rrggbb'
  name: string // editable, seeded from nearest DMC
  dmc: string | null
  count: number // number of cells using this entry
}

export interface Pattern {
  readonly id: string
  readonly name: string
  readonly created_at: number
  readonly updated_at: number
  readonly cols: number
  readonly rows: number
  /** len == rows, stable across structural edits. */
  readonly row_ids: readonly string[]
  /** Palette indices, row-major (C order), length rows * cols. Row r is
   *  cells[r * cols .. (r + 1) * cols). Same layout as cells.npy. */
  readonly cells: Uint16Array
  readonly palette: readonly PaletteEntry[]
  /** Row 1 (bottom) reads right->left by default. */
  readonly start_direction: Direction
  readonly alternate_direction: boolean
  /** Work is followed bottom row first (§4.4). */
  readonly bottom_up: boolean
}

/** Dataclass defaults for a *new* Pattern. Loading a file uses different ones for
 *  start_direction; see storage/alpha.ts and the Rules in docs/web-port-plan.md. */
export const PATTERN_DEFAULTS = {
  start_direction: 'RTL',
  alternate_direction: true,
  bottom_up: true,
} as const satisfies Pick<Pattern, 'start_direction' | 'alternate_direction' | 'bottom_up'>

export interface Progress {
  readonly completed_row_ids: ReadonlySet<string>
  readonly current_row_id: string | null
  /** Runs [0, this) in the current row are complete. */
  readonly current_run_index: number
  /** Stitches done within the in-progress run. */
  readonly current_run_stitches: number
  /** Seconds since the epoch, like Python's time.time(). */
  readonly started_at: number | null
}

/** `Progress()` with its dataclass defaults. */
export function emptyProgress(): Progress {
  return {
    completed_row_ids: new Set(),
    current_row_id: null,
    current_run_index: 0,
    current_run_stitches: 0,
    started_at: null,
  }
}

export interface Project {
  readonly pattern: Pattern
  readonly progress: Progress
  readonly stage: Stage
}

/** One run-length-encoded segment of a row (readout.py `Run`). */
export interface Run {
  readonly palette_index: number
  readonly count: number
  /** Position in working order, not raw column index. */
  readonly start_col: number
}
