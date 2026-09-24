/**
 * Record progress on one colour segment (work_window.py SegmentDialog): either mark it
 * complete, which also completes the segments before it, or say how many of its stitches
 * are done.
 */
import { useId, useRef, useState } from 'react'

import { contrastOn } from '../../theme/contrast.ts'
import type { PaletteEntry } from '../../model/types.ts'
import { Modal } from '../components.tsx'
import { Swatch } from './Chips.tsx'

export function SegmentDialog({
  entry,
  count,
  done,
  onSave,
  onComplete,
  onCancel,
}: {
  entry: PaletteEntry
  count: number
  /** Stitches already recorded on this segment. */
  done: number
  onSave: (stitches: number) => void
  onComplete: () => void
  onCancel: () => void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(String(Math.min(done, count)))
  const n = Number.parseInt(value, 10)
  const stitches = Number.isFinite(n) ? Math.max(0, Math.min(count, n)) : 0
  const step = (d: number) => setValue(String(Math.max(0, Math.min(count, stitches + d))))

  return (
    <Modal title="Record progress" onClose={onCancel} initialFocus={input} className="segment">
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
        <div className="segment__stitches">
          <label htmlFor={`${id}-n`}>Stitches done</label>
          <div className="stepper">
            <button type="button" className="button" aria-label="One fewer" onClick={() => step(-1)} disabled={stitches <= 0}>
              −
            </button>
            <input
              ref={input}
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
        <button type="button" className="button segment__complete" onClick={onComplete}>
          Mark segment complete
        </button>
        <div className="dialog__buttons">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            Save progress
          </button>
        </div>
      </form>
    </Modal>
  )
}
