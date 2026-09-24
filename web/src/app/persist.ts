/**
 * Ask the browser not to evict this site's storage.
 *
 * Projects live only in IndexedDB. Browsers may clear that under storage pressure, and
 * iOS Safari clears it for sites that aren't installed after about a week without a
 * visit (docs/web-port-plan.md, Risks). persist() is the one lever we have; Safari
 * grants it far more readily to Home Screen apps. It is asked once, after the first
 * successful save or import, when the user has shown they have something to keep.
 */
let asked: Promise<boolean> | undefined

export function ensurePersisted(storage: StorageManager | undefined = globalThis.navigator?.storage): Promise<boolean> {
  asked ??= (async () => {
    try {
      if (!storage?.persist) return false
      if (await storage.persisted?.()) return true
      return await storage.persist()
    } catch {
      return false
    }
  })()
  return asked
}

/** For tests only. */
export function resetPersistRequest(): void {
  asked = undefined
}
