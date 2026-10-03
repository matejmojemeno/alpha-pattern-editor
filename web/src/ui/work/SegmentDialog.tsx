/**
 * Record progress on one colour segment (work_window.py SegmentDialog): either mark it
 * complete, which also completes the segments before it, or say how many of its stitches
 * are done.
 *
 * Marking it complete is what the dialog is opened for most, so it comes first, as the
 * one primary button, and has the focus (Return presses it, and a phone's keyboard stays
 * down). Part of a segment comes after, under "or": the count, then Save progress beside
 * Cancel. The desktop's dialog had the count first and both buttons equal.
 */
import { useId, useRef, useState } from 'react'

import { contrastOn } from '../../theme/contrast.ts'
import type { PaletteEntry } from '../../model/types.ts'
import { Modal } from '../components.tsx'
import { DoneIcon } from '../icons.tsx'
import { Swatch } from './Chips.tsx'

export function SegmentDialog({
  entry,
  count,
  units = 'stitches',
  done,
  onSave,
  onComplete,
  onCancel,
}: {
  entry: PaletteEntry
  count: number
  /** What the craft calls its cells: "stitches", "knots", "beads" (craft/crafts.ts). */
  units?: string
  /** Stitches already recorded on this segment. */
  done: number
  onSave: (stitches: number) => void
  onComplete: () => void
  onCancel: () => void
}) {
  const id = useId()
  const complete = useRef<HTMLButtonElement>(null)
  const [value, setValue] = useState(String(Math.min(done, count)))
  const n = Number.parseInt(value, 10)
  const stitches = Number.isFinite(n) ? Math.max(0, Math.min(count, n)) : 0
  const step = (d: number) => setValue(String(Math.max(0, Math.min(count, stitches + d))))

  return (
    <Modal title="Record progress" onClose={onCancel} initialFocus={complete} className="segment">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(stitches)
        }}
      >
        <p className="segment__head">
          <Swatch hex={entry.hex} className="swatch swatch--lg">
            <span style={{ color: contrastOn(entry.hex) }}>{count}</span>
          </Swatch>
          <strong>
            {count} {entry.name}
          </strong>
        </p>
        <button ref={complete} type="button" className="button button--primary segment__complete" onClick={onComplete}>
          <DoneIcon /> Mark segment complete
        </button>
        <p className="segment__or" aria-hidden="true">
          <span>or</span>
        </p>
        <div className="segment__stitches">
          <label htmlFor={`${id}-n`}>
            {units.charAt(0).toUpperCase() + units.slice(1)} done
          </label>
          <div className="segment__count">
            <button type="button" className="button" aria-label="One fewer" onClick={() => step(-1)} disabled={stitches <= 0}>
              −
            </button>
            <input
              id={`${id}-n`}
              type="number"
              inputMode="numeric"
              min={0}
              max={count}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="button" aria-label="One more" onClick={() => step(+1)} disabled={stitches >= count}>
              +
            </button>
          </div>
          <span className="muted">of {count}</span>
        </div>
        <div className="dialog__buttons">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button">
            Save progress
          </button>
        </div>
      </form>
    </Modal>
  )
}
