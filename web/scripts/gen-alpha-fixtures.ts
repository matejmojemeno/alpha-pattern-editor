/**
 * Rewrite fixtures/alpha/from-ts/: `.alpha` archives written by the TypeScript storage
 * layer, which alphareader/tests/test_alpha_compat.py opens with the desktop's
 * io.load_project. Run after changing anything in src/storage/ or src/model/:
 *
 *     npm run gen:alpha
 *
 * tests/storage/fixtures.test.ts fails while the committed files are stale.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'

import { buildFromTs, FROM_TS_DIR } from './alphaFixtures.ts'

const { archives, expected } = buildFromTs()
mkdirSync(FROM_TS_DIR, { recursive: true })
for (const name of readdirSync(FROM_TS_DIR)) {
  if (name.endsWith('.alpha')) rmSync(FROM_TS_DIR + name)
}
for (const [name, bytes] of Object.entries(archives)) writeFileSync(FROM_TS_DIR + name, bytes)
writeFileSync(FROM_TS_DIR + 'expected.json', expected)
console.log(`wrote ${Object.keys(archives).length} archives to ${FROM_TS_DIR}`)
