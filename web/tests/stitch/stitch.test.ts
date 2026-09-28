import { describe, expect, it } from 'vitest'

import { SKIP_INDEX } from '../../src/model/types.ts'
import { STITCH_IDS } from '../../src/stitch/ids.ts'
import { gaugeAspect, shapeText, stitchById, STITCHES, swatchAspect } from '../../src/stitch/catalogue.ts'
import { carriedCells } from '../../src/stitch/fabric.ts'
import { cellLook } from '../../src/stitch/faces.ts'
import { stitchStrands, VARIANTS } from '../../src/stitch/geometry.ts'
import { rasterise, shadeChannel, tint } from '../../src/stitch/raster.ts'

describe('the stitches’ proportions', () => {
  it('are the median of their published gauges, as height over width', () => {
    // 12 sc × 15 rows = 4 in: a stitch 4/12 in wide and 4/15 in tall.
    expect(stitchById('sc').aspect).toBeCloseTo(0.8, 6)
    // Nine hdc swatches; the fifth of their sorted ratios is 13/10.
    expect(stitchById('hdc').aspect).toBeCloseTo(1.3, 6)
    // 12/6.5, 15/7.5 and 8/4: the median is 2.
    expect(stitchById('dc').aspect).toBeCloseTo(2, 6)
    expect(stitchById('waistcoat').aspect).toBeCloseTo(14 / 17.25, 6)
    expect(stitchById('c2c').aspect).toBe(1)
    // No measured figure for one loop only: single crochet's.
    expect(stitchById('sc-blo').aspect).toBe(stitchById('sc').aspect)
    expect(stitchById('sc-flo').aspect).toBe(stitchById('sc').aspect)
  })

  it('take the middle two’s mean for an even count', () => {
    expect(
      gaugeAspect([
        { stitches: 1, rows: 1, source: '' },
        { stitches: 3, rows: 1, source: '' },
      ]),
    ).toBe(2)
  })

  it('are listed for every stitch id, in order', () => {
    expect(STITCHES.map((s) => s.id)).toEqual([...STITCH_IDS])
  })

  it('every stitch cites where its gauge comes from', () => {
    for (const s of STITCHES) {
      expect(s.gauges.length, s.id).toBeGreaterThan(0)
      for (const g of s.gauges) expect(g.source, s.id).not.toBe('')
    }
  })

  it('come from the swatch once it is measured', () => {
    // 10 stitches in 12 cm, 10 rows in 9 cm: 0.9 cm tall for 1.2 cm wide.
    expect(swatchAspect({ stitches: 10, rows: 10, widthCm: 12, heightCm: 9 })).toBeCloseTo(0.75, 6)
    expect(swatchAspect({ stitches: 10, rows: 10, widthCm: null, heightCm: 9 })).toBeNull()
  })

  it('are described in words', () => {
    expect(shapeText(0.8)).toBe(
      'Stitches are 80% as tall as they are wide, so the picture comes out 20% shorter than the chart.',
    )
    expect(shapeText(2)).toBe(
      'Stitches are 2 times as tall as they are wide, so the picture comes out 2 times as tall as the chart shows it.',
    )
    expect(shapeText(1.3)).toMatch(/^Stitches are 1\.3 times as tall/)
    expect(shapeText(1)).toBe('Stitches are about square, so the picture keeps the chart’s shape.')
  })
})

describe('which side of each stitch shows', () => {
  // 4 rows: chart row 3 is worked first.
  const faces = (id: Parameters<typeof cellLook>[0], mode: 'turned' | 'rs') =>
    [3, 2, 1, 0].map((r) => cellLook(id, mode, 4, r, 0))

  it('alternates in turned rows, the first row worked showing its front', () => {
    expect(faces('sc', 'turned').map((l) => l.face)).toEqual(['front', 'back', 'front', 'back'])
    expect(faces('sc', 'rs').map((l) => l.face)).toEqual(['front', 'front', 'front', 'front'])
  })

  it('shows back-loop ridges on rows worked facing the right side, front-loop ones on the others', () => {
    // The first row, into the foundation chain, has none.
    expect(faces('sc-blo', 'turned').map((l) => l.ridge)).toEqual([false, false, true, false])
    expect(faces('sc-flo', 'turned').map((l) => l.ridge)).toEqual([false, true, false, true])
    expect(faces('sc-blo', 'rs').map((l) => l.ridge)).toEqual([false, true, true, true])
    expect(faces('sc-flo', 'rs').map((l) => l.ridge)).toEqual([false, false, false, false])
    expect(faces('sc', 'turned').some((l) => l.ridge)).toBe(false)
  })

  it('lays C2C tiles in a checkerboard of directions and sides, whatever the choice of rows', () => {
    for (const mode of ['turned', 'rs'] as const) {
      expect(cellLook('c2c', mode, 4, 0, 0)).toMatchObject({ face: 'front', across: false })
      expect(cellLook('c2c', mode, 4, 0, 1)).toMatchObject({ face: 'back', across: true })
      expect(cellLook('c2c', mode, 4, 1, 1)).toMatchObject({ face: 'front', across: false })
    }
  })

  it('leans waistcoat stitches alternately in turned rows, and not in rounds', () => {
    expect(faces('waistcoat', 'turned').map((l) => Math.sign(l.lean))).toEqual([1, -1, 1, -1])
    expect(faces('waistcoat', 'rs').every((l) => l.lean === 0)).toBe(true)
  })
})

