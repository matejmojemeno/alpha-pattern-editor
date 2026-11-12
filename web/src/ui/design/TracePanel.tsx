/**
 * "Image to trace" in the Design stage: an image laid see-through on the chart, to paint
 * the cells over it as on tracing paper.
 *
 * Without one, the section is a single drop tile ("Add an image to trace"), which takes
 * a click or a dropped file; a file dropped on the chart does the same (screens/Design.tsx).
 * With one: a thumbnail; Show (Off, Behind the cells painted, On top of every cell; `T`
 * turns it off and on); how strongly it shows; Move (the chart then places the image
 * instead of painting) and Fit; Replace and Remove.
 *
 * The screen keeps the image and saves it with the project; this is only its controls.
 */
import { useId, useRef, useState } from 'react'

import { MAX_OPACITY, MIN_OPACITY, type TraceShow } from '../../design/trace.ts'
import { draggingFiles, droppedImage } from '../../design/traceImage.ts'
import { AddImageIcon, DeleteIcon, FitIcon, PlaceIcon } from './icons.tsx'

export interface TracePanelProps {
  /** The image there is (an object URL for its thumbnail), or null. */
  image: { url: string; opacity: number; show: TraceShow } | null
  /** Being moved or resized on the chart. */
  placing: boolean
  /** An image is being prepared: the controls wait. */
  busy: boolean
  onFile: (file: File) => void
  onShow: (show: TraceShow) => void
  onOpacity: (opacity: number) => void
  onPlacing: (placing: boolean) => void
  onFit: () => void
  onRemove: () => void
}

const SHOW: readonly { show: TraceShow; label: string; title: string }[] = [
  { show: 'off', label: 'Off', title: 'Hide the image (T)' },
  { show: 'behind', label: 'Behind', title: 'Behind the cells you paint: it shows through the cells still the background colour' },
  { show: 'over', label: 'On top', title: 'Over every cell, to check what you’ve painted against it' },
]

export function TracePanel(props: TracePanelProps) {
  const { image, placing, busy } = props
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const pct = image ? Math.round(image.opacity * 100) : 0

  return (
    <section className="trace" aria-labelledby={`${id}-heading`} aria-busy={busy}>
      <h2 id={`${id}-heading`} className="design__heading">
        Image to trace
      </h2>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="trace__input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) props.onFile(f)
        }}
      />
      {!image ? (
        <button
          type="button"
          className="trace__drop"
          data-over={over}
          disabled={busy}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            if (!draggingFiles(e)) return
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            const f = droppedImage(e)
            if (f) props.onFile(f)
          }}
        >
          <AddImageIcon />
          <span>{busy ? 'Adding…' : 'Add an image to trace'}</span>
        </button>
      ) : (
        <div className="trace__body">
          <div className="trace__preview" data-shown={image.show !== 'off'}>
            <img src={image.url} alt="" className="trace__thumb" />
          </div>
          <fieldset className="options__choice trace__show">
            <legend>
              Show <kbd className="tool__key">T</kbd>
            </legend>
            <div className="choice choice--three">
              {SHOW.map((s) => (
                <label key={s.show} className="choice__option" title={s.title}>
                  <input type="radio" name={`${id}-show`} checked={image.show === s.show} onChange={() => props.onShow(s.show)} />
                  {s.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="trace__opacity">
            <span className="trace__opacity-label">
              Opacity <output>{pct}%</output>
            </span>
            <input
              type="range"
              min={MIN_OPACITY * 100}
              max={MAX_OPACITY * 100}
              step={5}
              value={pct}
              disabled={image.show === 'off'}
              aria-valuetext={`${pct}%`}
              onChange={(e) => props.onOpacity(Number(e.target.value) / 100)}
            />
          </label>
          <div className="trace__row">
            <button
              type="button"
              className="button button--small trace__place"
              aria-pressed={placing}
              aria-label="Move or resize"
              title={placing ? 'Go back to painting (Esc)' : 'Move or resize it: drag the image on the chart, or one of its corners'}
              onClick={() => props.onPlacing(!placing)}
            >
              <PlaceIcon />
              {placing ? 'Done' : 'Move'}
            </button>
            <button
              type="button"
              className="button button--small"
              aria-label="Fit to pattern"
              title="Fit to the pattern: as large as fits, centred"
              onClick={props.onFit}
            >
              <FitIcon />
              Fit
            </button>
          </div>
          <div className="trace__row">
            <button type="button" className="button button--small" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Adding…' : 'Replace…'}
            </button>
            <button type="button" className="button button--small" aria-label="Remove the image" title="Remove the image" onClick={props.onRemove}>
              <DeleteIcon />
              Remove
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
