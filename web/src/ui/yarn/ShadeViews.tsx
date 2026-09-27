/**
 * The colour library's pieces of UI: a colour's nearest shade, the picker, and the
 * credit the data's licence asks for, which sit together in an "Advanced" disclosure.
 * The hooks are in useShades.ts.
 */
import { useId, useState } from 'react'

import '../yarn.css'

import { useSettings } from '../../app/context.ts'
import { LIBRARY_IDS, LIBRARY_LABELS, shadeLabel, type Library, type LibraryId } from '../../yarn/libraries.ts'
import type { Match } from '../../yarn/match.ts'
import { matchName } from './useShades.ts'

/** A match on one line: the shade's colour and its number and name. */
export function ShadeMatch({ library, match, className = 'shade' }: { library: Library; match: Match; className?: string }) {
  return (
    <span className={className} title={`Nearest ${matchName(library, match)}, ${match.shade.hex} (ΔE ${match.deltaE.toFixed(1)})`}>
      <span className="shade__swatch" style={{ background: match.shade.hex }} aria-hidden="true" />
      <span className="visually-hidden">Nearest shade: </span>
      <span className="shade__label">{shadeLabel(match.shade)}</span>
    </span>
  )
}

/** Choose the library colours are matched to, or none. Changing it goes back to its own ball. */
export function LibraryPicker({ className = 'library-picker' }: { className?: string }) {
  const [settings, set] = useSettings()
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id}>Match colours to</label>
      <select
        id={id}
        value={settings.colourLibrary ?? ''}
        onChange={(e) => set({ colourLibrary: (e.target.value || null) as LibraryId | null, ballMetres: null })}
      >
        <option value="">Nothing</option>
        {LIBRARY_IDS.map((l) => (
          <option key={l} value={l}>
            {LIBRARY_LABELS[l]}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Matching colours to a yarn range, tucked away: everyday names are enough to work a
 * pattern, and shade names and numbers are for choosing what to buy. Starts open when a
 * library is already chosen, so its shades aren't shown without the way to turn them off;
 * after that it opens and closes only when the user says, not as the choice changes.
 */
export function YarnMatching({ library, className }: { library: Library | null; className: string }) {
  const [settings] = useSettings()
  const [open] = useState(settings.colourLibrary !== null)
  return (
    <details className={`yarn-matching ${className}`} open={open}>
      <summary>Advanced: match to yarn</summary>
      <LibraryPicker />
      <LibraryCredit library={library} />
    </details>
  )
}

/** The data's credit, as its CC BY licence asks, with the caveat that screens aren't yarn. */
export function LibraryCredit({ library }: { library: Library | null }) {
  if (!library?.attribution) return null
  return (
    <p className="library-credit muted">
      Nearest shades by colour on screen; real yarn and dye lots differ. Yarn colours from{' '}
      <a href="https://temperature-blanket.com/api/yarn-colorways" target="_blank" rel="noreferrer">
        temperature-blanket.com
      </a>
      , licensed{' '}
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
        CC BY 4.0
      </a>
      .
    </p>
  )
}
