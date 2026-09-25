/**
 * The confirm screen's controls, in the desktop's three groups (confirm_window.py): the
 * grid (rows, cols, Crop, Re-detect), then how colours are merged (colour detail), then
 * what's shown (flag unsure cells).
 *
 * Only Crop and Re-detect detect again. Everything else only resamples.
 */
import { useId } from 'react'

import { deltaEFromSlider, MAX_DELTA_E, MAX_DIM, MIN_DELTA_E, MIN_DIM, sliderFromDeltaE } from '../../importer/controls.ts'

export interface ControlsProps {
  rows: string
  cols: string
  deltaE: number
  flagUnsure: boolean
  cropping: boolean
  /** Rows, cols and colour detail need a detected grid to adjust. */
  canAdjust: boolean
  /** Crop and Re-detect need an image, and nothing detecting. */
  canDetect: boolean
  onRows: (text: string) => void
  onCols: (text: string) => void
  onStep: (axis: 'rows' | 'cols', by: 1 | -1) => void
  onDimBlur: () => void
  onDeltaE: (deltaE: number) => void
  onFlagUnsure: (on: boolean) => void
  onCropping: (on: boolean) => void
  onRedetect: () => void
}

export function Controls(p: ControlsProps) {
  const id = useId()
  const dimProps = { canAdjust: p.canAdjust, onStep: p.onStep, onDimBlur: p.onDimBlur }
  return (
    <div className="controls">
      <div className="controls__group" role="group" aria-label="Grid">
        <Dim id={`${id}-rows`} label="Rows" axis="rows" value={p.rows} onText={p.onRows} {...dimProps} />
        <Dim id={`${id}-cols`} label="Cols" axis="cols" value={p.cols} onText={p.onCols} {...dimProps} />
        <span className="controls__detect">
          <button
            type="button"
            className="button"
            aria-pressed={p.cropping}
            disabled={!p.canDetect}
            title="Drag a box around just the grid, then let go"
            onClick={() => p.onCropping(!p.cropping)}
          >
            Crop
          </button>
          <button type="button" className="button" disabled={!p.canDetect} onClick={p.onRedetect}>
            Re-detect
          </button>
        </span>
      </div>
      <div className="controls__group controls__detail">
        {/* "ΔE" is the detector's unit; what the slider decides is how many colours you get. */}
        <label htmlFor={`${id}-detail`}>Colour detail</label>
        <span className="controls__end muted" aria-hidden="true">
          fewer
        </span>
        <input
          id={`${id}-detail`}
          type="range"
          min={MIN_DELTA_E}
          max={MAX_DELTA_E}
          step={1}
          value={sliderFromDeltaE(p.deltaE)}
          disabled={!p.canAdjust}
          title={`Lower = more separate colours (ΔE ${p.deltaE})`}
          aria-valuetext={`ΔE ${p.deltaE}`}
          onChange={(e) => p.onDeltaE(deltaEFromSlider(Number(e.target.value)))}
        />
        <span className="controls__end muted" aria-hidden="true">
          more
        </span>
      </div>
      <label className="controls__group controls__check" title="Cross out cells the detector isn't confident about">
        <input type="checkbox" checked={p.flagUnsure} onChange={(e) => p.onFlagUnsure(e.target.checked)} />
        Flag unsure cells
      </label>
    </div>
  )
}

function Dim({
  id,
  label,
  axis,
  value,
  canAdjust,
  onText,
  onStep,
  onDimBlur,
}: {
  id: string
  label: string
  axis: 'rows' | 'cols'
  value: string
  onText: (text: string) => void
} & Pick<ControlsProps, 'canAdjust' | 'onStep' | 'onDimBlur'>) {
  const noun = axis === 'rows' ? 'rows' : 'columns'
  return (
    <span className="dim">
      <label htmlFor={id}>{label}</label>
      <button type="button" className="button dim__step" aria-label={`Fewer ${noun}`} disabled={!canAdjust} onClick={() => onStep(axis, -1)}>
        −
      </button>
      <input
        id={id}
        className="dim__input"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        enterKeyHint="done"
        aria-describedby={`${id}-range`}
        value={value}
        disabled={!canAdjust}
        onChange={(e) => onText(e.target.value)}
        onBlur={onDimBlur}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            onStep(axis, e.key === 'ArrowUp' ? 1 : -1)
          }
        }}
      />
      <span id={`${id}-range`} className="visually-hidden">
        {MIN_DIM} to {MAX_DIM}
      </span>
      <button type="button" className="button dim__step" aria-label={`More ${noun}`} disabled={!canAdjust} onClick={() => onStep(axis, 1)}>
        +
      </button>
    </span>
  )
}