describe('stitch strands', () => {
  it('give a ridge only to stitches that have one', () => {
    const plain = stitchStrands('sc-blo', cellLook('sc-blo', 'turned', 4, 3, 0), 0)
    const ridged = stitchStrands('sc-blo', cellLook('sc-blo', 'turned', 4, 1, 0), 0)
    expect(plain.some((s) => s.part === 'ridge')).toBe(false)
    expect(ridged.filter((s) => s.part === 'ridge')).toHaveLength(1)
  })

  it('are the same every time for a variant, and differ between variants', () => {
    const look = cellLook('dc', 'turned', 4, 3, 0)
    expect(stitchStrands('dc', look, 2)).toEqual(stitchStrands('dc', look, 2))
    const all = Array.from({ length: VARIANTS }, (_, v) => JSON.stringify(stitchStrands('dc', look, v)))
    expect(new Set(all).size).toBe(VARIANTS)
  })

  it('turn C2C tiles across: a post running down runs sideways', () => {
    const down = stitchStrands('c2c', { face: 'front', ridge: false, across: false, lean: 0 }, 0)
    const across = stitchStrands('c2c', { face: 'front', ridge: false, across: true, lean: 0 }, 0)
    const extent = (pts: readonly (readonly [number, number])[], i: 0 | 1) =>
      Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]))
    // A post: the thickest strand (variant 0 isn't nudged).
    const post = (ss: typeof down) => ss.reduce((a, b) => (b.r > a.r ? b : a))
    expect(extent(post(down).pts, 1)).toBeGreaterThan(extent(post(down).pts, 0))
    expect(extent(post(across).pts, 0)).toBeGreaterThan(extent(post(across).pts, 1))
  })
})

describe('rasterising yarn', () => {
  const strand = { pts: [[0, 0.5], [1, 0.5]] as const, r: 0.2, part: 'body' as const }

  it('covers the strand, shades it as a tube lit from above, and casts a shadow beside it', () => {
    const s = rasterise([strand], 40, 40)
    const at = (x: number, y: number) => (s.margin + y) * s.width + s.margin + x
    // On the centre line: covered.
    expect(s.alpha[at(20, 20)]).toBe(1)
    // Lit from above: the upper edge is lighter than the lower.
    expect(s.shade[at(20, 14)]!).toBeGreaterThan(s.shade[at(20, 26)]!)
    // Just outside (radius 8 px): a shadow, dark and partly transparent.
    const out = at(20, 29)
    expect(s.alpha[out]).toBeGreaterThan(0)
    expect(s.alpha[out]).toBeLessThan(0.5)
    expect(s.shade[out]).toBe(0)
    // Far away: nothing.
    expect(s.alpha[at(20, 0)]).toBe(0)
  })

  it('reaches past the cell by its margin, so loops can spill into the neighbours', () => {
    const s = rasterise([{ ...strand, pts: [[-0.2, 0.5], [1.2, 0.5]] }], 40, 20)
    expect(s.width).toBe(40 + 2 * s.margin)
    expect(s.height).toBe(20 + 2 * s.margin)
    expect(s.alpha[(s.margin + 10) * s.width + 2]).toBeGreaterThan(0)
  })

  it('is repeatable', () => {
    expect(rasterise([strand], 30, 24)).toEqual(rasterise([strand], 30, 24))
  })

  it('tints in linear light, and black yarn still shows its sheen', () => {
    expect(shadeChannel(200, 1)).toBe(200)
    expect(shadeChannel(200, 0.5)).toBeLessThan(200)
    const s = rasterise([strand], 40, 40)
    const black = tint(s, '#000000')
    const k = (s.margin + 18) * s.width + s.margin + 20
    expect(black[k * 4 + 3]).toBe(255)
    expect(black[k * 4]).toBeGreaterThan(0)
    const white = tint(s, '#ffffff')
    expect(white[k * 4]).toBeGreaterThan(black[k * 4]!)
  })
})

describe('carried yarn', () => {
  it('lies between a colour’s runs in a row, and where the plan carries it between rows', () => {
    // One row: 0 1 1 0 0 1 — colour 0 is carried in columns 1–2, colour 1 in 3–4.
    const cells = Uint16Array.from([0, 1, 1, 0, 0, 1])
    const out = carriedCells(1, 6, cells, [[]])
    expect(out).toEqual([[], [0], [0], [1], [1], []])
    // The plan's carries add to it, never in a cell of that colour.
    const planned = carriedCells(1, 6, cells, [[{ palette_index: 1, from: 0, to: 1 }]])
    expect(planned[0]).toEqual([1])
  })

  it('skips cells with no stitch', () => {
    const cells = Uint16Array.from([0, SKIP_INDEX, 0])
    expect(carriedCells(1, 3, cells, [[]])).toEqual([[], [0], []])
  })
})
