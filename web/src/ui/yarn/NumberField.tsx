/**
 * A number typed freely and committed only when it parses: what's typed stays as typed
 * (a half-finished "2." isn't rewritten), and the field follows `value` when it changes
 * from elsewhere, such as switching units. For the yarn estimate's inputs.
 */
import { useId, useState } from 'react'

import { fieldValue } from '../../yarn/usage.ts'

export function NumberField({
  label,
  unit,
  value,
  places,
  min,
  placeholder,
  onCommit,
}: {
  label: string
  unit: string
  value: number | null
  /** Decimals shown; 0 takes whole numbers only. */
  places: number
  /** The smallest value allowed; positive fields pass 0 and exclude it. */
  min: { value: number; inclusive: boolean }
  placeholder?: string
  /** The new value, or null when the field was emptied. */
  onCommit: (n: number | null) => void
}) {
  const id = useId()
  const shown = value === null ? '' : fieldValue(value, places)
  const [text, setText] = useState(shown)
  const [invalid, setInvalid] = useState(false)
  // The value changed: follow it, unless what's being typed already says it ("2." while
  // typing 2.5). Adjusted during render, as React recommends, rather than in an effect.
  const [following, setFollowing] = useState(shown)
  if (following !== shown) {
    setFollowing(shown)
    if (!(text.trim() !== '' && fieldValue(parse(text), places) === shown)) setText(shown)
  }
  return (
    <div className="yarn__field">
      <label htmlFor={id}>{label}</label>
      <span className="yarn__input">
        <input
          id={id}
          type="text"
          inputMode={places === 0 ? 'numeric' : 'decimal'}
          value={text}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const t = e.target.value
            setText(t)
            // Emptied: committed on leaving the field, so it doesn't refill while typing.
            if (t.trim() === '') return setInvalid(false)
            const n = parse(t)
            const ok =
              Number.isFinite(n) && (places > 0 || Number.isInteger(n)) && (min.inclusive ? n >= min.value : n > min.value)
            setInvalid(!ok)
            if (ok) onCommit(n)
          }}
          onBlur={() => {
            if (text.trim() === '') onCommit(null)
            setText(shown)
            setInvalid(false)
          }}
        />
        {unit && <span aria-hidden="true">{unit}</span>}
      </span>
    </div>
  )
}

/** A typed number; a decimal comma is accepted too. */
const parse = (t: string) => Number(t.trim().replace(',', '.'))
