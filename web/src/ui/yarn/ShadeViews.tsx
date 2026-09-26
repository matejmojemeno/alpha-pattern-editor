/**
 * The colour library's pieces of UI: a colour's nearest shade, the picker, and the
 * credit the data's licence asks for. The hooks are in useShades.ts.
 */
import { useId } from 'react'

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

/** Choose the library colours are matched to. Changing it goes back to its own ball. */
export function LibraryPicker({ className = 'library-picker' }: { className?: string }) {
  const [settings, set] = useSettings()
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id}>Match colours to</label>
      <select
        id={id}
        value={settings.colourLibrary}
        onChange={(e) => set({ colourLibrary: e.target.value as LibraryId, ballMetres: null })}
      >
        {LIBRARY_IDS.map((l) => (
          <option key={l} value={l}>
            {LIBRARY_LABELS[l]}
          </option>
        ))}
      </select>
    </div>
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
