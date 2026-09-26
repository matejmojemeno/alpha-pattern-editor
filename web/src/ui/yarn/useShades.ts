/**
 * The colour library in the UI: the chosen table, loaded lazily, and each palette
 * colour's nearest shade in it. The components are in ShadeViews.tsx.
 */
import { useEffect, useMemo, useState } from 'react'

import { useSettings } from '../../app/context.ts'
import { LIBRARY_LABELS, loadLibrary, shadeLabel, type Library, type LibraryId } from '../../yarn/libraries.ts'
import { matcher, nearestShade, type Match, type Matcher } from '../../yarn/match.ts'

const matchers = new WeakMap<Library, Matcher>()
const matcherFor = (lib: Library) => {
  let m = matchers.get(lib)
  if (!m) matchers.set(lib, (m = matcher(lib)))
  return m
}

/** The library `id`, or null while it loads (or if it couldn't be). */
export function useLibrary(id: LibraryId): Library | null {
  const [loaded, setLoaded] = useState<Library | null>(null)
  useEffect(() => {
    let live = true
    loadLibrary(id).then(
      (lib) => live && setLoaded(lib),
      () => live && setLoaded(null),
    )
    return () => {
      live = false
    }
  }, [id])
  return loaded?.id === id ? loaded : null
}

/** The nearest shade of `library` to each colour, or null while the library loads. */
export function useShadeMatches(library: Library | null, hexes: readonly string[]): readonly Match[] | null {
  const key = hexes.join(',')
  return useMemo(() => {
    if (!library) return null
    const m = matcherFor(library)
    return key === '' ? [] : key.split(',').map((hex) => nearestShade(m, hex))
  }, [library, key])
}

/** The chosen library (the app-wide setting) and each colour's match in it. */
export function useChosenMatches(hexes: readonly string[]) {
  const [settings] = useSettings()
  const library = useLibrary(settings.colourLibrary)
  return { library, matches: useShadeMatches(library, hexes) }
}

/** "Stylecraft Special DK 1001 White": the full name of a match, for text and titles. */
export const matchName = (library: Library, m: Match) => `${LIBRARY_LABELS[library.id]} ${shadeLabel(m.shade)}`
