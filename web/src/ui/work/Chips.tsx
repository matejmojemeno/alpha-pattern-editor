/**
 * The current row's colour segments, in working order: a port of chips.py.
 *
 *   done     segments before the cursor: "✓", on a raised background
 *   current  the segment at the cursor: accent border, and "· done/count" once started
 *   pending  the rest: plain
 *
 * Each chip is a swatch plus "{count} {colour name}", and tapping one opens the segment
 * dialog.
 */
import type { ReactNode } from 'react'

import type { Pattern, Run } from '../../model/types.ts'
import { chipState, entryFor, swatchBorder } from './segments.ts'

export function Swatch({ hex, className = 'swatch', children }: { hex: string; className?: string; children?: ReactNode }) {
  return (
    <span className={className} style={{ background: hex, borderColor: swatchBorder(hex) }} aria-hidden="true">
      {children}
    </span>
  )
}

export function Chips({
  pattern,
  runs,
  cursor,
  stitches,
  onChip,
}: {
  pattern: Pattern
  runs: readonly Run[]
  /** progress.current_run_index */
  cursor: number
  /** progress.current_run_stitches */
  stitches: number
  onChip: (index: number) => void
}) {
  return (
    <ol className="chips" aria-label="Colours in this row">
      {runs.map((run, i) => {
        const entry = entryFor(pattern, run.palette_index)
        const state = chipState(i, cursor)
        const partly = state === 'current' && stitches > 0 && stitches < run.count
        const status = state === 'done' ? 'done' : partly ? `${stitches} of ${run.count} done` : state === 'current' ? 'next' : ''
        return (
          <li key={i}>
            <button
              type="button"
              className={`chip chip--${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
              aria-label={`${run.count} ${entry.name}${status ? `, ${status}` : ''}. Record progress`}
              onClick={() => onChip(i)}
            >
              <Swatch hex={entry.hex} />
              <span className="chip__text">
                {run.count} {entry.name}
              </span>
              {state === 'done' && <span className="chip__mark">✓</span>}
              {partly && (
                <span className="chip__mark">
                  · {stitches}/{run.count}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
