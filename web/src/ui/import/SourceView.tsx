/**
 * The image being imported, letterboxed into its pane, with the detected grid drawn over
 * it: a port of source_view.py and canvas.py's source_pixmap_with_overlay, with an
 * outline that moves.
 *
 * - The overlay is an SVG in image pixels laid exactly over the image: the gridlines in
 *   translucent red across the extent, and the extent as a cyan outline.
 * - The outline's edges and corners are handles (outline.ts). Dragging one takes in, or
 *   leaves out, whole rows or columns at that side, for when detection missed some; each
 *   change is handed to `onResize` as it happens. A focused edge moves a cell per arrow
 *   key.
 * - A drag anywhere else (mouse, pen or finger: pointer events) draws a dashed box; on
 *   release it's mapped through the letterboxed fit into image pixels (letterbox.ts) and
 *   handed to `onCrop`, which finds the grid again inside it. This replaces the desktop's
 *   Crop mode. The page doesn't scroll under a finger on the image.
 * - While `marking` ("Mark one square"), a drag marks one square instead, corner to
 *   corner, handed to `onMark` in image pixels; the handles step aside. A loupe shows the
 *   image under the pointer four times bigger, with the square drawn in, so its corners
 *   can be put on the lines even where a square is a few pixels on screen: a mouse
 *   shows it before pressing too, to place the first corner.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

import type { Crop, Square } from '../../detect/protocol.ts'
import { cropFromDrag, fitRect, squareFromDrag, toBox, toImageExact, type Point, type Rect } from '../../importer/letterbox.ts'
import {
  CORNERS,
  EDGES,
  gridLines,
  mostCells,
  moveHandle,
  sameGrid,
  stepEdge,
  type Edge,
  type Grid,
  type Handle,
} from '../../importer/outline.ts'
import { useBlobImage, useElementSize } from '../hooks.ts'

export interface SourceViewProps {
  file: Blob
  /** The image's own size: the coordinate space of the overlay and of crops. */
  width: number
  height: number
  /** The grid to draw over the image, if there is one. */
  grid: Grid | null
  /** Whether a box can be drawn, to find the grid again inside it. */
  canCrop: boolean
  /** Whether the outline's edges can be moved. */
  canResize: boolean
  /** "Mark one square": a drag marks a square instead of drawing a box. */
  marking?: boolean
  onCrop: (crop: Crop) => void
  onResize: (grid: Grid) => void
  onMark?: (square: Square) => void
  /** A line over the foot of the image: what to do while marking, or why a mark failed. */
  caption?: string | null
}

/** What a pointer is doing: drawing a box, marking a square, or moving a handle from
 *  where the grid was. */
type Drag =
  | { kind: 'box'; from: Point; to: Point }
  | { kind: 'mark'; from: Point; to: Point }
  | { kind: 'handle'; handle: Handle; start: Grid }

/** The arrow key that moves each edge outward, taking in a row or column. */
const OUTWARD: Record<Edge, string> = { top: 'ArrowUp', right: 'ArrowRight', bottom: 'ArrowDown', left: 'ArrowLeft' }
const EDGE_NAME: Record<Edge, string> = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' }
const INWARD: Record<Edge, string> = { top: 'ArrowDown', right: 'ArrowLeft', bottom: 'ArrowUp', left: 'ArrowRight' }

