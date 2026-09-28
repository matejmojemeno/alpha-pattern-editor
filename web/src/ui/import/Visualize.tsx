/**
 * "Visualize", beside "Yarn & size" on the import screen: the pattern as it would look
 * crocheted, in the stitch chosen (stitch/), for the pattern as it will be saved.
 *
 * What's measured and what's drawn: each stitch's proportions come from published gauges
 * (stitch/README.md), or from the swatch entered in "Yarn & size"; the stitches' look is
 * drawn from how each is made. The choices are app-wide settings, like the swatch: they
 * describe how the crocheter works, not the chart.
 *
 * Loaded lazily from the import screen: its renderer is only fetched when opened.
 */
import '../visualize.css'

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { useSettings } from '../../app/context.ts'
import { carryPlan } from '../../logic/carry.ts'
import { PATTERN_DEFAULTS, type Pattern } from '../../model/types.ts'
import { shapeText, stitchById, STITCHES, swatchAspect, type StitchId } from '../../stitch/catalogue.ts'
import { carriedCells, FabricPainter, type Fabric } from '../../stitch/fabric.ts'
import { TwoFingers } from '../gestures.ts'
import { Modal } from '../components.tsx'
import { useElementSize } from '../hooks.ts'
import type { EstimatedPattern } from './YarnEstimate.tsx'

interface ViewState {
  /** A stitch's width, in CSS pixels. */
  stitch: number
  x: number
  y: number
}

/** The largest stitch the view zooms to, in CSS pixels. */
const MAX_STITCH = 120

