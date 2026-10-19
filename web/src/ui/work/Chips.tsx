/**
 * The current row's colour segments, in working order: a port of chips.py.
 *
 *   done     segments before the cursor: ticked, on a raised background
 *   current  the segment at the cursor: accent border, and "done/count" once started
 *   pending  the rest: plain
 *
 * Each chip is a swatch plus "{count} {colour name}", and tapping one opens the segment
 * dialog. With carrying shown (logic/carry.ts), a chip also says which other colours to
 * carry inside its stitches, and over how many.
 *
 * At its end, inside the same outline, each chip has a tick: a second button beside the
 * first (never one inside the other), so a segment is marked done in one tap. Its ring is
 * empty until the segment is done; ticking one marks every segment before it done too, as
 * the dialog does, and unticking a done one takes your place back to its start. Not in
 * chips.py, whose chips had only the one button.
 *
 * In filet crochet (craft/filet.ts) a chip names squares, not a colour: "3 blocks" or
 * "2 spaces", with the stitches they take under it ("9 dc"). The swatch keeps the colour.
 */
import type { ReactNode } from 'react'

import { DoneIcon, NotDoneIcon } from '../icons.tsx'

import { squareOf, squaresText, stitchesText } from '../../craft/filet.ts'
import type { RunCarry } from '../../logic/carry.ts'
import type { Pattern, Run } from '../../model/types.ts'
import { carryNote, chipState, entryFor, passName, swatchBorder } from './segments.ts'

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
  carries,
  onChip,
  onTick,
  filet,
}: {
  pattern: Pattern
  runs: readonly Run[]
  /** progress.current_run_index */
  cursor: number
  /** progress.current_run_stitches */
  stitches: number
  /** Colours to carry inside each run's stitches, run by run (carriesByRun), or none. */
  carries?: readonly (readonly RunCarry[])[] | null
  onChip: (index: number) => void
  /** The tick: mark segment `index` done (`done` true), or take your place back to its
   *  start (false). */
  onTick: (index: number, done: boolean) => void
  /** Filet crochet: the palette index worked as spaces (craft/filet.ts `spaceIndex`). */
  filet?: { spaces: number | null }
}) {
  return (
    <ol className="chips" aria-label="Colours in this row">
      {runs.map((run, i) => {
        const entry = entryFor(pattern, run.palette_index)
        const state = chipState(i, cursor)
        const partly = state === 'current' && stitches > 0 && stitches < run.count
        const notes = (carries?.[i] ?? []).map((c) => ({ c, entry: entryFor(pattern, c.palette_index) }))
        const square = filet ? squareOf(run.palette_index, filet.spaces) : null
        const what = square ? squaresText(square, run.count) : `${run.count} ${entry.name}`
        const how = square ? stitchesText(square, run.count) : ''
        const status = state === 'done' ? 'done' : partly ? `${stitches} of ${run.count} done` : state === 'current' ? 'next' : ''
        return (
          <li key={i} className={`chip chip--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <button
              type="button"
              className="chip__open"
              aria-label={`${what}${how ? `, ${how}` : ''}${notes.map(({ c, entry: e }) => `, ${carryNote(e.name, c, passName(pattern))}`).join('')}${status ? `, ${status}` : ''}. Record progress`}
              onClick={() => onChip(i)}
            >
              <Swatch hex={entry.hex} />
              <span className="chip__text">
                {what}
                {how && <span className="chip__stitches">{how}</span>}
                {notes.map(({ c, entry: e }) => (
                  <span key={c.palette_index} className="chip__carry">
                    <Swatch hex={e.hex} className="swatch swatch--carry" />
                    {carryNote(e.name, c, passName(pattern))}
                  </span>
                ))}
              </span>
              {partly && (
                <span className="chip__mark">
                  {stitches}/{run.count}
                </span>
              )}
            </button>
            <button
              type="button"
              className="chip__tick"
              aria-pressed={state === 'done'}
              aria-label={`${what} done`}
              onClick={() => onTick(i, state !== 'done')}
            >
              {state === 'done' ? <DoneIcon /> : <NotDoneIcon />}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
