// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { ANALYTICS_HOST, BEACON_SRC, startAnalytics } from '../../src/app/analytics.ts'

const beacons = () => [...document.querySelectorAll('script')].filter((s) => s.src === BEACON_SRC)

afterEach(() => {
  for (const s of beacons()) s.remove()
})

describe('visit counting', () => {
  it('adds the Cloudflare beacon on the production address, without counting screen changes', () => {
    expect(startAnalytics(document, ANALYTICS_HOST)).toBe(true)
    const found = beacons()
    expect(found).toHaveLength(1)
    expect(found[0]!.type).toBe('module')
    expect(JSON.parse(found[0]!.dataset.cfBeacon!)).toEqual({ token: '1ddafbf5c84345ffb0478f477179f030', spa: false })
  })

  it('stays off everywhere else: previews, localhost', () => {
    for (const host of ['localhost', '127.0.0.1', 'abc123-alpha-pattern-editor.8b2mbys5sy.workers.dev']) {
      expect(startAnalytics(document, host)).toBe(false)
    }
    expect(startAnalytics()).toBe(false) // jsdom's own address is localhost
    expect(beacons()).toHaveLength(0)
  })
})
