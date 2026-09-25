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
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { buildCellImage, drawChart, type ChartColors } from '../../render/chart.ts'
import {
  AXIS_LEFT,
  AXIS_TOP,
  PAD,
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

function readColors(el: HTMLElement): ChartColors {
  const s = getComputedStyle(el)
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  return {
    background: v('--bg', '#ffffff'),
    text: v('--text', '#1d1d1f'),
    axis: v('--axis', '#888888'),
    accent: v('--accent', '#f0a800'),
    fontFamily: s.fontFamily || 'system-ui, sans-serif',
  }
}

function useDarkScheme(): boolean {
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  const [dark, setDark] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const on = () => setDark(query.matches)
    query.addEventListener?.('change', on)
    return () => query.removeEventListener?.('change', on)
  }, [query])
  return dark
}

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
      }),
    [pattern.rows, pattern.cols, current, size.width, size.height, emphasise, focus, dpr],
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
  useLayoutEffect(() => {
    const sc = scroller.current
    if (!sc || size.width === 0) return
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

  // Anything drawn changed.
  useLayoutEffect(() => draw.current(), [layout, image, pattern, completed, dpr, themeKey, dark])

  // A tall chart scrolls down and a wide one across (layout.ts, shouldScroll).
  const scrolls = layout.mode === 'scroll' ? (pattern.rows > pattern.cols ? 'y' : 'x') : null
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
        style={scrolls === 'y' ? { overflowY: 'scroll' } : scrolls === 'x' ? { overflowX: 'scroll' } : undefined}
        onScroll={schedule}
        data-testid="chart-scroller"
      >
        <div
          style={{
            width: AXIS_LEFT + layout.gridWidth + PAD,
            height: AXIS_TOP + layout.gridHeight + PAD,
          }}
        />
      </div>
    </div>
  )
}
