/**
 * The Work chart on screen: a canvas the size of the chart area, drawn by render/chart.ts
 * from the layout in render/layout.ts.
 *
 * Scrolling is native: a transparent scroller over the canvas holds a spacer the size of
 * the whole chart, so touch momentum and scrollbars behave as usual, and each scroll
 * event redraws the canvas from the new offset on the next animation frame. Whenever the
 * layout changes (the current row moves, the window resizes, a setting changes), the
 * scroller is moved to keep the current row in view; and whenever your place in the row
 * changes, it's moved across to keep that in view on a chart wider than the screen.
 *
 * The chart is laid out in the scroller's content box, which leaves out a classic
 * (non-overlay) scrollbar, so nothing sits under one. The axis a chart scrolls along
 * always shows its scrollbar, so whether there is one never depends on the size measured
 * with it, and can't flip back and forth.
 *
 * Pinch (two fingers, ui/gestures.ts) or Ctrl/⌘ + wheel zooms: it scales the base cell
 * size the layout picks (`zoom`), never the canvas, so rows keep their own heights and
 * the lines stay sharp. The point under the fingers stays still, and the chart is left
 * where the zoom put it until the next progress change follows your place again, as
 * after a scroll by hand. One finger still scrolls natively. The zoom lives here, so it
 * is back to 1× whenever the Work stage is opened.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { TwoFingers, scrollAbout, type PinchStep } from '../gestures.ts'

import { buildCellImage, drawChart, type ChartColors } from '../../render/chart.ts'
import { readColors, useDarkScheme } from '../chartColors.ts'
import {
  AXIS_LEFT,
  AXIS_TOP,
  PAD,
  MAX_ZOOM,
  computeLayout,
  followCurrent,
  followCurrentX,
  type RowPlace,
} from '../../render/layout.ts'
import type { Pattern } from '../../model/types.ts'

export interface ChartViewProps {
  pattern: Pattern
  /** Image rows that are complete. */
  completed: ReadonlySet<number>
  /** The image row being worked, or null when the pattern is finished. */
  current: number | null
  emphasise: boolean
  focus: boolean
  /** Changes when the theme does, so the colours are read again. */
  themeKey: string
  label: string
  /** Your place in the current row, followed across. A new object on every progress
   *  change, so a scroll by hand is undone by the next one. */
  place?: RowPlace | null
}

const MAX_DPR = 2

