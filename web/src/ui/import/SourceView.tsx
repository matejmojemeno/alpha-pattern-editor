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
 */
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

import type { Crop } from '../../detect/protocol.ts'
import { cropFromDrag, fitRect, toBox, type Point, type Rect } from '../../importer/letterbox.ts'
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
  onCrop: (crop: Crop) => void
  onResize: (grid: Grid) => void
}

/** What a pointer is doing: drawing a box, or moving a handle from where the grid was. */
type Drag = { kind: 'box'; from: Point; to: Point } | { kind: 'handle'; handle: Handle; start: Grid }

/** The arrow key that moves each edge outward, taking in a row or column. */
const OUTWARD: Record<Edge, string> = { top: 'ArrowUp', right: 'ArrowRight', bottom: 'ArrowDown', left: 'ArrowLeft' }
const EDGE_NAME: Record<Edge, string> = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' }
const INWARD: Record<Edge, string> = { top: 'ArrowDown', right: 'ArrowLeft', bottom: 'ArrowUp', left: 'ArrowRight' }

export function SourceView({ file, width, height, grid, canCrop, canResize, onCrop, onResize }: SourceViewProps) {
  const img = useBlobImage(file)
  const [box, size] = useElementSize<HTMLDivElement>()
  const fit = fitRect(size.width, size.height, width, height)
  const [drag, setDrag] = useState<Drag | null>(null)
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
    if (!canCrop || !usable(e)) return
    const { at } = locate(e)
    begin(e, { kind: 'box', from: at, to: at })
  }
  const onHandleDown = (handle: Handle) => (e: PointerEvent<HTMLDivElement>) => {
    if (!grid || !canResize || !usable(e)) return
    sent.current = grid
    begin(e, { kind: 'handle', handle, start: grid })
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== pointer.current || !drag) return
    const { at, fit: now } = locate(e)
    if (drag.kind === 'box') {
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
    if (drag.kind !== 'box') return
    const { at, fit: now } = locate(e)
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

  const band = drag?.kind === 'box' && {
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
      data-crop={canCrop || undefined}
      data-dragging={drag?.kind}
      // A handle's events bubble here too, captured or not.
      onPointerDown={onBoxDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      <img ref={img} alt="The image being imported" className="source__image" style={placed} draggable={false} />
      {shown && <Overlay grid={grid} width={width} height={height} style={placed} />}
      {shown && canResize && (
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
      {band && <div className="source__band" style={band} aria-hidden="true" />}
    </div>
  )
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