export function SourceView({ file, width, height, grid, canCrop, canResize, marking = false, onCrop, onResize, onMark, caption = null }: SourceViewProps) {
  const img = useBlobImage(file)
  const [box, size] = useElementSize<HTMLDivElement>()
  const fit = fitRect(size.width, size.height, width, height)
  const [drag, setDrag] = useState<Drag | null>(null)
  /** Where a mouse is over the image while marking, before it's pressed. */
  const [hover, setHover] = useState<Point | null>(null)
  const pointer = useRef<number | null>(null)
  /** The grid last handed to onResize in this drag, so each change is sent once. */
  const sent = useRef<Grid | null>(null)
  const bounds = { width, height }

  /** A pointer event's position in the box, and the image's fit, measured now. */
  const locate = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { at: { x: e.clientX - r.left, y: e.clientY - r.top }, fit: fitRect(r.width, r.height, width, height) }
  }

  const begin = (e: PointerEvent<HTMLElement>, next: Drag) => {
    e.preventDefault()
    e.stopPropagation()
    pointer.current = e.pointerId
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // A synthetic event has no pointer to capture; the drag still works.
    }
    setDrag(next)
  }
  const usable = (e: PointerEvent) => pointer.current === null && !(e.pointerType === 'mouse' && e.button !== 0)

  const onBoxDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!(marking || canCrop) || !usable(e)) return
    const { at } = locate(e)
    setHover(null)
    begin(e, { kind: marking ? 'mark' : 'box', from: at, to: at })
  }
  const onHandleDown = (handle: Handle) => (e: PointerEvent<HTMLDivElement>) => {
    if (!grid || !canResize || !usable(e)) return
    sent.current = grid
    begin(e, { kind: 'handle', handle, start: grid })
  }

  const onPointerMove = (e: PointerEvent) => {
    if (marking && pointer.current === null && e.pointerType === 'mouse') {
      setHover(locate(e).at)
      return
    }
    if (e.pointerId !== pointer.current || !drag) return
    const { at, fit: now } = locate(e)
    if (drag.kind === 'box' || drag.kind === 'mark') {
      setDrag({ ...drag, to: at })
      return
    }
    // Unclamped, so an edge can be dragged to the image's very edge from the letterbox.
    const to = { x: ((at.x - now.x) / now.width) * width, y: ((at.y - now.y) / now.height) * height }
    const next = moveHandle(drag.start, drag.handle, to, bounds)
    if (sent.current && sameGrid(next, sent.current)) return
    sent.current = next
    onResize(next)
  }
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointer.current || !drag) return
    pointer.current = null
    setDrag(null)
    if (drag.kind === 'handle') return
    const { at, fit: now } = locate(e)
    if (drag.kind === 'mark') {
      const square = squareFromDrag(drag.from, at, now, width, height)
      if (square) onMark?.(square)
      return
    }
    const crop = cropFromDrag(drag.from, at, now, width, height)
    if (crop) onCrop(crop)
  }
  const onPointerCancel = () => {
    pointer.current = null
    setDrag(null)
  }

  const onEdgeKey = (edge: Edge) => (e: KeyboardEvent) => {
    if (!grid || !canResize) return
    const by = e.key === OUTWARD[edge] ? 1 : e.key === INWARD[edge] ? -1 : 0
    if (!by) return
    e.preventDefault()
    const next = stepEdge(grid, edge, by, bounds)
    if (!sameGrid(next, grid)) onResize(next)
  }

  const band = (drag?.kind === 'box' || drag?.kind === 'mark') && {
    left: Math.min(drag.from.x, drag.to.x),
    top: Math.min(drag.from.y, drag.to.y),
    width: Math.abs(drag.to.x - drag.from.x),
    height: Math.abs(drag.to.y - drag.from.y),
  }
  const placed = { left: fit.x, top: fit.y, width: fit.width, height: fit.height }
  const shown = grid && fit.width > 0

  return (
    <div
      ref={box}
      className="source stage"
      style={{ aspectRatio: `${width} / ${height}` }}
      data-crop={canCrop || marking || undefined}
      data-marking={marking || undefined}
      data-dragging={drag?.kind}
      // A handle's events bubble here too, captured or not.
      onPointerDown={onBoxDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onPointerLeave={() => setHover(null)}
    >
      <img ref={img} alt="The image being imported" className="source__image" style={placed} draggable={false} />
      {shown && <Overlay grid={grid} width={width} height={height} style={placed} />}
      {shown && canResize && !marking && (
        <>
          {EDGES.map((edge) => {
            const vertical = edge === 'top' || edge === 'bottom'
            const count = vertical ? grid.rows : grid.cols
            const noun = vertical ? 'rows' : 'columns'
            return (
              <div
                key={edge}
                className={`source__handle source__handle--${edge}`}
                style={handleStyle(edge, grid, fit, bounds)}
                role="slider"
                tabIndex={0}
                aria-label={`${EDGE_NAME[edge]} edge of the grid`}
                aria-orientation={vertical ? 'vertical' : 'horizontal'}
                aria-valuemin={1}
                aria-valuemax={mostCells(grid, edge, bounds)}
                aria-valuenow={count}
                aria-valuetext={`${count} ${noun}`}
                data-testid={`edge-${edge}`}
                onPointerDown={onHandleDown(edge)}
                onKeyDown={onEdgeKey(edge)}
              />
            )
          })}
          {CORNERS.map((corner) => (
            <div
              key={corner}
              className={`source__handle source__handle--corner source__handle--${corner}`}
              style={handleStyle(corner, grid, fit, bounds)}
              aria-hidden="true"
              data-testid={`corner-${corner}`}
              onPointerDown={onHandleDown(corner)}
            />
          ))}
        </>
      )}
      {shown && drag?.kind === 'handle' && (
        <span className="source__size" style={sizeStyle(grid, fit, bounds)} aria-hidden="true">
          {grid.cols} × {grid.rows}
        </span>
      )}
      {caption && fit.width > 0 && (
        <p className="source__caption" role="status" style={{ left: fit.x, bottom: size.height - fit.y - fit.height, maxWidth: fit.width }}>
          {caption}
        </p>
      )}
      {band && <div className={`source__band${drag?.kind === 'mark' ? ' source__band--mark' : ''}`} style={band} aria-hidden="true" />}
      {marking && fit.width > 0 && (drag?.kind === 'mark' || hover) && (
        <Loupe
          img={img}
          at={drag?.kind === 'mark' ? drag.to : hover!}
          from={drag?.kind === 'mark' ? drag.from : null}
          fit={fit}
          width={width}
          height={height}
          box={size}
        />
      )}
    </div>
  )
}

