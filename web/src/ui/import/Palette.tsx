/**
 * The detected colours (confirm_window.py's palette list): each with its swatch, name,
 * stitch count and nearest shade in the chosen colour library.
 *
 * Pointing at a colour, or focusing it, shows where it is used in the pattern (the other
 * colours fade, PatternView.tsx); clicking or tapping it keeps that showing, which is how
 * a phone sees it, the pattern being another tab there. Its × removes it, as Delete does
 * in Design: its stitches take the nearest remaining colour (importer/removals.ts). The
 * colours removed are listed under the rest, each with Restore.
 *
 * Unlike the desktop, which paints each row in its colour, the rows sit on the page with a
 * swatch, so a long shade name wraps instead of overflowing.
 */
import { useEffect, useRef } from 'react'

import type { Removal } from '../../importer/removals.ts'
import type { PaletteEntry } from '../../model/types.ts'
import { ShadeMatch, YarnMatching } from '../yarn/ShadeViews.tsx'
import { matchName, useChosenMatches } from '../yarn/useShades.ts'

export interface PaletteProps {
  palette: readonly PaletteEntry[]
  /** The colour showing in the pattern, by its hex, or null. */
  shown: string | null
  /** The colour kept showing by a click, by its hex, or null. */
  pinned: string | null
  /** Pointing at a colour (or away, null) with a mouse or pen. */
  onPoint: (hex: string | null) => void
  onPin: (hex: string | null) => void
  onRemove: (entry: PaletteEntry) => void
  /** The removals that apply to this pattern, in the order they were made, each with its
   *  index among all of them. */
  removed: readonly { removal: Removal; index: number }[]
  onRestore: (index: number) => void
}

export function Palette(p: PaletteProps) {
  const { library, matches } = useChosenMatches(p.palette.map((e) => e.hex))
  const only = p.palette.length <= 1

  // After a removal, focus goes to its Restore, so a slip is one key away from undone.
  const restores = useRef<HTMLDivElement>(null)
  const removedBefore = useRef(p.removed.length)
  useEffect(() => {
    if (p.removed.length > removedBefore.current) restores.current?.querySelector<HTMLButtonElement>('li:last-child button')?.focus()
    removedBefore.current = p.removed.length
  }, [p.removed.length])

  return (
    <div className="palette-pane">
      <ul className="palette" aria-label="Colours" onPointerLeave={() => p.onPoint(null)}>
        {p.palette.map((e, i) => (
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
              aria-label={
                `${e.name}, ${e.hex}, ${e.count} ${e.count === 1 ? 'stitch' : 'stitches'}` +
                (library && matches?.[i] ? `, nearest ${matchName(library, matches[i])}` : '')
              }
              title={`${e.name}, ${e.hex}: click to keep showing where it is used`}
              onClick={() => p.onPin(p.pinned === e.hex ? null : e.hex)}
            >
              <span className="palette__swatch" style={{ background: e.hex }} aria-hidden="true" />
              <span className="palette__name">{e.name}</span>
              <span className="palette__count">{e.count}</span>
              {library && matches?.[i] && <ShadeMatch className="shade palette__shade" library={library} match={matches[i]} />}
            </button>
            <button
              type="button"
              className="palette__remove"
              aria-label={`Remove “${e.name}”`}
              title={only ? 'A pattern needs at least one colour' : `Remove ${e.name}: its stitches take the nearest remaining colour`}
              disabled={only}
              onClick={() => p.onRemove(e)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>
      {p.removed.length > 0 && (
        <div className="palette__removed" ref={restores}>
          <h3 className="palette__removed-heading">Removed</h3>
          <ul aria-label="Removed colours">
            {p.removed.map(({ removal, index }) => (
              <li key={index}>
                <span className="palette__swatch" style={{ background: removal.hex }} aria-hidden="true" />
                <span className="palette__name">{removal.name}</span>
                <button type="button" className="button button--small" aria-label={`Restore “${removal.name}”`} onClick={() => p.onRestore(index)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <YarnMatching className="palette__library" library={library} />
    </div>
  )
}
