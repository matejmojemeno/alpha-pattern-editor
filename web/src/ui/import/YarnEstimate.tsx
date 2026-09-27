/**
 * "Yarn & size", beside Save on the import screen: a dialog that turns one swatch into
 * the finished size and how much yarn of each colour to buy (yarn/usage.ts), for the
 * pattern as it will be saved (the colours removed and merged here already applied).
 *
 * The inputs are app-wide settings: they describe the crocheter's yarn, hook and hands,
 * not the chart, so they carry from pattern to pattern and survive a reload. The ball
 * defaults to the chosen yarn range's own, when one is chosen under "Advanced: match to
 * yarn".
 */
import { useId, useMemo } from 'react'

import '../yarn.css'

import { useSettings } from '../../app/context.ts'
import { downloadBlob } from '../../app/download.ts'
import { carriedStitches } from '../../logic/carry.ts'
import { PATTERN_DEFAULTS, type PaletteEntry, type Pattern } from '../../model/types.ts'
import type { Units } from '../../settings/store.ts'
import { LIBRARY_LABELS } from '../../yarn/libraries.ts'
import {
  cmFrom,
  cmIn,
  finishedSize,
  formatLength,
  formatSize,
  formatWeight,
  metresFrom,
  metresIn,
  usageText,
  yarnUsage,
  type UsageInputs,
} from '../../yarn/usage.ts'
import { Modal } from '../components.tsx'
import { NumberField } from '../yarn/NumberField.tsx'
import { matchName, useChosenMatches } from '../yarn/useShades.ts'

export interface EstimatedPattern {
  readonly rows: number
  readonly cols: number
  readonly cells: Uint16Array
  readonly palette: readonly PaletteEntry[]
}

const UNIT_NAMES: Record<Units, string> = { metric: 'Metric (cm, m)', imperial: 'Imperial (in, yd)' }
const POSITIVE = { value: 0, inclusive: false }

