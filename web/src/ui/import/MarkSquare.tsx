/**
 * "Mark one square": the whole image, zoomed in a window of its own, with a box to put on
 * one square (geometry in importer/markSquare.ts).
 *
 * - The view starts zoomed so the box, on the middle square of the grid read, is
 *   START_BOX across. Drag the image to move around; the wheel, a pinch or − / + zoom,
 *   and "Fit" shows the whole image.
 * - The box: drag it to move it, a corner to resize it, or tap the image to bring it
 *   there. With the keyboard, arrows move it a pixel and Shift+arrows resize it.
 * - "Use this square" hands it to `onMark` in image pixels, not rounded; Cancel or
 *   Escape closes without marking.
 *
 * The image is drawn on a canvas, only the part in view, so a big image zoomed far in
 * costs no more than a small one. No grid is drawn over it: the grid read may be the
 * wrong one, and its lines would hide the chart's.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import type { Square } from '../../detect/protocol.ts'
import {
  centreSquareAt,
  clampView,
  CORNERS,
  dragCorner,
  fitView,
  growSquare,
  moveSquare,
  panBy,
  startSquare,
  startView,
  toImagePoint,
  toStage,
  zoomAbout,
  type Corner,
  type Point,
  type View,
} from '../../importer/markSquare.ts'
import type { Grid } from '../../importer/outline.ts'
import { Modal } from '../components.tsx'
import { TwoFingers } from '../gestures.ts'
import { useElementSize } from '../hooks.ts'

/** A press that moves less than this, in screen pixels, is a tap. */
const TAP = 8
/** How much a − or + press zooms. */
const STEP = 1.5

/** What one pointer is doing. */
type Drag =
  | { kind: 'pan'; id: number; last: Point; from: Point; moved: boolean }
  | { kind: 'move'; id: number; from: Point; start: Square }
  | { kind: 'corner'; id: number; corner: Corner }