export function ChartView({
  pattern,
  completed,
  current,
  emphasise,
  focus,
  themeKey,
  label,
  place = null,
}: ChartViewProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const colors = useRef<ChartColors | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [dpr, setDpr] = useState(() => Math.min(MAX_DPR, globalThis.devicePixelRatio || 1))
  const dark = useDarkScheme()
  const [zoom, setZoom] = useState(1)

  // The chart area's size, kept current by a ResizeObserver: the scroller's content box,
  // which a scrollbar appearing or going changes too.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => {
      const width = el.clientWidth
      const height = el.clientHeight
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
      setDpr(Math.min(MAX_DPR, globalThis.devicePixelRatio || 1))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      addEventListener('resize', measure)
      return () => removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(wrap.current!)
    return () => ro.disconnect()
  }, [])

  // Redrawn only when the pattern's cells or colours change.
  const { cells, palette, rows, cols } = pattern
  const image = useMemo(() => buildCellImage({ cells, palette, rows, cols }), [cells, palette, rows, cols])

  const layout = useMemo(
    () =>
      computeLayout({
        rows: pattern.rows,
        cols: pattern.cols,
        current,
        width: size.width,
        height: size.height,
        emphasise,
        focus,
        dpr,
        zoom,
      }),
    [pattern.rows, pattern.cols, current, size.width, size.height, emphasise, focus, dpr, zoom],
  )

  // The latest draw, for the scroll handler and animation frames. Set in an effect, before
  // the effects below that call it.
  const draw = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    draw.current = () => {
      const el = canvas.current
      const sc = scroller.current
      const ctx = el && image ? el.getContext('2d') : null
      if (!ctx || !sc || !image || size.width === 0) return
      colors.current ??= readColors(wrap.current!)
      drawChart(ctx, {
        layout,
        image,
        pattern,
        completed,
        scrollX: sc.scrollLeft,
        scrollY: sc.scrollTop,
        width: size.width,
        height: size.height,
        dpr,
        colors: colors.current,
      })
    }
  })

  const schedule = () => {
    if (frame.current) return
    frame.current = (globalThis.requestAnimationFrame ?? setTimeout)(() => {
      frame.current = 0
      draw.current()
    })
  }
  useEffect(() => () => (globalThis.cancelAnimationFrame ?? clearTimeout)(frame.current), [])

  // Size the canvas backing store for the device.
  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    el.width = Math.round(size.width * dpr)
    el.height = Math.round(size.height * dpr)
  }, [size.width, size.height, dpr])

  useLayoutEffect(() => {
    colors.current = null
  }, [themeKey, dark])

  // Follow the current row whenever the layout changes (and only then, so a scroll to look
  // ahead is left alone until the next row), and your place in it across whenever that
  // changes too: every progress change is a new `place`. A scroll by hand stays until the
  // next one. The first placement is instant; later moves glide, unless the user asked
  // for less motion.
  const placed = useRef(false)
  const followed = useRef<typeof layout | null>(null)
  /** A zoom asked for about this point (in the scroller's view): where it was, and the
   *  cell size then. The layout it makes keeps the point still instead of following. */
  const anchor = useRef<{ x: number; y: number; cell: number } | null>(null)
  useLayoutEffect(() => {
    const sc = scroller.current
    if (!sc || size.width === 0) return
    const a = anchor.current
    if (a && followed.current && followed.current !== layout) {
      anchor.current = null
      followed.current = layout
      const ratio = layout.cell / a.cell
      sc.scrollLeft = scrollAbout(sc.scrollLeft, a.x - AXIS_LEFT, ratio)
      sc.scrollTop = scrollAbout(sc.scrollTop, a.y - AXIS_TOP, ratio)
      return
    }
    // Only the axes that move, so a glide already under way on the other one carries on.
    const to: { top?: number; left?: number } = {}
    if (followed.current !== layout) {
      const top = followCurrent(layout, sc.scrollTop)
      if (Math.abs(top - sc.scrollTop) > 0.5) to.top = top
    }
    followed.current = layout
    const left = followCurrentX(layout, place, sc.scrollLeft)
    if (Math.abs(left - sc.scrollLeft) > 0.5) to.left = left
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (to.top !== undefined || to.left !== undefined) {
      if (placed.current && !reduce && typeof sc.scrollTo === 'function') sc.scrollTo({ ...to, behavior: 'smooth' })
      else {
        if (to.top !== undefined) sc.scrollTop = to.top
        if (to.left !== undefined) sc.scrollLeft = to.left
      }
    }
    placed.current = true
  }, [layout, place, size.width])

  // --- zoom: pinch, or Ctrl/⌘ + wheel (a trackpad's pinch arrives as that too) --------------
  const latestCell = useRef(layout.cell)
  useLayoutEffect(() => {
    latestCell.current = layout.cell
  })
  const zoomNow = useRef(zoom)
  useLayoutEffect(() => {
    zoomNow.current = zoom
  })
  const zoomTo = useRef((to: number, x: number, y: number) => {
    const z = Math.max(1, Math.min(MAX_ZOOM, to))
    // Nothing to do at either end; and an anchor left set would stop the next progress
    // change from following.
    if (Math.abs(z - zoomNow.current) < 1e-3) return
    anchor.current = { x, y, cell: latestCell.current }
    zoomNow.current = z
    setZoom(z)
  })
  useEffect(() => {
    const sc = scroller.current
    if (!sc) return
    const at = (x: number, y: number) => {
      const r = sc.getBoundingClientRect()
      return { x: x - r.left - sc.clientLeft, y: y - r.top - sc.clientTop }
    }
    const fingers = new TwoFingers()
    let target = 1
    const step = (s: PinchStep) => {
      sc.scrollLeft -= s.dx
      sc.scrollTop -= s.dy
      target = Math.max(1, Math.min(MAX_ZOOM, target * s.scale))
      const p = at(s.mid.x, s.mid.y)
      zoomTo.current(target, p.x, p.y)
    }
    const onStart = (e: TouchEvent) => {
      for (const t of e.changedTouches) {
        if (fingers.down(t.identifier, { x: t.clientX, y: t.clientY })) target = zoomNow.current
      }
    }
    const onMove = (e: TouchEvent) => {
      for (const t of e.changedTouches) {
        const s = fingers.move(t.identifier, { x: t.clientX, y: t.clientY })
        if (s) step(s)
      }
      // Two fingers are the app's: no native scroll, and never the page's own zoom.
      if (fingers.pinching && e.cancelable) e.preventDefault()
    }
    const onEnd = (e: TouchEvent) => {
      for (const t of e.changedTouches) fingers.up(t.identifier)
    }
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return
      e.preventDefault()
      const p = at(e.clientX, e.clientY)
      zoomTo.current(zoomNow.current * Math.exp(-e.deltaY / 200), p.x, p.y)
    }
    sc.addEventListener('touchstart', onStart, { passive: true })
    sc.addEventListener('touchmove', onMove, { passive: false })
    sc.addEventListener('touchend', onEnd)
    sc.addEventListener('touchcancel', onEnd)
    sc.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      sc.removeEventListener('touchstart', onStart)
      sc.removeEventListener('touchmove', onMove)
      sc.removeEventListener('touchend', onEnd)
      sc.removeEventListener('touchcancel', onEnd)
      sc.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Anything drawn changed.
  useLayoutEffect(() => draw.current(), [layout, image, pattern, completed, dpr, themeKey, dark])

  // A tall chart scrolls down and a wide one across (layout.ts, shouldScroll); zoomed in,
  // any chart may scroll both ways.
  const scrolls = zoom > 1 ? 'both' : layout.mode === 'scroll' ? (pattern.rows > pattern.cols ? 'y' : 'x') : null
  return (
    <div ref={wrap} className="chart" role="img" aria-label={label}>
      <canvas
        ref={canvas}
        className="chart__canvas"
        aria-hidden="true"
        style={{ width: size.width, height: size.height }}
      />
      <div
        ref={scroller}
        className="chart__scroller"
        style={
          scrolls === 'both'
            ? { overflow: 'scroll' }
            : scrolls === 'y'
              ? { overflowY: 'scroll' }
              : scrolls === 'x'
                ? { overflowX: 'scroll' }
                : undefined
        }
        onScroll={schedule}
        data-testid="chart-scroller"
        data-zoom={zoom}
        data-cell={layout.cell}
      >
        <div
          style={{
            width: AXIS_LEFT + layout.gridWidth + PAD,
            height: AXIS_TOP + layout.gridHeight + PAD,
          }}
        />
      </div>
      {zoom > 1 && (
        <button
          type="button"
          className="button button--small chart__unzoom"
          onClick={() => {
            anchor.current = null
            setZoom(1)
          }}
        >
          {zoom.toFixed(1)}× · Fit
        </button>
      )}
    </div>
  )
}
