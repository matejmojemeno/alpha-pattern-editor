/**
 * The JSON documents inside a `.alpha` archive, as alphareader/core/io.py writes them.
 * These describe the files on disk; the in-memory shapes are in ./types.ts.
 *
 * Fields marked optional are ones io.py tolerates being absent when it loads a file.
 */
import type { Direction, PaletteEntry, Stage } from './types.ts'

/** Highest `.alpha` format this build understands (io.py FORMAT_VERSION). */
export const FORMAT_VERSION = 1

/** meta.json */
export interface MetaJson {
  format_version?: number // missing reads as 0
  stage?: Stage // missing reads as 'design'
}

/** pattern.json. Cells live separately in cells.npy. */
export interface PatternJson {
  id: string
  name: string
  created_at: number
  updated_at: number
  cols: number
  rows: number
  row_ids: string[]
  palette: PaletteEntry[]
  start_direction?: Direction // missing reads as 'LTR', deliberately
  alternate_direction?: boolean // missing reads as true
  bottom_up?: boolean // missing reads as true
}

/** progress.json. Every field may be missing; older files lack current_run_stitches. */
export interface ProgressJson {
  completed_row_ids?: string[]
  current_row_id?: string | null
  current_run_index?: number
  current_run_stitches?: number
  started_at?: number | null
}
