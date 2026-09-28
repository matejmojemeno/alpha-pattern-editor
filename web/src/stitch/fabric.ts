/**
 * A pattern drawn as crocheted fabric, on a Canvas 2D.
 *
 * Every stitch is a sprite (raster.ts) in its colour, cached per stitch, face, variant,
 * part, size and colour, so a view of thousands of stitches is thousands of drawImage
 * calls. Drawn in layers, so loops lie over what they lie over in the fabric:
 *
 * 1. the shadowed depth of the fabric under every stitch;
 * 2. carried strands, along the foot of the stitches worked over them;
 * 3. the stitches, the first row worked first, so each row's feet lie over the top of
 *    the row below;
 * 4. top loops, over the feet of the row above;
 * 5. ridges (back or front loop only), in the colour of the row below.
 *
 * Only the cells in view are drawn.
 */
import { SKIP_INDEX } from '../model/types.ts'
import type { StitchId } from './catalogue.ts'
import { cellLook, type CellLook, type Mode } from './faces.ts'
import { carriedStrand, stitchStrands, VARIANTS, type Part } from './geometry.ts'
import { rasterise, shadeChannel, hexRgb, tint, type Sprite } from './raster.ts'

export interface Fabric {
  readonly rows: number
  readonly cols: number
  readonly cells: Uint16Array
  /** Each palette entry's colour, `#rrggbb`. */
  readonly colours: readonly string[]
  readonly stitch: StitchId
  readonly mode: Mode
  /** A stitch's height over its width. */
  readonly aspect: number
  /** The colours carried inside each cell (palette indices), or null for none shown. */
  readonly carried: readonly (readonly number[])[] | null
}

export interface View {
  /** A stitch's width, in canvas pixels. */
  readonly stitch: number
  /** Where the pattern's top-left corner is, in canvas pixels. */
  readonly x: number
  readonly y: number
}

/** Sprites are drawn at most this wide and scaled up beyond it. */
const MAX_SPRITE = 72
/** Under this width a stitch is a block of colour: its strands would be under a pixel. */
const MIN_SPRITE = 4
/** The fabric's depth, between and behind the stitches: its colour at this shade. */
const DEPTH = 0.07

type Canvasish = HTMLCanvasElement | OffscreenCanvas