/** The loupe's size on screen, in CSS pixels, and how much bigger it shows the image than
 *  the stage does. */
const LOUPE = 128
const LOUPE_ZOOM = 4
/** How far the loupe sits from the pointer, so a finger doesn't cover it. */
const LOUPE_GAP = 28

/**
 * The image under the pointer, LOUPE_ZOOM times as big as the stage shows it, with the
 * square being marked (from `from` to `at`) and a cross at the pointer. It sits above
 * the pointer, or below it near the stage's top, and never takes the pointer's events.
 */
function Loupe({
  img,
  at,
  from,
  fit,
  width,
  height,
  box,
}: {
  img: RefObject<HTMLImageElement | null>
  at: Point
  from: Point | null
  fit: Rect
  width: number
  height: number
  box: { width: number; height: number }
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    const source = img.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx || !source) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(LOUPE * dpr)
    c.height = Math.round(LOUPE * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Image pixels across the loupe, and the image point at its centre.
    const span = LOUPE / (LOUPE_ZOOM * (fit.width / width))
    const centre = toImageExact(at, fit, width, height)
    const left = centre.x - span / 2
    const top = centre.y - span / 2
    const toLoupe = (p: Point) => ({ x: ((p.x - left) / span) * LOUPE, y: ((p.y - top) / span) * LOUPE })
    const style = getComputedStyle(c)
    ctx.fillStyle = style.getPropertyValue('--letterbox').trim() || '#1e1e1e'
    ctx.fillRect(0, 0, LOUPE, LOUPE)
    ctx.imageSmoothingEnabled = false
    if (source.complete && source.naturalWidth > 0) ctx.drawImage(source, left, top, span, span, 0, 0, LOUPE, LOUPE)
    if (from) {
      const a = toLoupe(toImageExact(from, fit, width, height))
      const b = toLoupe(centre)
      ctx.strokeStyle = style.getPropertyValue('--accent').trim() || '#f0a800'
      ctx.lineWidth = 2
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    }
    // The cross: dark under light, so it shows on any colour.
    const mid = LOUPE / 2
    for (const [colour, w] of [['rgb(0 0 0 / 0.7)', 3], ['#fff', 1]] as const) {
      ctx.strokeStyle = colour
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(mid - 10, mid)
      ctx.lineTo(mid + 10, mid)
      ctx.moveTo(mid, mid - 10)
      ctx.lineTo(mid, mid + 10)
      ctx.stroke()
    }
  })
  const above = at.y - LOUPE_GAP - LOUPE
  const style: CSSProperties = {
    left: Math.min(Math.max(0, at.x - LOUPE / 2), Math.max(0, box.width - LOUPE)),
    top: above >= 0 ? above : at.y + LOUPE_GAP,
    width: LOUPE,
    height: LOUPE,
  }
  return <canvas ref={canvas} className="source__loupe" style={style} aria-hidden="true" data-testid="loupe" />
}