export function MarkSquare({
  file,
  width,
  height,
  grid,
  onMark,
  onCancel,
}: {
  file: Blob
  /** The image's own size: the coordinate space of the square. */
  width: number
  height: number
  /** The grid read, whose middle square the box starts on. */
  grid: Grid | null
  onMark: (square: Square) => void
  onCancel: () => void
}) {
  const image = { width, height }
  const [stage, size] = useElementSize<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [source, setSource] = useState<HTMLImageElement | null>(null)
  /** Where the box starts, which the view starts on. */
  const [start] = useState<Square>(() => startSquare(grid, image))
  const [square, setSquare] = useState<Square>(start)
  /** The view once it's been moved: until then, the one that starts on the box. */
  const [moved, setMoved] = useState<View | null>(null)
  const drag = useRef<Drag | null>(null)
  const fingers = useRef(new TwoFingers())
  const [dragging, setDragging] = useState<Drag['kind'] | null>(null)
  const use = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const url = URL.createObjectURL(file)
    const el = new Image()
    el.onload = () => setSource(el)
    el.src = url
    return () => {
      el.onload = null
      URL.revokeObjectURL(url)
    }
  }, [file])

  const ready = size.width > 0 && size.height > 0
  const settle = (m: View | null) => clampView(m ?? startView(start, size, image), size, image)
  const view = ready ? settle(moved) : null
  const setView = (next: (v: View) => View) => setMoved((m) => next(settle(m)))

  useEffect(() => {
    const el = canvas.current
    if (!el || !view) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(size.width * dpr)
    const h = Math.round(size.height * dpr)
    if (el.width !== w) el.width = w
    if (el.height !== h) el.height = h
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!source) return
    // Only the image pixels in view, so a big image zoomed in draws no more than fits.
    const left = Math.max(0, Math.floor(-view.x / view.scale))
    const top = Math.max(0, Math.floor(-view.y / view.scale))
    const right = Math.min(width, Math.ceil((size.width - view.x) / view.scale))
    const bottom = Math.min(height, Math.ceil((size.height - view.y) / view.scale))
    if (right <= left || bottom <= top) return
    // Pixels drawn as squares once they're big enough to see, so the lines stay sharp.
    ctx.imageSmoothingEnabled = view.scale < 2
    const at = toStage({ x: left, y: top }, view)
    ctx.drawImage(source, left, top, right - left, bottom - top, at.x * dpr, at.y * dpr, (right - left) * view.scale * dpr, (bottom - top) * view.scale * dpr)
  })

  // Wheel zoom needs a non-passive listener to keep the page still (as Visualize's).
  useEffect(() => {
    const el = stage.current
    if (!el || !ready) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      const at = { x: e.clientX - box.left, y: e.clientY - box.top }
      setView((v) => zoomAbout(v, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), at, size, image))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const local = (e: PointerEvent) => {
    const box = stage.current!.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  const begin = (next: Drag | null) => {
    drag.current = next
    setDragging(next?.kind ?? null)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!view || (e.target as Element).closest('button')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // A synthetic event has no pointer to capture; the drag still works.
    }
    const p = local(e)
    // A second finger makes it a pinch: whatever the first was doing stops where it is.
    if (fingers.current.down(e.pointerId, p)) return begin(null)
    if (fingers.current.count > 1) return
    const target = e.target as HTMLElement
    const corner = target.dataset.corner as Corner | undefined
    if (corner) return begin({ kind: 'corner', id: e.pointerId, corner })
    if (target.closest('.mark__box')) return begin({ kind: 'move', id: e.pointerId, from: toImagePoint(p, view), start: square })
    begin({ kind: 'pan', id: e.pointerId, last: p, from: p, moved: false })
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!view) return
    const p = local(e)
    const step = fingers.current.move(e.pointerId, p)
    if (step) {
      setView((v) => panBy(zoomAbout(v, step.scale, step.mid, size, image), step.dx, step.dy, size, image))
      return
    }
    const d = drag.current
    if (!d || d.id !== e.pointerId || fingers.current.pinching) return
    if (d.kind === 'pan') {
      const moved = d.moved || Math.hypot(p.x - d.from.x, p.y - d.from.y) >= TAP
      if (moved) setView((v) => panBy(v, p.x - d.last.x, p.y - d.last.y, size, image))
      drag.current = { ...d, last: p, moved }
    } else if (d.kind === 'move') {
      const at = toImagePoint(p, view)
      setSquare(moveSquare(d.start, at.x - d.from.x, at.y - d.from.y, image))
    } else {
      setSquare((s) => dragCorner(s, d.corner, toImagePoint(p, view), image))
    }
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const pinched = fingers.current.pinching
    fingers.current.up(e.pointerId)
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    begin(null)
    // A tap on the image brings the box there.
    if (d.kind === 'pan' && !d.moved && !pinched && view) setSquare((s) => centreSquareAt(s, toImagePoint(local(e), view), image))
  }

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    fingers.current.up(e.pointerId)
    if (drag.current?.id === e.pointerId) begin(null)
  }

  const onBoxKey = (e: KeyboardEvent) => {
    const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!dx && !dy) return
    e.preventDefault()
    setSquare((s) => (e.shiftKey ? growSquare(s, dx, dy, image) : moveSquare(s, dx, dy, image)))
  }

  const centre = () => ({ x: size.width / 2, y: size.height / 2 })
  const [x0, y0, x1, y1] = square
  const tl = view && toStage({ x: x0, y: y0 }, view)
  const br = view && toStage({ x: x1, y: y1 }, view)

  return (
    <Modal
      title="Mark one square"
      className="mark-dialog"
      onClose={onCancel}
      initialFocus={use}
      buttons={
        <>
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button ref={use} type="button" className="button button--primary" onClick={() => onMark(square)}>
            Use this square
          </button>
        </>
      }
    >
      <p className="mark__hint">Put the box on one square, with its corners on the lines.</p>
      <div
        ref={stage}
        className="mark__stage"
        data-dragging={dragging ?? undefined}
        data-testid="mark-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
      >
        <canvas ref={canvas} className="mark__canvas" role="img" aria-label="The image being imported" />
        {tl && br && (
          <div
            className="mark__box"
            style={{ left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y }}
            role="group"
            tabIndex={0}
            aria-label={`The square: ${Math.round(x1 - x0)} × ${Math.round(y1 - y0)} pixels. Arrow keys move it; Shift and the arrow keys resize it.`}
            data-square={square.join(',')}
            data-testid="mark-box"
            onKeyDown={onBoxKey}
          >
            {CORNERS.map((corner) => (
              <div key={corner} className={`mark__corner mark__corner--${corner}`} data-corner={corner} data-testid={`mark-${corner}`} />
            ))}
          </div>
        )}
        <div className="mark__zoom">
          <button type="button" className="button button--small" aria-label="Zoom out" onClick={() => setView((v) => zoomAbout(v, 1 / STEP, centre(), size, image))}>
            −
          </button>
          <button type="button" className="button button--small" onClick={() => setMoved(fitView(size, image))}>
            Fit
          </button>
          <button type="button" className="button button--small" aria-label="Zoom in" onClick={() => setView((v) => zoomAbout(v, STEP, centre(), size, image))}>
            +
          </button>
        </div>
      </div>
    </Modal>
  )
}
