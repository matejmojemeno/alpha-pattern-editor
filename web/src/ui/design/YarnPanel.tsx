/**
 * The yarn estimate (yarn/usage.ts): how much of each colour to buy, from the stitch
 * counts, the yarn one stitch uses, a ball's length and a margin. The inputs are
 * app-wide settings, so they carry from pattern to pattern and survive a reload.
 */
import { useId, useState } from 'react'

import { useSettings } from '../../app/context.ts'
import { downloadBlob } from '../../app/download.ts'
import type { PaletteEntry } from '../../model/types.ts'
import type { Units } from '../../settings/store.ts'
import { LIBRARY_LABELS, type Library } from '../../yarn/libraries.ts'
import type { Match } from '../../yarn/match.ts'
import {
  ballFrom,
  ballIn,
  fieldValue,
  formatLength,
  perStitchFrom,
  perStitchIn,
  usageText,
  yarnUsage,
  type UsageInputs,
} from '../../yarn/usage.ts'
import { matchName } from '../yarn/useShades.ts'

/**
 * A number typed freely and committed only when it parses: what's typed stays as typed
 * (a half-finished "2." isn't rewritten), and the field follows `value` when it changes
 * from elsewhere, such as switching units.
 */
function NumberField({
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
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const t = e.target.value
            setText(t)
            // Emptied: committed on leaving the field, so it doesn't refill while typing.
            if (t.trim() === '') return setInvalid(false)
            const n = parse(t)
            const ok = Number.isFinite(n) && (min.inclusive ? n >= min.value : n > min.value)
            setInvalid(!ok)
            if (ok) onCommit(n)
          }}
          onBlur={() => {
            if (text.trim() === '') onCommit(null)
            setText(shown)
            setInvalid(false)
          }}
        />
        <span aria-hidden="true">{unit}</span>
      </span>
    </div>
  )
}

/** A typed number; a decimal comma is accepted too. */
const parse = (t: string) => Number(t.trim().replace(',', '.'))

const UNIT_NAMES: Record<Units, string> = { metric: 'Metres', imperial: 'Yards' }

export function YarnPanel({
  name,
  palette,
  library,
  matches,
}: {
  name: string
  palette: readonly PaletteEntry[]
  library: Library | null
  matches: readonly Match[] | null
}) {
  const [settings, set] = useSettings()
  const { units } = settings
  const metric = units === 'metric'
  const libraryBall = library?.ball ?? null
  const inputs: UsageInputs = {
    yarnPerStitchCm: settings.yarnPerStitchCm,
    ballMetres: settings.ballMetres ?? libraryBall?.metres ?? null,
    marginPercent: settings.marginPercent,
  }
  const usage = yarnUsage(palette, inputs)
  const ballNote =
    settings.ballMetres === null && library && libraryBall
      ? `${LIBRARY_LABELS[library.id]}, ${formatLength(libraryBall.metres, units)} per ${libraryBall.grams} g`
      : null
  const unitsName = useId()

  const exportList = () => {
    const text = usageText(usage, {
      patternName: name,
      inputs,
      units,
      ballNote,
      shades: library && matches ? matches.map((m) => matchName(library, m)) : undefined,
    })
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name} yarn.txt`)
  }

  return (
    <section className="yarn" aria-labelledby="yarn-heading">
      <h2 id="yarn-heading" className="design__heading">
        Yarn estimate
      </h2>
      <div className="yarn__inputs">
        <NumberField
          label="Yarn per stitch"
          unit={metric ? 'cm' : 'in'}
          value={perStitchIn(settings.yarnPerStitchCm, units)}
          places={2}
          min={{ value: 0, inclusive: false }}
          onCommit={(n) => n !== null && set({ yarnPerStitchCm: perStitchFrom(n, units) })}
        />
        <NumberField
          label="One ball"
          unit={metric ? 'm' : 'yd'}
          value={inputs.ballMetres === null ? null : ballIn(inputs.ballMetres, units)}
          places={1}
          min={{ value: 0, inclusive: false }}
          placeholder="length"
          onCommit={(n) => set({ ballMetres: n === null ? null : ballFrom(n, units) })}
        />
        <NumberField
          label="Extra"
          unit="%"
          value={settings.marginPercent}
          places={1}
          min={{ value: 0, inclusive: true }}
          onCommit={(n) => n !== null && set({ marginPercent: n })}
        />
        <fieldset className="yarn__units">
          <legend className="visually-hidden">Units</legend>
          {(['metric', 'imperial'] as const).map((u) => (
            <label key={u}>
              <input type="radio" name={unitsName} checked={units === u} onChange={() => set({ units: u })} />
              {UNIT_NAMES[u]}
            </label>
          ))}
        </fieldset>
      </div>
      <p className="yarn__ball muted">
        {inputs.ballMetres === null ? (
          'Enter the length of one ball to count balls.'
        ) : ballNote ? (
          `Ball: ${ballNote}.`
        ) : (
          <>
            Your ball length.{' '}
            {libraryBall && (
              <button type="button" className="linklike" onClick={() => set({ ballMetres: null })}>
                Use {library ? LIBRARY_LABELS[library.id] : 'the library'}’s ({formatLength(libraryBall.metres, units)})
              </button>
            )}
          </>
        )}
      </p>

      <table className="yarn__table">
        <caption className="visually-hidden">Yarn for each colour</caption>
        <thead>
          <tr>
            <th scope="col">Colour</th>
            <th scope="col">Stitches</th>
            <th scope="col">{metric ? 'Metres' : 'Yards'}</th>
            {inputs.ballMetres !== null && <th scope="col">Balls</th>}
          </tr>
        </thead>
        <tbody>
          {usage.colours.map((c) => (
            <tr key={c.entry.id}>
              <th scope="row">
                <span className="colour__swatch yarn__swatch" style={{ background: c.entry.hex }} aria-hidden="true" />
                {c.entry.name || 'Unnamed'}
              </th>
              <td>{c.stitches.toLocaleString('en-GB')}</td>
              <td>{formatLength(c.metres, units).replace(/ (m|yd)$/, '')}</td>
              {c.balls !== null && <td>{c.balls}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{usage.stitches.toLocaleString('en-GB')}</td>
            <td>{formatLength(usage.metres, units).replace(/ (m|yd)$/, '')}</td>
            {usage.balls !== null && <td>{usage.balls}</td>}
          </tr>
        </tfoot>
      </table>

      <p className="yarn__assumptions muted">
        An estimate, rounded up: one stitch per cell, and no yarn carried inside the stitches (tapestry crochet), ends or
        borders. Measure your own yarn per stitch: work 10 stitches, pull them out, measure and divide by 10.
      </p>
      <button type="button" className="button button--small" onClick={exportList}>
        Export yarn list
      </button>
    </section>
  )
}
