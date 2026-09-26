import { describe, expect, it } from 'vitest'

import { parseHash, paths } from '../../src/app/router.ts'
import { hasProgress, openingStage, progressWarning } from '../../src/app/stages.ts'
import { newPattern } from '../../src/logic/edit.ts'
import { completeCurrentRow, ensureStarted, setRunStitches } from '../../src/logic/work.ts'
import { emptyProgress, type Stage } from '../../src/model/types.ts'

const pattern = newPattern(3, 4, '#ffffff')

describe('the stage a project opens in (§6.4)', () => {
  it('is the Work stage whenever there is progress', () => {
    const pr = completeCurrentRow(pattern, ensureStarted(pattern, emptyProgress()))
    for (const stage of ['design', 'work'] as Stage[]) expect(openingStage({ pattern, progress: pr, stage })).toBe('work')
    // Part of the first row counts too.
    const partial = setRunStitches(pattern, ensureStarted(pattern, emptyProgress()), 0, 1)
    expect(hasProgress(pattern, partial)).toBe(true)
    expect(openingStage({ pattern, progress: partial, stage: 'design' })).toBe('work')
  })

  it('is the stage it was last in otherwise', () => {
    for (const stage of ['design', 'work'] as Stage[]) {
      expect(openingStage({ pattern, progress: emptyProgress(), stage })).toBe(stage)
    }
    // Merely opened in Work (started, nothing done) is no progress.
    const started = ensureStarted(pattern, emptyProgress())
    expect(openingStage({ pattern, progress: started, stage: 'design' })).toBe('design')
    // Rows done that no longer exist don't count.
    const gone = { ...emptyProgress(), completed_row_ids: new Set(['deleted']) }
    expect(hasProgress(pattern, gone)).toBe(false)
  })

  it('warns in Design with the rows done', () => {
    let pr = ensureStarted(pattern, emptyProgress())
    expect(progressWarning(pattern, pr)).toBeNull()
    pr = completeCurrentRow(pattern, pr)
    expect(progressWarning(pattern, pr)).toBe("You're 1 row into this project. Structural edits may shift your place.")
    pr = completeCurrentRow(pattern, pr)
    expect(progressWarning(pattern, pr)).toBe("You're 2 rows into this project. Structural edits may shift your place.")
  })
})

describe('routes', () => {
  it('maps the Design stage and the open route, and round-trips ids', () => {
    expect(parseHash('#/design/abc')).toEqual({ name: 'design', id: 'abc' })
    expect(parseHash('#/open/abc')).toEqual({ name: 'open', id: 'abc' })
    for (const id of ['a b/c?d#e', 'ünï']) {
      expect(parseHash(`#${paths.design(id)}`)).toEqual({ name: 'design', id })
      expect(parseHash(`#${paths.open(id)}`)).toEqual({ name: 'open', id })
    }
    for (const h of ['#/design', '#/design/', '#/open/a/b']) expect(parseHash(h)).toEqual({ name: 'notFound' })
  })
})
