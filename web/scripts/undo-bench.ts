/**
 * What whole-pattern undo snapshots cost (design/history.ts): memory per snapshot and
 * for a full stack, and the time to make the copy-on-write copies they come from.
 *
 *   node scripts/undo-bench.ts
 */
import { fillRect, floodFill, newPattern, setCell } from '../src/logic/edit.ts'

const STACK = 50

for (const n of [60, 200, 400, 999]) {
  let p = newPattern(n, n, '#ffffff')
  p = fillRect(p, 0, 0, n >> 1, n >> 1, 0)
  const snaps = []
  const t0 = performance.now()
  for (let i = 0; i < STACK; i++) {
    snaps.push(p)
    p = setCell(p, i % n, (i * 7) % n, 0)
  }
  const t1 = performance.now()
  const bytes = snaps.reduce((s, x) => s + x.cells.byteLength, 0)
  const t2 = performance.now()
  floodFill(p, 0, 0, 1) // the top-left quarter and everything joined to it
  const t3 = performance.now()
  console.log(
    `${n}×${n}: ${(p.cells.byteLength / 1024).toFixed(0)} KB per snapshot, ` +
      `${STACK} snapshots ${(bytes / 1048576).toFixed(1)} MB; ` +
      `an edit (copy + recount) ${((t1 - t0) / STACK).toFixed(3)} ms; ` +
      `whole-grid flood fill ${(t3 - t2).toFixed(1)} ms`,
  )
}
