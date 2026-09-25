/**
 * The detected colours (confirm_window.py's palette list): each row painted in its colour,
 * with the stitch count and name in black or white, whichever reads on it.
 */
import type { PaletteEntry } from '../../model/types.ts'
import { contrastOn } from '../../theme/contrast.ts'

export function Palette({ palette }: { palette: readonly PaletteEntry[] }) {
  return (
    <ul className="palette" aria-label="Colours">
      {palette.map((e) => (
        <li key={e.id} className="palette__entry" style={{ background: e.hex, color: contrastOn(e.hex) }} title={`${e.name} — ${e.hex} — ${e.count} stitches`}>
          <span className="palette__count">{e.count}</span>{' '}
          <span className="palette__name">{e.name}</span>
          <span className="visually-hidden"> {e.count === 1 ? 'stitch' : 'stitches'}</span>
        </li>
      ))}
    </ul>
  )
}
