/**
 * The detected pattern, fitted to its pane: canvas.py's reconstruction_pixmap. Cells in
 * their colours, and black lines between them when the cells are big enough to show them.
 */
import { useEffect, useRef } from 'react'

import type { Preview } from '../../detect/protocol.ts'
import { cellSize } from '../../importer/controls.ts'
import { buildCellImage, GRID_COLOR } from '../../render/chart.ts'
import { useElementSize } from '../hooks.ts'

/** Below this many device pixels a cell has no room for gridlines. */
const GRID_MIN_CELL = 5

export function PatternView({ preview }: { preview: Preview }) {
  const [box, size] = useElementSize<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1
  const cell = cellSize(preview.cols, preview.rows, size.width, size.height, dpr)

  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx || cell === 0) return
    const { cols, rows } = preview
    c.width = cols * cell + 1
    c.height = rows * cell + 1
    c.style.width = `${c.width / dpr}px`
    c.style.height = `${c.height / dpr}px`
    const cells = buildCellImage(preview)
    if (!cells) return
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(cells, 0, 0, cols * cell, rows * cell)
    if (cell >= GRID_MIN_CELL) {
      ctx.fillStyle = GRID_COLOR
      for (let x = 0; x <= cols; x++) ctx.fillRect(x * cell, 0, 1, c.height)
      for (let y = 0; y <= rows; y++) ctx.fillRect(0, y * cell, c.width, 1)
    }
  }, [preview, cell, dpr])

  const label = `The detected pattern: ${preview.cols} columns by ${preview.rows} rows`
  return (
    <div ref={box} className="pattern" style={{ aspectRatio: `${preview.cols} / ${preview.rows}` }}>
      <canvas ref={canvas} className="pattern__canvas" role="img" aria-label={label} />
    </div>
  )
}
