/**
 * The confirm screen's controls: Re-detect. Cropping and moving the grid's outline are
 * done on the image itself (SourceView.tsx).
 *
 * There is no colour setting: similar colours are merged at a fixed ΔE
 * (alphareader/core/detect/palette.py, DEFAULT_DELTA_E), chosen so a chart comes out with
 * as few yarns as it really has. A colour left over can be removed from the colour list
 * (Palette.tsx), or deleted in Design; either gives its cells the nearest remaining one.
 */
export interface ControlsProps {
  /** Re-detect needs an image, and nothing detecting. */
  canDetect: boolean
  onRedetect: () => void
}

export function Controls(p: ControlsProps) {
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
    </div>
  )
}