function makeCanvas(w: number, h: number): Canvasish {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Cell hash, for choosing a variant: the same stitch always gets the same one. */
const variantOf = (r: number, c: number) => (((r * 73856093) ^ (c * 19349663)) >>> 0) % VARIANTS

export function depthColour(hex: string): string {
  const [r, g, b] = hexRgb(hex)
  return `rgb(${shadeChannel(r, DEPTH)} ${shadeChannel(g, DEPTH)} ${shadeChannel(b, DEPTH)})`
}

export class FabricPainter {
  private sprites = new Map<string, Sprite>()
  private tinted = new Map<string, Canvasish>()
  private size = ''

  /** Drop every cached sprite (the stitch's shape changed). */
  clear(): void {
    this.sprites.clear()
    this.tinted.clear()
  }

  draw(ctx: CanvasRenderingContext2D, f: Fabric, view: View): void {
    const { width, height } = ctx.canvas
    ctx.clearRect(0, 0, width, height)
    const w = view.stitch
    const h = w * f.aspect
    if (f.rows === 0 || f.cols === 0 || w <= 0) return

    // Cells in view, with one around for the loops that spill out of them.
    const c0 = Math.max(0, Math.floor(-view.x / w) - 1)
    const c1 = Math.min(f.cols - 1, Math.ceil((width - view.x) / w) + 1)
    const r0 = Math.max(0, Math.floor(-view.y / h) - 1)
    const r1 = Math.min(f.rows - 1, Math.ceil((height - view.y) / h) + 1)
    if (c0 > c1 || r0 > r1) return

    const colour = (r: number, c: number) => {
      const v = f.cells[r * f.cols + c]!
      return v === SKIP_INDEX ? null : (f.colours[v] ?? null)
    }

    // 1. Depth, a block per cell.
    const depth = new Map<string, string>()
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const hex = colour(r, c)
        if (!hex) continue
        let fill = depth.get(hex)
        if (!fill) depth.set(hex, (fill = depthColour(hex)))
        ctx.fillStyle = fill
        ctx.fillRect(Math.floor(view.x + c * w), Math.floor(view.y + r * h), Math.ceil(w) + 1, Math.ceil(h) + 1)
      }

    if (w < MIN_SPRITE) {
      // Too small for strands: the stitches' colour over the depth, a stitch's worth inset.
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const hex = colour(r, c)
          if (!hex) continue
          ctx.fillStyle = hex
          ctx.fillRect(view.x + c * w + w * 0.08, view.y + r * h + h * 0.06, w * 0.84, h * 0.88)
        }
      return
    }

    // Sprites are made at `sw` wide and drawn at `w`.
    const sw = Math.min(MAX_SPRITE, Math.round(w))
    const sh = sw * f.aspect
    const size = `${f.stitch}|${sw}|${sh.toFixed(3)}`
    if (size !== this.size) {
      this.clear()
      this.size = size
    }
    const scale = w / sw
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const stamp = (key: string, make: () => Sprite, hex: string, r: number, c: number) => {
      const img = this.sprite(key, make, hex)
      if (!img) return
      const m = img.margin * scale
      ctx.drawImage(img.canvas, view.x + c * w - m, view.y + r * h - m, img.canvas.width * scale, img.canvas.height * scale)
    }
    const partSprite = (look: CellLook, v: number, part: Part) => () =>
      rasterise(
        stitchStrands(f.stitch, look, v).filter((s) => s.part === part),
        sw,
        sh,
      )
    const lookKey = (look: CellLook) => `${look.face}${look.across ? 'x' : ''}${look.lean}${look.ridge ? 'r' : ''}`

    // Rows in the order they're worked: the bottom row first.
    const order: number[] = []
    for (let r = r1; r >= r0; r--) order.push(r)

    // 2. Carried strands.
    if (f.carried) {
      for (const r of order)
        for (let c = c0; c <= c1; c++) {
          if (!colour(r, c)) continue
          const list = f.carried[r * f.cols + c]
          if (!list) continue
          list.forEach((p, slot) => {
            const hex = f.colours[p]
            if (hex) stamp(`carry${slot}`, () => rasterise([carriedStrand(slot)], sw, sh), hex, r, c)
          })
        }
    }

    // 3–5. Stitches, top loops, ridges.
    for (const part of ['body', 'over', 'ridge'] as const)
      for (const r of order)
        for (let c = c0; c <= c1; c++) {
          const own = colour(r, c)
          if (!own) continue
          const look = cellLook(f.stitch, f.mode, f.rows, r, c)
          if (part === 'ridge' && !look.ridge) continue
          const hex = part === 'ridge' ? (r + 1 < f.rows ? colour(r + 1, c) : null) ?? own : own
          const v = variantOf(r, c)
          stamp(`${lookKey(look)}|${v}|${part}`, partSprite(look, v, part), hex, r, c)
        }
  }

  private sprite(key: string, make: () => Sprite, hex: string): { canvas: Canvasish; margin: number } | null {
    let sprite = this.sprites.get(key)
    if (!sprite) this.sprites.set(key, (sprite = make()))
    const tkey = `${key}|${hex}`
    let canvas = this.tinted.get(tkey)
    if (!canvas) {
      canvas = makeCanvas(sprite.width, sprite.height)
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
      if (!ctx) return null
      ctx.putImageData(new ImageData(tint(sprite, hex), sprite.width, sprite.height), 0, 0)
      this.tinted.set(tkey, canvas)
    }
    return { canvas, margin: sprite.margin }
  }
}

/**
 * The colours carried inside each cell (palette indices, per cell), from the carry plan's
 * carries between rows and the stretches between a colour's runs within a row, which are
 * carried anyway (logic/carry.ts).
 */
export function carriedCells(
  rows: number,
  cols: number,
  cells: Uint16Array,
  plan: readonly (readonly { palette_index: number; from: number; to: number }[])[],
): number[][] {
  const out: number[][] = Array.from({ length: rows * cols }, () => [])
  const add = (r: number, c: number, p: number) => {
    const list = out[r * cols + c]!
    if (cells[r * cols + c] !== p && !list.includes(p)) list.push(p)
  }
  for (let r = 0; r < rows; r++) {
    const span = new Map<number, [number, number]>()
    for (let c = 0; c < cols; c++) {
      const v = cells[r * cols + c]!
      if (v === SKIP_INDEX) continue
      const e = span.get(v)
      if (e) e[1] = c
      else span.set(v, [c, c])
    }
    for (const [p, [a, b]] of span) for (let c = a + 1; c < b; c++) add(r, c, p)
    for (const carry of plan[r] ?? []) for (let c = carry.from; c < carry.to; c++) add(r, c, carry.palette_index)
  }
  return out
}
