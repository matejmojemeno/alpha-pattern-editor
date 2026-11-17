/**
 * Hash routing: `#/library`, `#/work/<id>`, and so on.
 *
 * Why hash rather than history routing: the app is static files on Cloudflare (web/README.md, "Deploying").
 * With paths like /work/<id>, a refresh asks the server for that path, and only an SPA
 * fallback rule keeps it from being a 404. Pages' behaviour there depends on whether a
 * 404.html exists, and its `/* /index.html 200` redirect has a history of being flagged
 * as a loop. The part after `#` never reaches the server, so hash links survive a
 * refresh on any static host, and on `vite preview`, with no configuration to get wrong.
 * There is no server rendering or SEO to lose.
 */
import { useMemo, useSyncExternalStore } from 'react'

export type Route =
  | { name: 'landing' }
  | { name: 'library' }
  | { name: 'settings' }
  /** `into`: imported from a pattern's Design stage ("From another pattern"), to go back
   *  to it once saved, with the new pattern open in that panel. */
  | { name: 'import'; into?: string }
  /** The import screen for a picture to turn into a pattern ("Photo to pattern"). */
  | { name: 'photo'; into?: string }
  | { name: 'work'; id: string }
  /** `from`: the pattern to open in the "From another pattern" panel. */
  | { name: 'design'; id: string; from?: string }
  /** A project, in whichever stage it should open in (ui/screens/OpenProject.tsx). */
  | { name: 'open'; id: string }
  /** A project with pieces, in the Library: its pieces as cards. */
  | { name: 'project'; id: string }
  | { name: 'notFound' }

export const paths = {
  landing: '/',
  library: '/library',
  settings: '/settings',
  importImage: '/import',
  photo: '/photo',
  work: (id: string) => `/work/${encodeURIComponent(id)}`,
  design: (id: string, from?: string) => `/design/${encodeURIComponent(id)}${from ? `?from=${encodeURIComponent(from)}` : ''}`,
  /** An import screen that goes back to pattern `into`'s Design stage once saved. */
  importInto: (kind: 'import' | 'photo', into: string) => `/${kind}?into=${encodeURIComponent(into)}`,
  open: (id: string) => `/open/${encodeURIComponent(id)}`,
  project: (id: string) => `/project/${encodeURIComponent(id)}`,
} as const

/** One query value (`?into=…`) after the path, decoded, or undefined. Ids are encoded
 *  with encodeURIComponent, so a `?` or `&` in one never reaches here unencoded. */
function queryValue(query: string, key: string): string | undefined {
  for (const part of query.split('&')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq) === key && eq + 1 < part.length) {
      try {
        return decodeURIComponent(part.slice(eq + 1))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

export function parseHash(hash: string): Route {
  const full = hash.replace(/^#/, '')
  const q = full.indexOf('?')
  const query = q < 0 ? '' : full.slice(q + 1)
  const path = (q < 0 ? full : full.slice(0, q)).replace(/(.)\/+$/, '$1') || '/'
  if (path === '/') return { name: 'landing' }
  if (path === paths.library) return { name: 'library' }
  if (path === paths.settings) return { name: 'settings' }
  if (path === paths.importImage || path === paths.photo) {
    const into = queryValue(query, 'into')
    return { name: path === paths.photo ? 'photo' : 'import', ...(into ? { into } : {}) }
  }
  const project = /^\/(work|design|open|project)\/([^/]+)$/.exec(path)
  if (project) {
    let id: string
    try {
      id = decodeURIComponent(project[2]!)
    } catch {
      return { name: 'notFound' }
    }
    if (project[1] === 'design') {
      const from = queryValue(query, 'from')
      return { name: 'design', id, ...(from ? { from } : {}) }
    }
    return { name: project[1] as 'work' | 'open' | 'project', id }
  }
  return { name: 'notFound' }
}

/** An href for a route path, for <a> elements. */
export const href = (path: string) => `#${path}`

export function navigate(path: string): void {
  window.location.hash = path
}

/** Go to `path` in place of the current entry, so Back skips the one being left (a
 *  redirect, like #/open/<id> once it knows the stage). */
export function redirect(path: string): void {
  window.location.replace(href(path))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '')
  return useMemo(() => parseHash(hash), [hash])
}
