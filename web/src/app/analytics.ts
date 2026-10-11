/**
 * Count visits with Cloudflare Web Analytics, on the production address only.
 *
 * The beacon sets no cookies and keeps no visitor id. It sends the page's address with the
 * `#…` part and any query string removed (checked in beacon.min.js 2026.10.0), so a
 * project id in `#/work/<id>` never leaves the browser. `spa: false`: every screen is `/`
 * with a different hash, so counting screen changes would only repeat `/`; one page load
 * is one page view.
 *
 * Previews, `localhost` and the e2e runs don't load it, so they add no fake visits and
 * make no request to another site. The token is public: it ships in the page.
 */
export const ANALYTICS_HOST = 'alpha-pattern-editor.8b2mbys5sy.workers.dev'
export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js'
const TOKEN = '1ddafbf5c84345ffb0478f477179f030'

/** Add the beacon script when the page is served from the production address. */
export function startAnalytics(doc: Document = document, hostname = doc.location.hostname): boolean {
  if (hostname !== ANALYTICS_HOST) return false
  const script = doc.createElement('script')
  script.type = 'module' // as Cloudflare's snippet has it
  script.src = BEACON_SRC
  script.dataset.cfBeacon = JSON.stringify({ token: TOKEN, spa: false })
  doc.body.append(script)
  return true
}
