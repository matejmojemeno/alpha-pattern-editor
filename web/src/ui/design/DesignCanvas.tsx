/**
 * The Design canvas on screen: a port of design_canvas.py.
 *
 * As on the Work chart (ChartView.tsx), the canvas is the size of the view, and a
 * transparent scroller over it holds a spacer the size of the whole chart, so scrolling
 * is native. Each scroll or change redraws on the next animation frame, from the
 * offscreen image of the cells (render/design.ts).
 *
 * Input is pointer events on the scroller, so a mouse, a pen and a finger all paint.
 * The pointer is captured on press, so a drag that leaves the chart keeps going (to its
 * edge). Ctrl/⌘ + wheel zooms about the pointer; a bare wheel scrolls.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Pattern } from '../../model/types.ts'
import { buildCellImage, type ChartColors } from '../../render/chart.ts'
import { cellAt, contentSize, drawDesign, zoomScroll, type Cell } from '../../render/design.ts'
import type { Tool } from '../../design/editor.ts'
import { readColors, useDarkScheme } from '../chartColors.ts'

const MAX_DPR = 2

/** A crosshair where cells are placed precisely; a hand where something is picked. */
const CURSORS: Record<Tool, string> = {
  paint: 'crosshair',
  rect: 'crosshair',
  row: 'crosshair',
  col: 'crosshair',
  fill: 'pointer',
  eyedropper: 'pointer',
}

export interface DesignCanvasProps {
  pattern: Pattern
  /** Cell size in CSS pixels (the zoom). */
  cell: number
  tool: Tool
  preview: { a: Cell; b: Cell; hex: string } | null
  onDown: (cell: Cell) => void
  onMove: (cell: Cell) => void
  onUp: (cell: Cell | null) => void
  onCancel: () => void
  /** Ctrl/⌘ + wheel: zoom in (dir > 0) or out. The canvas keeps the point under the
   *  pointer still once the new cell size arrives. */
  onZoom: (dir: number) => void
  /** The view's size, for fitting the pattern to it. */
  onViewport: (size: { width: number; height: number }) => void
  themeKey: string
  label: string
}

export function DesignCanvas(props: DesignCanvasProps) {
  const { pattern, cell, tool, preview, themeKey } = props
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const colors = useRef<ChartColors | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [dpr, setDpr] = useState(() => Math.min(MAX_DPR, globalThis.devicePixelRatio || 1))
  const dark = useDarkScheme()
  // The latest props, for the event listeners attached once.
  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  })

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
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (size.width > 0) latest.current.onViewport(size)
  }, [size])

  const { cells, palette, rows, cols } = pattern
  const image = useMemo(() => buildCellImage({ cells, palette, rows, cols }), [cells, palette, rows, cols])

  const draw = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    draw.current = () => {
      const el = canvas.current
      const sc = scroller.current
      const ctx = el && image ? el.getContext('2d') : null
      if (!ctx || !sc || !image || size.width === 0) return
      colors.current ??= readColors(wrap.current!)
      drawDesign(ctx, {
        image,
        pattern,
        cell,
        scrollX: sc.scrollLeft,
        scrollY: sc.scrollTop,
        width: size.width,
        height: size.height,
        dpr,
        colors: colors.current,
        preview,
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

  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    el.width = Math.round(size.width * dpr)
    el.height = Math.round(size.height * dpr)
  }, [size.width, size.height, dpr])

  useLayoutEffect(() => {
    colors.current = null
  }, [themeKey, dark])

  // Zooming about the pointer: where it was, and at what cell size, when the wheel moved.
  const anchor = useRef<{ x: number; y: number; from: number } | null>(null)
  const shownCell = useRef(cell)
  useLayoutEffect(() => {
    const sc = scroller.current
    const a = anchor.current
    anchor.current = null
    if (sc && a && a.from !== cell) {
      const to = zoomScroll(a.x, a.y, a.from, cell, sc.scrollLeft, sc.scrollTop)
      sc.scrollLeft = to.left
      sc.scrollTop = to.top
    }
    shownCell.current = cell
  }, [cell])

  useLayoutEffect(() => draw.current(), [image, pattern, cell, size, dpr, preview, themeKey, dark])

  // --- input ------------------------------------------------------------------------------
  const view = () => {
    const sc = scroller.current!
    const r = sc.getBoundingClientRect()
    return { sc, left: r.left + sc.clientLeft, top: r.top + sc.clientTop }
  }
  const locate = (e: { clientX: number; clientY: number }, clamp: boolean): Cell | null => {
    const { sc, left, top } = view()
    const p = latest.current.pattern
    return cellAt(
      e.clientX - left,
      e.clientY - top,
      { cell: shownCell.current, rows: p.rows, cols: p.cols, scrollX: sc.scrollLeft, scrollY: sc.scrollTop },
      clamp,
    )
  }
  const dragging = useRef<number | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || dragging.current !== null) return
    // A press on a scrollbar (outside the content box) scrolls; it doesn't paint.
    const { sc, left, top } = view()
    if (e.clientX - left >= sc.clientWidth || e.clientY - top >= sc.clientHeight) return
    const hit = locate(e, false)
    if (!hit) return
    e.preventDefault()
    wrap.current?.focus({ preventScroll: true })
    dragging.current = e.pointerId
    e.currentTarget.setPointerCapture?.(e.pointerId)
    latest.current.onDown(hit)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current !== e.pointerId) return
    latest.current.onMove(locate(e, true)!)
  }
  const end = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (dragging.current !== e.pointerId) return
    dragging.current = null
    if (cancelled) latest.current.onCancel()
    else latest.current.onUp(locate(e, false))
  }

  // Ctrl/⌘ + wheel zooms. It needs a non-passive listener to stop the page zooming.
  useEffect(() => {
    const sc = scroller.current
    if (!sc) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return
      e.preventDefault()
      const { left, top } = view()
      anchor.current = { x: e.clientX - left, y: e.clientY - top, from: shownCell.current }
      latest.current.onZoom(e.deltaY < 0 ? 1 : -1)
    }
    sc.addEventListener('wheel', onWheel, { passive: false })
    return () => sc.removeEventListener('wheel', onWheel)
  }, [])

  const content = contentSize(pattern.cols, pattern.rows, cell)
  return (
    <div
      ref={wrap}
      className="design-canvas"
      role="img"
      aria-label={props.label}
      tabIndex={-1}
    >
      <canvas ref={canvas} className="chart__canvas" aria-hidden="true" style={{ width: size.width, height: size.height }} />
      <div
        ref={scroller}
        className="design-canvas__scroller"
        style={{ cursor: CURSORS[tool] }}
        onScroll={schedule}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => end(e, false)}
        onPointerCancel={(e) => end(e, true)}
        data-testid="design-scroller"
        data-cell={cell}
      >
        <div style={{ width: content.width, height: content.height }} />
      </div>
    </div>
  )
}