export function YarnEstimate({ name, pattern, onClose }: { name: string; pattern: EstimatedPattern; onClose: () => void }) {
  const [settings, set] = useSettings()
  const { units } = settings
  const metric = units === 'metric'
  const cm = metric ? 'cm' : 'in'
  const unitsName = useId()
  const { library, matches } = useChosenMatches(pattern.palette.map((e) => e.hex))
  const libraryBall = library?.ball ?? null

  // Carried as the Work stage will show it, with the directions a new pattern gets.
  const carried = useMemo(
    () => carriedStitches({ ...PATTERN_DEFAULTS, ...pattern, id: '', name: '', created_at: 0, updated_at: 0, row_ids: [] } as Pattern),
    [pattern],
  )
  const swatch = {
    stitches: settings.swatchStitches,
    rows: settings.swatchRows,
    widthCm: settings.swatchWidthCm,
    heightCm: settings.swatchHeightCm,
    grams: settings.swatchGrams,
  }
  const inputs: UsageInputs = {
    swatch,
    yarnPerStitchCm: settings.yarnPerStitchCm,
    ball: {
      metres: settings.ballMetres ?? libraryBall?.metres ?? null,
      grams: settings.ballGrams ?? libraryBall?.grams ?? null,
    },
    marginPercent: settings.marginPercent,
    carried: settings.countCarried ? carried : null,
  }
  const usage = yarnUsage(pattern.palette, inputs)
  const size = finishedSize(pattern.cols, pattern.rows, swatch)
  const fromLibrary = library && libraryBall && settings.ballMetres === null && settings.ballGrams === null
  const ballNote = fromLibrary ? LIBRARY_LABELS[library.id] : null

  const exportList = () => {
    const text = usageText(usage, {
      patternName: name,
      cols: pattern.cols,
      rows: pattern.rows,
      inputs,
      units,
      ballNote,
      shades: library && matches ? matches.map((m) => matchName(library, m)) : undefined,
    })
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name} yarn.txt`)
  }

  const showMetres = usage.metres !== null
  const showGrams = usage.grams !== null
  const showBalls = usage.balls !== null
  const n = (x: number) => x.toLocaleString('en-GB')

  return (
    <Modal
      title="Yarn & size"
      className="yarn-dialog"
      onClose={onClose}
      buttons={
        <>
          <button type="button" className="button" onClick={exportList}>
            Export yarn list
          </button>
          <button type="button" className="button button--primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <fieldset className="yarn__units">
        <legend className="visually-hidden">Units</legend>
        {(['metric', 'imperial'] as const).map((u) => (
          <label key={u}>
            <input type="radio" name={unitsName} checked={units === u} onChange={() => set({ units: u })} />
            {UNIT_NAMES[u]}
          </label>
        ))}
      </fieldset>

      <section className="yarn__section" aria-labelledby={`${unitsName}-swatch`}>
        <h3 id={`${unitsName}-swatch`} className="yarn__heading">
          Your swatch
        </h3>
        <p className="yarn__help muted">
          Crochet a square in the yarn, hook and stitch you’ll use, lay it flat and measure it. Weigh it too, on a kitchen
          scale, for the closest yarn estimate.
        </p>
        <div className="yarn__inputs">
          <NumberField
            label="Stitches"
            unit=""
            value={swatch.stitches}
            places={0}
            min={POSITIVE}
            onCommit={(v) => v !== null && set({ swatchStitches: v })}
          />
          <NumberField
            label="Rows"
            unit=""
            value={swatch.rows}
            places={0}
            min={POSITIVE}
            onCommit={(v) => v !== null && set({ swatchRows: v })}
          />
          <NumberField
            label="Width"
            unit={cm}
            value={swatch.widthCm === null ? null : cmIn(swatch.widthCm, units)}
            places={2}
            min={POSITIVE}
            onCommit={(v) => set({ swatchWidthCm: v === null ? null : cmFrom(v, units) })}
          />
          <NumberField
            label="Height"
            unit={cm}
            value={swatch.heightCm === null ? null : cmIn(swatch.heightCm, units)}
            places={2}
            min={POSITIVE}
            onCommit={(v) => set({ swatchHeightCm: v === null ? null : cmFrom(v, units) })}
          />
          <NumberField
            label="Weight (optional)"
            unit="g"
            value={swatch.grams}
            places={1}
            min={POSITIVE}
            onCommit={(v) => set({ swatchGrams: v })}
          />
        </div>
        <p className="yarn__size" aria-live="polite">
          {size.widthCm !== null && size.heightCm !== null ? (
            <>
              Finished size: <strong>{formatSize(size.widthCm, size.heightCm, units)}</strong>, before any border
            </>
          ) : (
            <span className="muted">Enter your swatch’s width and height to see the finished size.</span>
          )}
        </p>
      </section>

      <section className="yarn__section" aria-labelledby={`${unitsName}-yarn`}>
        <h3 id={`${unitsName}-yarn`} className="yarn__heading">
          Yarn
        </h3>
        <div className="yarn__inputs">
          <NumberField
            label="Ball length"
            unit={metric ? 'm' : 'yd'}
            value={inputs.ball.metres === null ? null : metresIn(inputs.ball.metres, units)}
            places={1}
            min={POSITIVE}
            placeholder="from label"
            onCommit={(v) => set({ ballMetres: v === null ? null : metresFrom(v, units) })}
          />
          <NumberField
            label="Ball weight"
            unit="g"
            value={inputs.ball.grams}
            places={1}
            min={POSITIVE}
            placeholder="from label"
            onCommit={(v) => set({ ballGrams: v })}
          />
          {usage.basis === 'length' && (
            <NumberField
              label="Yarn per stitch"
              unit={cm}
              value={cmIn(settings.yarnPerStitchCm, units)}
              places={2}
              min={POSITIVE}
              onCommit={(v) => v !== null && set({ yarnPerStitchCm: cmFrom(v, units) })}
            />
          )}
          <NumberField
            label="Extra"
            unit="%"
            value={settings.marginPercent}
            places={1}
            min={{ value: 0, inclusive: true }}
            onCommit={(v) => v !== null && set({ marginPercent: v })}
          />
        </div>
        <p className="yarn__help muted">
          {usage.basis === 'weight'
            ? 'By your swatch’s weight. '
            : 'Without a weighed swatch, by yarn per stitch: work 10 stitches, pull them out, measure and divide by 10. '}
          {fromLibrary && `Ball: ${LIBRARY_LABELS[library.id]}. `}
          {!fromLibrary && library && libraryBall && (
            <button type="button" className="linklike" onClick={() => set({ ballMetres: null, ballGrams: null })}>
              Use {LIBRARY_LABELS[library.id]}’s ball
            </button>
          )}
        </p>
        <label className="yarn__check">
          <input type="checkbox" checked={settings.countCarried} onChange={(e) => set({ countCarried: e.target.checked })} />
          Count yarn carried inside the stitches (tapestry crochet)
        </label>
        {usage.carriedMissing && (
          <p className="yarn__help yarn__warn">
            {usage.carriedMissing === 'width'
              ? 'Enter your swatch’s width to count carried yarn: a carried strand takes about one stitch’s width.'
              : 'Enter the ball’s length and weight to count carried yarn by weight.'}
          </p>
        )}
      </section>

      <table className="yarn__table">
        <caption className="visually-hidden">Yarn for each colour</caption>
        <thead>
          <tr>
            <th scope="col">Colour</th>
            <th scope="col">Stitches</th>
            {showMetres && <th scope="col">{metric ? 'Metres' : 'Yards'}</th>}
            {showGrams && <th scope="col">Grams</th>}
            {showBalls && <th scope="col">Balls</th>}
          </tr>
        </thead>
        <tbody>
          {usage.colours.map((c) => (
            <tr key={c.entry.id}>
              <th scope="row" title={c.entry.name || undefined}>
                <span className="yarn__swatch" style={{ background: c.entry.hex }} aria-hidden="true" />
                {c.entry.name || 'Unnamed'}
              </th>
              <td title={c.carried ? `And carried inside ${n(c.carried)}` : undefined}>{n(c.stitches)}</td>
              {showMetres && <td>{formatLength(c.metres!, units).replace(/ (m|yd)$/, '')}</td>}
              {showGrams && <td>{formatWeight(c.grams!).replace(/ g$/, '')}</td>}
              {showBalls && <td>{c.balls}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{n(usage.stitches)}</td>
            {showMetres && <td>{formatLength(usage.metres!, units).replace(/ (m|yd)$/, '')}</td>}
            {showGrams && <td>{formatWeight(usage.grams!).replace(/ g$/, '')}</td>}
            {showBalls && <td>{usage.balls}</td>}
          </tr>
        </tfoot>
      </table>
      {!showBalls && <p className="yarn__help muted">Enter a ball’s length or weight, from its label, to count balls.</p>}
      <p className="yarn__help muted">
        An estimate, rounded up: one stitch per cell
        {usage.carried > 0 ? `, and ${n(usage.carried)} stitches of carried yarn` : ''}. Ends, a foundation chain and
        borders aren’t counted; the extra is for those.
      </p>
    </Modal>
  )
}
