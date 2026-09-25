/**
 * The image being imported, letterboxed into its pane, with the detected grid drawn over
 * it and a rubber-band crop: a port of source_view.py and canvas.py's
 * source_pixmap_with_overlay.
 *
 * - The overlay is an SVG in image pixels laid exactly over the image: the gridlines in
 *   translucent red across the extent, and the extent as a cyan box.
 * - In crop mode, a drag (mouse, pen or finger: pointer events) draws a dashed box; on
 *   release it's mapped through the letterboxed fit into image pixels (letterbox.ts) and
 *   handed to `onCrop`. The page doesn't scroll under the finger while cropping.
 */
import { useRef, useState, type PointerEvent } from 'react'

import type { Crop, Preview } from '../../detect/protocol.ts'
import { cropFromDrag, fitRect, type Point } from '../../importer/letterbox.ts'
import { useBlobImage, useElementSize } from '../hooks.ts'

export interface SourceViewProps {
  file: Blob
  /** The image's own size: the coordinate space of the overlay and of crops. */
  width: number
  height: number
  /** The detected grid to draw over the image, if there is one. */
  preview: Pick<Preview, 'extent' | 'rowLines' | 'colLines'> | null
  cropping: boolean
  onCrop: (crop: Crop) => void
}

export function SourceView({ file, width, height, preview, cropping, onCrop }: SourceViewProps) {
  const img = useBlobImage(file)
  const [box, size] = useElementSize<HTMLDivElement>()
  const fit = fitRect(size.width, size.height, width, height)
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null)
  const pointer = useRef<number | null>(null)

  /** A pointer event's position in the box, and the image's fit, measured now. */
  const locate = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { at: { x: e.clientX - r.left, y: e.clientY - r.top }, fit: fitRect(r.width, r.height, width, height) }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!cropping || pointer.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    pointer.current = e.pointerId
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // A synthetic event has no pointer to capture; the drag still works.
    }
    const { at } = locate(e)
    setDrag({ from: at, to: at })
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointer.current) return
    const { at } = locate(e)
    setDrag((d) => d && { ...d, to: at })
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointer.current || !drag) return
    pointer.current = null
    const { at, fit: now } = locate(e)
    setDrag(null)
    const crop = cropFromDrag(drag.from, at, now, width, height)
    if (crop) onCrop(crop)
  }
  const onPointerCancel = () => {
    pointer.current = null
    setDrag(null)
  }

  const band = drag && {
    left: Math.min(drag.from.x, drag.to.x),
    top: Math.min(drag.from.y, drag.to.y),
    width: Math.abs(drag.to.x - drag.from.x),
    height: Math.abs(drag.to.y - drag.from.y),
  }
  const placed = { left: fit.x, top: fit.y, width: fit.width, height: fit.height }

  return (
    <div
      ref={box}
      className="source"
      style={{ aspectRatio: `${width} / ${height}` }}
      data-cropping={cropping || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      <img ref={img} alt="The image being imported" className="source__image" style={placed} draggable={false} />
      {preview && fit.width > 0 && <Overlay preview={preview} width={width} height={height} style={placed} />}
      {band && <div className="source__band" style={band} aria-hidden="true" />}
    </div>
  )
}

function Overlay({
  preview,
  width,
  height,
  style,
}: {
  preview: NonNullable<SourceViewProps['preview']>
  width: number
  height: number
  style: { left: number; top: number; width: number; height: number }
}) {
  const { extent: e, rowLines, colLines } = preview
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
      <path className="source__lines" d={d} />
      <rect className="source__extent" x={e.x0} y={e.y0} width={e.x1 - e.x0} height={e.y1 - e.y0} />
    </svg>
  )
}
