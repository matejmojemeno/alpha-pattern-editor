/**
 * The colour libraries palette colours are matched against: DMC (what detection names
 * colours from) and yarn ranges. The tables are in ./data/ (provenance: data/README.md)
 * and each is loaded with a dynamic import(), so none is in the main chunk: a library
 * is fetched the first time something shows its matches.
 */

export interface Shade {
  /** The manufacturer's shade number, or null when the source doesn't give one. */
  readonly code: string | null
  readonly name: string
  readonly hex: string
}

export interface Library {
  readonly id: LibraryId
  readonly brand: string
  readonly yarn: string
  readonly weight: string | null
  /** One ball as sold, when the source gives it. */
  readonly ball: { readonly grams: number; readonly metres: number } | null
  /** The credit the data's licence asks for, shown with the matches. */
  readonly attribution: string | null
  readonly shades: readonly Shade[]
}

export const LIBRARY_IDS = ['dmc', 'stylecraft-special-dk', 'paintbox-simply-dk', 'scheepjes-colour-crafter'] as const
export type LibraryId = (typeof LIBRARY_IDS)[number]
export const DEFAULT_LIBRARY: LibraryId = 'dmc'

/** What the picker shows, without loading any table. */
export const LIBRARY_LABELS: Record<LibraryId, string> = {
  dmc: 'DMC stranded cotton',
  'stylecraft-special-dk': 'Stylecraft Special DK',
  'paintbox-simply-dk': 'Paintbox Yarns Simply DK',
  'scheepjes-colour-crafter': 'Scheepjes Colour Crafter',
}

export const isLibraryId = (v: unknown): v is LibraryId => (LIBRARY_IDS as readonly unknown[]).includes(v)

// Literal paths, one per table, so the bundler makes each its own chunk.
const LOADERS: Record<LibraryId, () => Promise<{ default: unknown }>> = {
  dmc: () => import('./data/dmc.json'),
  'stylecraft-special-dk': () => import('./data/stylecraft-special-dk.json'),
  'paintbox-simply-dk': () => import('./data/paintbox-simply-dk.json'),
  'scheepjes-colour-crafter': () => import('./data/scheepjes-colour-crafter.json'),
}

const cache = new Map<LibraryId, Promise<Library>>()

/** The table for `id`, fetched once. A failed fetch isn't cached, so it can be retried. */
export function loadLibrary(id: LibraryId): Promise<Library> {
  let p = cache.get(id)
  if (!p) {
    p = LOADERS[id]().then((m) => m.default as Library)
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}

/** "1001 White", "310 Black", "Elephant Grey", "White" (DMC's White has no number). */
export function shadeLabel(shade: Shade): string {
  return shade.code !== null && shade.code !== shade.name ? `${shade.code} ${shade.name}` : shade.name
}
