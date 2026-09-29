/**
 * The detected colours (confirm_window.py's palette list): each with its swatch, name and
 * stitch count. It is for checking what was detected, not for editing: removing, renaming
 * and recolouring are the Design stage's, and "Number of colours" beside the heading
 * merges colours detection split (Import.tsx).
 *
 * Pointing at a colour, or focusing it, shows where it is used in the pattern (the other
 * colours fade, PatternView.tsx); clicking or tapping it keeps that showing, which is how
 * a phone sees it, the pattern being above the list there.
 *
 * Unlike the desktop, which paints each row in its colour, the rows sit on the page with a
 * swatch, so a long name wraps instead of overflowing.
 */
import type { PaletteEntry } from '../../model/types.ts'

export interface PaletteProps {
  palette: readonly PaletteEntry[]
  /** The colour showing in the pattern, by its hex, or null. */
  shown: string | null
  /** The colour kept showing by a click, by its hex, or null. */
  pinned: string | null
  /** Pointing at a colour (or away, null) with a mouse or pen. */
  onPoint: (hex: string | null) => void
  onPin: (hex: string | null) => void
}

export function Palette(p: PaletteProps) {
  return (
    <div className="palette-pane">
      <ul className="palette" aria-label="Colours" onPointerLeave={() => p.onPoint(null)}>
        {p.palette.map((e) => (
          <li
            key={e.id}
            className="palette__entry"
            data-shown={p.shown === e.hex || undefined}
            onPointerEnter={(ev) => ev.pointerType !== 'touch' && p.onPoint(e.hex)}
            onFocus={() => p.onPoint(e.hex)}
            onBlur={() => p.onPoint(null)}
          >
            <button
              type="button"
              className="palette__show"
              aria-pressed={p.pinned === e.hex}
              aria-label={`${e.name}, ${e.hex}, ${e.count} ${e.count === 1 ? 'stitch' : 'stitches'}`}
              title={`${e.name}, ${e.hex}: click to keep showing where it is used`}
              onClick={() => p.onPin(p.pinned === e.hex ? null : e.hex)}
            >
              <span className="palette__swatch" style={{ background: e.hex }} aria-hidden="true" />
              <span className="palette__name">{e.name}</span>
              <span className="palette__count">{e.count}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="palette__total">
        <span>Total</span>
        <span className="palette__count">{p.palette.reduce((n, e) => n + e.count, 0)} stitches</span>
      </p>
    </div>
  )
}
