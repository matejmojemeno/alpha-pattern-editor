/**
 * The detected colours (confirm_window.py's palette list): each row painted in its colour,
 * with the stitch count and name in black or white, whichever reads on it, and its
 * nearest shade in the chosen colour library.
 */
import type { PaletteEntry } from '../../model/types.ts'
import { contrastOn } from '../../theme/contrast.ts'
import { LibraryCredit, LibraryPicker, ShadeMatch } from '../yarn/ShadeViews.tsx'
import { useChosenMatches } from '../yarn/useShades.ts'

export function Palette({ palette }: { palette: readonly PaletteEntry[] }) {
  const { library, matches } = useChosenMatches(palette.map((e) => e.hex))
  return (
    <div className="palette-pane">
      <ul className="palette" aria-label="Colours">
        {palette.map((e, i) => (
          <li key={e.id} className="palette__entry" style={{ background: e.hex, color: contrastOn(e.hex) }} title={`${e.name} — ${e.hex} — ${e.count} stitches`}>
            <span className="palette__count">{e.count}</span>{' '}
            <span className="palette__name">{e.name}</span>
            <span className="visually-hidden"> {e.count === 1 ? 'stitch' : 'stitches'}</span>
            {library && matches?.[i] && <ShadeMatch className="shade palette__shade" library={library} match={matches[i]} />}
          </li>
        ))}
      </ul>
      <LibraryPicker className="library-picker palette__library" />
      <LibraryCredit library={library} />
    </div>
  )
}
