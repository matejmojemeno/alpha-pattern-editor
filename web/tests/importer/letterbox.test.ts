/**
 * The letterboxed fit and the screen → image mapping, ported from source_view.py.
 */
import { describe, expect, it } from 'vitest'

import { cropFromDrag, fitRect, toBox, toImage } from '../../src/importer/letterbox.ts'

describe('fitRect', () => {
  it('fits a wide image to the width, centred vertically', () => {
    expect(fitRect(400, 400, 800, 400)).toEqual({ x: 0, y: 100, width: 400, height: 200 })
  })

  it('fits a tall image to the height, centred horizontally', () => {
    expect(fitRect(400, 300, 100, 200)).toEqual({ x: 125, y: 0, width: 150, height: 300 })
  })

  it('uses whole pixels, as source_view.py does', () => {
    // scale = min(333/1000, 250/700) = 0.333: 1000 → 333, 700 → 233.1 → 233; y = (250-233)//2
    expect(fitRect(333, 250, 1000, 700)).toEqual({ x: 0, y: 8, width: 333, height: 233 })
  })

  it('is empty until there is a box and an image', () => {
    expect(fitRect(0, 300, 100, 100)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(fitRect(300, 300, 0, 100)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('toImage', () => {
  const fit = fitRect(400, 400, 800, 400) // { x: 0, y: 100, width: 400, height: 200 }

  it('maps a point on the image to its pixel', () => {
    expect(toImage({ x: 0, y: 100 }, fit, 800, 400)).toEqual({ x: 0, y: 0 })
    expect(toImage({ x: 200, y: 200 }, fit, 800, 400)).toEqual({ x: 400, y: 200 })
    expect(toImage({ x: 100.6, y: 150.3 }, fit, 800, 400)).toEqual({ x: 201, y: 100 })
  })

  it('clamps a point in the letterbox to the nearest edge', () => {
    expect(toImage({ x: -20, y: 10 }, fit, 800, 400)).toEqual({ x: 0, y: 0 })
    expect(toImage({ x: 500, y: 390 }, fit, 800, 400)).toEqual({ x: 800, y: 400 })
  })

  it('round-trips with toBox', () => {
    const p = toBox({ x: 600, y: 300 }, fit, 800, 400)
    expect(p).toEqual({ x: 300, y: 250 })
    expect(toImage(p, fit, 800, 400)).toEqual({ x: 600, y: 300 })
  })
})

describe('cropFromDrag', () => {
  const fit = fitRect(400, 300, 4000, 3000) // exactly 10 image pixels per screen pixel

  it('turns a drag into a crop in image pixels, whichever way it was dragged', () => {
    expect(cropFromDrag({ x: 100, y: 75 }, { x: 300, y: 225 }, fit, 4000, 3000)).toEqual([1000, 750, 3000, 2250])
    expect(cropFromDrag({ x: 300, y: 225 }, { x: 100, y: 75 }, fit, 4000, 3000)).toEqual([1000, 750, 3000, 2250])
  })

  it('speaks the image’s own pixels even when detection ran on a shrunk copy', () => {
    // A 4000×3000 photo is detected at 2000×1500, but the bridge takes and returns
    // coordinates in the image's own pixels, so the crop is the same either way: the
    // mapping only ever sees the image's own size.
    const crop = cropFromDrag({ x: 40, y: 30 }, { x: 360, y: 270 }, fit, 4000, 3000)
    expect(crop).toEqual([400, 300, 3600, 2700])
  })

  it('ignores a slip: under 8 px on screen, or under 8 image pixels', () => {
    expect(cropFromDrag({ x: 10, y: 10 }, { x: 17, y: 200 }, fit, 4000, 3000)).toBeNull()
    expect(cropFromDrag({ x: 10, y: 10 }, { x: 200, y: 17 }, fit, 4000, 3000)).toBeNull()
    // A tiny image blown up: 20 screen pixels are only 4 image pixels.
    const small = fitRect(400, 300, 80, 60)
    expect(cropFromDrag({ x: 0, y: 0 }, { x: 20, y: 20 }, small, 80, 60)).toBeNull()
    expect(cropFromDrag({ x: 0, y: 0 }, { x: 50, y: 50 }, small, 80, 60)).toEqual([0, 0, 10, 10])
  })

  it('clamps a drag that strays into the letterbox', () => {
    const tall = fitRect(400, 300, 1000, 1500) // { x: 100, y: 0, width: 200, height: 300 }
    expect(cropFromDrag({ x: 20, y: -5 }, { x: 390, y: 150 }, tall, 1000, 1500)).toEqual([0, 0, 1000, 750])
  })
})
