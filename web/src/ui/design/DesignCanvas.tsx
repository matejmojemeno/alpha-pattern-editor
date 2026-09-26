/**
 * The Design canvas on screen: a port of design_canvas.py.
 *
 * As on the Work chart (ChartView.tsx), the canvas is the size of the view, and a
 * transparent scroller over it holds a spacer the size of the whole chart, so scrolling
 * is native. Each scroll or change redraws on the next animation frame, from the
 * offscreen image of the cells (render/design.ts).
 *
 * Input is pointer events on the scroller, so a mouse, a pen and a finger all work:
 *
 * - One pointer uses the current tool (`mode` "edit"), drags the pattern within a
 *   padding preview ("move"), or does nothing while another preview shows ("view").
 *   The pointer is captured on press, so a drag that leaves the chart keeps going (to
 *   its edge).
 * - Two fingers pan and pinch-zoom about their midpoint, and never paint: a stroke the
 *   first finger started is taken back, with no undo step, when the second one lands
 *   (`onAbort`). On touch, the tools that act on a press (fill, pick, fill row and
 *   column) act when the finger lifts instead, so a pinch can't fill anything first.
 * - A press on a row or column number, in the margins, picks that row or column
 *   (`onAxis`), for inserting or deleting it.
 * - Ctrl/⌘ + wheel zooms about the pointer (a trackpad pinch arrives as this too); a
 *   bare wheel scrolls.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Pattern } from '../../model/types.ts'
import { buildCellImage, type ChartColors } from '../../render/chart.ts'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  axisAt,
  cellAt,
  contentSize,
  drawDesign,
  zoomScroll,
  type Cell,
  type Overlay,
} from '../../render/design.ts'
import type { Tool } from '../../design/editor.ts'
import { readColors, useDarkScheme } from '../chartColors.ts'
import { TwoFingers, type PinchStep } from '../gestures.ts'

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

/** Tools that act on a press: on touch they wait for the finger to lift. */
const ON_RELEASE: ReadonlySet<Tool> = new Set(['fill', 'eyedropper', 'row', 'col'])

export type CanvasMode = 'edit' | 'move' | 'view'

export interface DesignCanvasProps {
  pattern: Pattern
  /** Cell size in CSS pixels (the zoom). */
  cell: number
  tool: Tool
  mode?: CanvasMode
  preview: { a: Cell; b: Cell; hex: string } | null
  overlay?: Overlay | null
  onDown: (cell: Cell) => void
  onMove: (cell: Cell) => void
  onUp: (cell: Cell | null) => void
  onCancel: () => void
  /** A second finger landed: take back whatever the first one did. */
  onAbort?: () => void
  /** "move" mode: the pattern dragged by this many cells from where it was picked up;
   *  null when the drag ends. */
  onShift?: (delta: { dr: number; dc: number } | null) => void
  /** A row or column number was pressed; (x, y) is where, in the page. */
  onAxis?: (kind: 'row' | 'col', index: number, at: { x: number; y: number }) => void
  /** Ctrl/⌘ + wheel: zoom in (dir > 0) or out. The canvas keeps the point under the
   *  pointer still once the new cell size arrives. */
  onZoom: (dir: number) => void
  /** A pinch: zoom to this cell size. The point between the fingers stays still. */
  onZoomTo?: (cell: number) => void
  /** The view's size, for fitting the pattern to it. */
  onViewport: (size: { width: number; height: number }) => void
  themeKey: string
  label: string
}

