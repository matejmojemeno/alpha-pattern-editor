/**
 * A picture's size typed, beside its slider (§5a): the width or height in stitches, or
 * the finished width or height. What's typed is kept as typed and asked for on Enter or
 * on leaving the field, not at every key, as a picture is made again for each: typing
 * "144" would otherwise make it 1, then 14, then 144 across. The arrow keys step it by
 * one, at once, as the slider's do. A number out of bounds asks for the nearest in them
 * (the caller clamps); anything else goes back to the value. Escape goes back too.
 */
import { useState } from 'react'

import { lengthText } from '../../importer/picture.ts'

export function SizeField({
  id,
  label,
  value,
  shown = String(value),
  unit,
  min,
  max,
  whole = true,
  step = 1,
  disabled,
  describedBy,
  onCommit,
}: {
  id?: string
  /** The field's name, when no visible label names it. */
  label?: string
  value: number
  /** The value as the field shows it, when not just the number. */
  shown?: string
  unit: string
  min: number
  max: number
  /** Whole numbers only (stitches); a finished size takes decimals. */
  whole?: boolean
  /** What the arrow keys add or take away. */
  step?: number
  disabled: boolean
  describedBy?: string
  onCommit: (n: number) => void
}) {
  // Null while the field shows the value; the text while it's being typed.
  const [text, setText] = useState<string | null>(null)
  const typed = text === null ? null : parse(text, whole)
  const outside = typed !== null && (typed < min || typed > max)
  const commit = () => {
    if (typed !== null && typed !== value) onCommit(Math.min(max, Math.max(min, typed)))
    setText(null)
  }
  return (
    <span className="picture-controls__field">
      <input
        id={id}
        type="text"
        inputMode={whole ? 'numeric' : 'decimal'}
        className="picture-controls__input"
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={(text !== null && (typed === null || outside)) || undefined}
        value={text ?? shown}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape' && text !== null) {
            // Back to the value, without closing whatever the field is in.
            e.stopPropagation()
            setText(null)
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const next = Math.min(max, Math.max(min, (typed ?? value) + (e.key === 'ArrowUp' ? step : -step)))
            setText(null)
            if (next !== value) onCommit(next)
          }
        }}
      />
      <span aria-hidden="true">{unit}</span>
      {outside && (
        <span className="picture-controls__bounds" role="status">
          {whole ? min : lengthText(min)} to {whole ? max : lengthText(max)}
        </span>
      )}
    </span>
  )
}

/** A typed number (a decimal comma too), or null when it isn't one. */
function parse(t: string, whole: boolean): number | null {
  const s = t.trim().replace(',', '.')
  if (s === '' || !/^\d*\.?\d*$/.test(s) || s === '.') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return whole ? (Number.isInteger(n) ? n : null) : n
}
