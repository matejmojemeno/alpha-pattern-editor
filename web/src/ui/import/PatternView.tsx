/**
 * The detected pattern, fitted to its pane: canvas.py's reconstruction_pixmap. Cells in
 * their colours, black lines between them when the cells are big enough to show them,
 * and, with "Flag unsure cells" on, a red X over every cell below 0.6 confidence.
 */
import { useEffect, useRef } from 'react'

import type { Preview } from '../../detect/protocol.ts'
import { cellSize, unsureCells } from '../../importer/controls.ts'
import { buildCellImage, GRID_COLOR } from '../../render/chart.ts'
import { useElementSize } from '../hooks.ts'

/** The X over an unsure cell (theme.py OVERLAY_LOW_CONF). */
const UNSURE_COLOR = 'rgb(255, 0, 0)'
/** Below this many device pixels a cell has no room for gridlines. */
const GRID_MIN_CELL = 5

export function PatternView({ preview, flagUnsure }: { preview: Preview; flagUnsure: boolean }) {
  const [box, size] = useElementSize<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1
  const cell = cellSize(preview.cols, preview.rows, size.width, size.height, dpr)
  const unsure = flagUnsure ? unsureCells(preview.confidence).length : 0

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
    if (flagUnsure) {
      ctx.strokeStyle = UNSURE_COLOR
      ctx.lineWidth = Math.max(1, Math.round(cell / 9))
      ctx.beginPath()
      for (const i of unsureCells(preview.confidence)) {
        const x = (i % cols) * cell
        const y = Math.floor(i / cols) * cell
        ctx.moveTo(x, y)
        ctx.lineTo(x + cell, y + cell)
        ctx.moveTo(x + cell, y)
        ctx.lineTo(x, y + cell)
      }
      ctx.stroke()
    }
  }, [preview, flagUnsure, cell, dpr])

  const label =
    `The detected pattern: ${preview.cols} columns by ${preview.rows} rows` +
    (unsure ? `, ${unsure} unsure cell${unsure === 1 ? '' : 's'} crossed out` : '')
  return (
    <div ref={box} className="pattern" style={{ aspectRatio: `${preview.cols} / ${preview.rows}` }}>
      <canvas ref={canvas} className="pattern__canvas" role="img" aria-label={label} />
    </div>
  )
}
