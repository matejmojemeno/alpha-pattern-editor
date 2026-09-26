/**
 * Hash routing: `#/library`, `#/work/<id>`, and so on.
 *
 * Why hash rather than history routing: the app is static files on Cloudflare Pages.
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
  | { name: 'import' }
  | { name: 'work'; id: string }
  | { name: 'design'; id: string }
  /** A project, in whichever stage it should open in (ui/screens/OpenProject.tsx). */
  | { name: 'open'; id: string }
  | { name: 'notFound' }

export const paths = {
  landing: '/',
  library: '/library',
  settings: '/settings',
  importImage: '/import',
  work: (id: string) => `/work/${encodeURIComponent(id)}`,
  design: (id: string) => `/design/${encodeURIComponent(id)}`,
  open: (id: string) => `/open/${encodeURIComponent(id)}`,
} as const

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/(.)\/+$/, '$1') || '/'
  if (path === '/') return { name: 'landing' }
  if (path === paths.library) return { name: 'library' }
  if (path === paths.settings) return { name: 'settings' }
  if (path === paths.importImage) return { name: 'import' }
  const project = /^\/(work|design|open)\/([^/]+)$/.exec(path)
  if (project) {
    try {
      return { name: project[1] as 'work' | 'design' | 'open', id: decodeURIComponent(project[2]!) }
    } catch {
      return { name: 'notFound' }
    }
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
