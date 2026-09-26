/**
 * The confirm screen's controls: the grid (Crop, Re-detect), then how colours are merged
 * (colour detail).
 *
 * Only Crop and Re-detect detect again. Colour detail only resamples.
 */
import { useId } from 'react'

import { deltaEFromSlider, MAX_DELTA_E, MIN_DELTA_E, sliderFromDeltaE } from '../../importer/controls.ts'

export interface ControlsProps {
  deltaE: number
  cropping: boolean
  /** Colour detail needs a detected grid to adjust. */
  canAdjust: boolean
  /** Crop and Re-detect need an image, and nothing detecting. */
  canDetect: boolean
  onDeltaE: (deltaE: number) => void
  onCropping: (on: boolean) => void
  onRedetect: () => void
}

export function Controls(p: ControlsProps) {
  const id = useId()
  return (
    <div className="controls">
      <div className="controls__group" role="group" aria-label="Grid">
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
    </div>
  )
}