/** A handle's hit area, centred on its edge or corner (--hit wide, set in import.css). */
function handleStyle(handle: Handle, grid: Grid, fit: Rect, bounds: { width: number; height: number }): CSSProperties {
  const e = grid.extent
  const tl = toBox({ x: e.x0, y: e.y0 }, fit, bounds.width, bounds.height)
  const br = toBox({ x: e.x1, y: e.y1 }, fit, bounds.width, bounds.height)
  const half = 'var(--hit) / 2'
  const at = (v: number) => `calc(${v}px - ${half})`
  switch (handle) {
    case 'top':
    case 'bottom':
      return { left: tl.x, width: Math.max(0, br.x - tl.x), top: at(handle === 'top' ? tl.y : br.y), height: 'var(--hit)' }
    case 'left':
    case 'right':
      return { top: tl.y, height: Math.max(0, br.y - tl.y), left: at(handle === 'left' ? tl.x : br.x), width: 'var(--hit)' }
    default: {
      const [v, h] = handle.split('-')
      return { left: at(h === 'left' ? tl.x : br.x), top: at(v === 'top' ? tl.y : br.y), width: 'var(--hit)', height: 'var(--hit)' }
    }
  }
}

/** The size tag shown while an edge is dragged: at the outline's top left, inside it. */
function sizeStyle(grid: Grid, fit: Rect, bounds: { width: number; height: number }): CSSProperties {
  const tl = toBox({ x: grid.extent.x0, y: grid.extent.y0 }, fit, bounds.width, bounds.height)
  return { left: Math.max(0, tl.x), top: Math.max(0, tl.y) }
}

function Overlay({
  grid,
  width,
  height,
  style,
}: {
  grid: Grid
  width: number
  height: number
  style: { left: number; top: number; width: number; height: number }
}) {
  const e = grid.extent
  const { rowLines, colLines } = gridLines(grid)
  let d = ''
  for (const x of colLines) d += `M${x} ${e.y0}V${e.y1}`
  for (const y of rowLines) d += `M${e.x0} ${y}H${e.x1}`
  return (
    <svg
      className="source__overlay"
      style={style}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="grid-overlay"
    >
      {/* Everything outside the outline, dimmed: it won't be part of the pattern. */}
      <path
        className="source__outside"
        fillRule="evenodd"
        d={`M0 0H${width}V${height}H0Z M${e.x0} ${e.y0}V${e.y1}H${e.x1}V${e.y0}Z`}
        data-testid="outside-grid"
      />
      <path className="source__lines" d={d} />
      <rect className="source__extent" x={e.x0} y={e.y0} width={e.x1 - e.x0} height={e.y1 - e.y0} />
    </svg>
  )
}
