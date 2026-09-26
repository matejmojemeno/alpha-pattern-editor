/**
 * The confirm screen's controls: the grid (Re-detect), then how colours are merged
 * (colour detail). Cropping is done on the image itself (SourceView.tsx).
 *
 * Only Re-detect detects again. Colour detail only resamples.
 */
import { useId } from 'react'

import { deltaEFromSlider, MAX_DELTA_E, MIN_DELTA_E, sliderFromDeltaE } from '../../importer/controls.ts'

export interface ControlsProps {
  deltaE: number
  /** Colour detail needs a detected grid to adjust. */
  canAdjust: boolean
  /** Re-detect needs an image, and nothing detecting. */
  canDetect: boolean
  onDeltaE: (deltaE: number) => void
  onRedetect: () => void
}

export function Controls(p: ControlsProps) {
  const id = useId()
  return (
    <div className="controls">
      <div className="controls__group" role="group" aria-label="Grid">
        <button
          type="button"
          className="button"
          disabled={!p.canDetect}
          title="Find the grid again in the whole image"
          onClick={p.onRedetect}
        >
          Re-detect
        </button>
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