export function DesignCanvas(props: DesignCanvasProps) {
  const { pattern, cell, tool, preview, overlay = null, themeKey, mode = 'edit' } = props
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
        overlay,
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

  // Zooming about a point: where it was, and at what cell size, when the zoom was asked.
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

  useLayoutEffect(() => draw.current(), [image, pattern, cell, size, dpr, preview, overlay, themeKey, dark])

  // --- input ------------------------------------------------------------------------------
  const view = () => {
    const sc = scroller.current!
    const r = sc.getBoundingClientRect()
    return { sc, left: r.left + sc.clientLeft, top: r.top + sc.clientTop }
  }
  const geometry = () => {
    const sc = scroller.current!
    const p = latest.current.pattern
    return { cell: shownCell.current, rows: p.rows, cols: p.cols, scrollX: sc.scrollLeft, scrollY: sc.scrollTop }
  }
  const locate = (e: { clientX: number; clientY: number }, clamp: boolean): Cell | null => {
    const { left, top } = view()
    return cellAt(e.clientX - left, e.clientY - top, geometry(), clamp)
  }

  /** The pointer using the tool (or dragging the pattern), and where a drag began. */
  const dragging = useRef<{ id: number; from: Cell } | null>(null)
  /** A touch on a tool that acts on release, waiting for the finger to lift. */
  const tap = useRef<{ id: number; cell: Cell } | null>(null)
  const fingers = useRef(new TwoFingers())
  /** The cell size a pinch is heading for, unrounded. */
  const pinchCell = useRef(cell)

  const release = (cancelled: boolean) => {
    const d = dragging.current
    if (!d) return
    dragging.current = null
    if (latest.current.mode === 'move') latest.current.onShift?.(null)
    else if (cancelled) latest.current.onCancel()
  }

  const pinch = (step: PinchStep) => {
    const { sc, left, top } = view()
    sc.scrollLeft -= step.dx
    sc.scrollTop -= step.dy
    pinchCell.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchCell.current * step.scale))
    const to = Math.round(pinchCell.current)
    if (to !== shownCell.current && latest.current.onZoomTo) {
      anchor.current = { x: step.mid.x - left, y: step.mid.y - top, from: shownCell.current }
      latest.current.onZoomTo(to)
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const touch = e.pointerType === 'touch'
    if (touch) {
      if (fingers.current.down(e.pointerId, { x: e.clientX, y: e.clientY })) {
        // A second finger: this gesture is a pinch. Nothing the first one did stays.
        e.preventDefault()
        tap.current = null
        pinchCell.current = shownCell.current
        const d = dragging.current
        if (d) {
          dragging.current = null
          if (latest.current.mode === 'move') {
            latest.current.onShift?.({ dr: 0, dc: 0 })
            latest.current.onShift?.(null)
          } else latest.current.onAbort?.()
        }
        return
      }
      if (fingers.current.pinching) return
    } else if (e.button !== 0) return
    if (dragging.current !== null) return

    const { sc, left, top } = view()
    const x = e.clientX - left
    const y = e.clientY - top
    // A press on a scrollbar (outside the content box) scrolls; it doesn't paint.
    if (x >= sc.clientWidth || y >= sc.clientHeight) return
    const m = latest.current.mode ?? 'edit'
    const hit = locate(e, false)
    if (!hit) {
      const axis = m === 'edit' ? axisAt(x, y, geometry()) : null
      if (axis && latest.current.onAxis) {
        e.preventDefault()
        latest.current.onAxis(axis.kind, axis.index, { x: e.clientX, y: e.clientY })
      }
      return
    }
    if (m === 'view') return
    e.preventDefault()
    wrap.current?.focus({ preventScroll: true })
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (m === 'edit' && touch && ON_RELEASE.has(latest.current.tool)) {
      tap.current = { id: e.pointerId, cell: hit }
      return
    }
    dragging.current = { id: e.pointerId, from: hit }
    if (m === 'edit') latest.current.onDown(hit)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      const step = fingers.current.move(e.pointerId, { x: e.clientX, y: e.clientY })
      if (step) pinch(step)
      if (fingers.current.pinching) return
    }
    const d = dragging.current
    if (d?.id !== e.pointerId) return
    const at = locate(e, true)!
    if (latest.current.mode === 'move') latest.current.onShift?.({ dr: at.r - d.from.r, dc: at.c - d.from.c })
    else latest.current.onMove(at)
  }

  const end = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (e.pointerType === 'touch') fingers.current.up(e.pointerId)
    const t = tap.current
    if (t?.id === e.pointerId) {
      tap.current = null
      if (!cancelled) {
        latest.current.onDown(t.cell)
        latest.current.onUp(t.cell)
      }
      return
    }
    if (dragging.current?.id !== e.pointerId) return
    if (!cancelled && latest.current.mode !== 'move') {
      dragging.current = null
      latest.current.onUp(locate(e, false))
      return
    }
    release(cancelled)
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
  const cursor = mode === 'move' ? 'grab' : mode === 'view' ? 'default' : CURSORS[tool]
  return (
    <div ref={wrap} className="design-canvas" role="img" aria-label={props.label} tabIndex={-1}>
      <canvas ref={canvas} className="chart__canvas" aria-hidden="true" style={{ width: size.width, height: size.height }} />
      <div
        ref={scroller}
        className="design-canvas__scroller"
        style={{ cursor }}
        onScroll={schedule}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => end(e, false)}
        onPointerCancel={(e) => end(e, true)}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="design-scroller"
        data-cell={cell}
        data-mode={mode}
      >
        <div style={{ width: content.width, height: content.height }} />
      </div>
    </div>
  )
}