export default function Visualize({ pattern, onClose }: { pattern: EstimatedPattern; onClose: () => void }) {
  const [settings, set] = useSettings()
  const ids = useId()
  const stitch = stitchById(settings.visualStitch)
  const turns = stitch.turns === 'always' ? 'turned' : settings.visualRows
  const swatch = swatchAspect({
    stitches: settings.swatchStitches,
    rows: settings.swatchRows,
    widthCm: settings.swatchWidthCm,
    heightCm: settings.swatchHeightCm,
  })
  const mine = settings.visualSwatch && swatch !== null
  const aspect = mine ? swatch : stitch.aspect
  const showCarried = settings.visualCarried && stitch.id !== 'c2c'

  const carried = useMemo(() => {
    if (!showCarried) return null
    const p = {
      ...PATTERN_DEFAULTS,
      ...pattern,
      alternate_direction: turns === 'turned',
      id: '',
      name: '',
      created_at: 0,
      updated_at: 0,
      row_ids: [],
    } as unknown as Pattern
    return carriedCells(pattern.rows, pattern.cols, pattern.cells, carryPlan(p))
  }, [pattern, showCarried, turns])

  const fabric: Fabric = useMemo(
    () => ({
      rows: pattern.rows,
      cols: pattern.cols,
      cells: pattern.cells,
      colours: pattern.palette.map((e) => e.hex),
      stitch: stitch.id,
      mode: turns,
      aspect,
      carried,
    }),
    [pattern, stitch.id, turns, aspect, carried],
  )

  return (
    <Modal
      title="Visualize"
      className="visualize-dialog"
      onClose={onClose}
      buttons={
        <button type="button" className="button button--primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="viz__controls">
        <label className="viz__field">
          <span>Stitch</span>
          <select value={stitch.id} onChange={(e) => set({ visualStitch: e.target.value as StitchId })}>
            {STITCHES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="viz__choice" disabled={stitch.turns === 'always'}>
          <legend>Rows</legend>
          <label>
            <input type="radio" name={`${ids}-rows`} checked={turns === 'turned'} onChange={() => set({ visualRows: 'turned' })} />
            Turned at each end
          </label>
          <label>
            <input type="radio" name={`${ids}-rows`} checked={turns === 'rs'} onChange={() => set({ visualRows: 'rs' })} />
            Right side always facing
          </label>
        </fieldset>
        <fieldset className="viz__choice">
          <legend>Proportions</legend>
          <label>
            <input type="radio" name={`${ids}-shape`} checked={!mine} onChange={() => set({ visualSwatch: false })} />
            Typical
          </label>
          <label title={swatch === null ? 'Enter your swatch’s width and height in “Yarn & size” first' : undefined}>
            <input
              type="radio"
              name={`${ids}-shape`}
              checked={mine}
              disabled={swatch === null}
              onChange={() => set({ visualSwatch: true })}
            />
            My swatch
          </label>
        </fieldset>
        <label className="viz__check">
          <input
            type="checkbox"
            checked={showCarried}
            disabled={stitch.id === 'c2c'}
            onChange={(e) => set({ visualCarried: e.target.checked })}
          />
          Show carried yarn
        </label>
      </div>
      <p className="viz__note muted">{stitch.note}</p>

      <FabricView fabric={fabric} />

      <p className="viz__shape" aria-live="polite">
        {shapeText(aspect)}{' '}
        <span className="muted">
          {mine
            ? `From your swatch: ${settings.swatchStitches} stitches × ${settings.swatchRows} rows.`
            : `Typical proportions, from ${stitch.gauges.length === 1 ? 'a published gauge' : `${stitch.gauges.length} published gauges`}; your yarn, hook and tension change them. The look of each stitch is drawn, not photographed.`}
        </span>
      </p>
    </Modal>
  )
}

/** The fabric on a canvas: fitted when its shape changes; wheel, drag and pinch zoom. */
function FabricView({ fabric }: { fabric: Fabric }) {
  const [stage, size] = useElementSize<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const painter = useRef(new FabricPainter())
  /** The view, and the fitted view it was moved from: a new fit starts again from it. */
  const [moved, setMoved] = useState<{ from: ViewState; view: ViewState } | null>(null)
  const fingers = useRef(new TwoFingers())
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)

  const fit = useMemo(() => {
    if (!size.width || !size.height) return null
    const stitch = Math.min(size.width / fabric.cols, size.height / (fabric.rows * fabric.aspect)) * 0.94
    return {
      stitch,
      x: (size.width - stitch * fabric.cols) / 2,
      y: (size.height - stitch * fabric.aspect * fabric.rows) / 2,
    }
  }, [size.width, size.height, fabric.cols, fabric.rows, fabric.aspect])

  // A new shape, or a new stage: start from the whole pattern.
  const view = fit && moved?.from === fit ? moved.view : fit
  const setView = (next: ViewState | null | ((v: ViewState | null) => ViewState | null)) =>
    setMoved((m) => {
      if (!fit) return null
      const was = m?.from === fit ? m.view : fit
      const v = typeof next === 'function' ? next(was) : next
      return v ? { from: fit, view: v } : null
    })

  useEffect(() => {
    const el = canvas.current
    if (!el || !view || !size.width) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(size.width * dpr)
    const h = Math.round(size.height * dpr)
    if (el.width !== w) el.width = w
    if (el.height !== h) el.height = h
    const frame = requestAnimationFrame(() => {
      const ctx = el.getContext('2d')
      if (ctx) painter.current.draw(ctx, fabric, { stitch: view.stitch * dpr, x: view.x * dpr, y: view.y * dpr })
    })
    return () => cancelAnimationFrame(frame)
  }, [fabric, view, size.width, size.height])

  const zoom = (ratio: number, at: { x: number; y: number }) =>
    setView((v) => {
      if (!v || !fit) return v
      const stitch = Math.max(fit.stitch * 0.5, Math.min(MAX_STITCH, v.stitch * ratio))
      const k = stitch / v.stitch
      return { stitch, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }
    })
  const centre = () => ({ x: size.width / 2, y: size.height / 2 })

  // Wheel zoom needs a non-passive listener to keep the page (and the dialog) still.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      zoom(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), { x: e.clientX - box.left, y: e.clientY - box.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const local = (e: ReactPointerEvent) => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The zoom buttons sit on the stage: capturing their pointer would swallow the click.
    if ((e.target as Element).closest('button')) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = local(e)
    if (fingers.current.down(e.pointerId, p)) drag.current = null
    else if (fingers.current.count === 1) drag.current = { id: e.pointerId, ...p }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e)
    const step = fingers.current.move(e.pointerId, p)
    if (step) {
      zoom(step.scale, step.mid)
      setView((v) => v && { ...v, x: v.x + step.dx, y: v.y + step.dy })
      return
    }
    const d = drag.current
    if (d && d.id === e.pointerId && !fingers.current.pinching) {
      setView((v) => v && { ...v, x: v.x + p.x - d.x, y: v.y + p.y - d.y })
      drag.current = { id: d.id, ...p }
    }
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    fingers.current.up(e.pointerId)
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  return (
    <div
      ref={stage}
      className="viz__stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvas} className="viz__canvas" role="img" aria-label="The pattern, crocheted" />
      <div className="viz__zoom">
        <button type="button" className="button button--small" aria-label="Zoom out" onClick={() => zoom(1 / 1.5, centre())}>
          −
        </button>
        <button type="button" className="button button--small" onClick={() => setView(fit)}>
          Fit
        </button>
        <button type="button" className="button button--small" aria-label="Zoom in" onClick={() => zoom(1.5, centre())}>
          +
        </button>
      </div>
    </div>
  )
}
