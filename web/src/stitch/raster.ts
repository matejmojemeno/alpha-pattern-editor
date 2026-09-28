/**
 * Strands of yarn to a shading sprite: per pixel, a shade (1 is the yarn's own colour,
 * below darker), a gloss (light the fibres reflect whatever their colour, so black yarn
 * still shows its shape) and a coverage. Colour comes later (tint), so one sprite serves
 * every colour.
 *
 * Each strand is a round tube along a smoothed path: lit from the upper left, with the
 * diagonal stripes of its plies twisting along it, and a soft shadow round it on whatever
 * lies underneath (earlier strands here, other stitches when the sprite is drawn). Later
 * strands lie over earlier ones.
 */
import type { Pt, Strand } from './geometry.ts'

export interface Sprite {
  readonly width: number
  readonly height: number
  /** Where the cell's top-left corner is in the sprite, in pixels. */
  readonly margin: number
  readonly shade: Float32Array
  readonly gloss: Float32Array
  readonly alpha: Float32Array
}

/** How far past its cell a stitch's sprite reaches, as a fraction of its width. */
export const MARGIN = 0.3

const norm = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}
const LIGHT = norm(-0.45, -0.6, 0.66)
const HALF = norm(LIGHT[0], LIGHT[1], LIGHT[2] + 1)

/** Repeatable noise in [0, 1) for a pixel. */
const noise = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000
}

/** A Catmull-Rom path through the points, as a polyline. */
export function smooth(pts: readonly Pt[], steps = 8): Pt[] {
  if (pts.length < 3) return [...pts]
  const out: Pt[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  out.push(pts[pts.length - 1]!)
  return out
}

/**
 * Rasterise strands for a stitch `w` × `h` pixels, in order, each over the ones before.
 */
export function rasterise(strands: readonly Strand[], w: number, h: number): Sprite {
  const margin = Math.ceil(MARGIN * w)
  const width = Math.ceil(w) + 2 * margin
  const height = Math.ceil(h) + 2 * margin
  // Premultiplied: `lum` is shade × coverage.
  const lum = new Float32Array(width * height)
  const shine = new Float32Array(width * height)
  const alpha = new Float32Array(width * height)

  for (const st of strands) {
    const path = smooth(st.pts).map(([x, y]) => [margin + x * w, margin + y * h] as const)
    const R = Math.max(0.6, st.r * w)
    const halo = R * 0.7
    const reach = R + halo + 1
    // Arc length at each point, for the ply stripes.
    const arc = [0]
    for (let i = 1; i < path.length; i++)
      arc.push(arc[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]))

    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [x, y] of path) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
    const px0 = Math.max(0, Math.floor(x0 - reach))
    const py0 = Math.max(0, Math.floor(y0 - reach))
    const px1 = Math.min(width - 1, Math.ceil(x1 + reach))
    const py1 = Math.min(height - 1, Math.ceil(y1 + reach))

    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        const cx = px + 0.5
        const cy = py + 0.5
        // The nearest point on the path.
        let best = Infinity
        let along = 0
        let side = 0
        let nx = 0
        let ny = 0
        for (let i = 1; i < path.length; i++) {
          const [ax, ay] = path[i - 1]!
          const [bx, by] = path[i]!
          const dx = bx - ax
          const dy = by - ay
          const len2 = dx * dx + dy * dy
          const t = len2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0
          const qx = ax + dx * t
          const qy = ay + dy * t
          const d2 = (cx - qx) ** 2 + (cy - qy) ** 2
          if (d2 < best) {
            best = d2
            along = arc[i - 1]! + t * Math.sqrt(len2)
            side = dx * (cy - ay) - dy * (cx - ax)
            nx = cx - qx
            ny = cy - qy
          }
        }
        const d = Math.sqrt(best)
        if (d > R + halo) continue
        const k = py * width + px

        // The shadow this strand casts on what's under it, where it doesn't cover.
        if (d > R - 0.5) {
          const f = 1 - Math.min(1, (d - R) / halo)
          const sa = 0.5 * f * f
          lum[k] = lum[k]! * (1 - sa)
          shine[k] = shine[k]! * (1 - sa)
          alpha[k] = sa + alpha[k]! * (1 - sa)
        }
        // A soft edge: fibres stand out a little from the strand.
        const cover = Math.max(0, Math.min(1, (R + 0.5 - d) / (1 + 0.12 * R)))
        if (cover <= 0) continue

        // A round tube: the normal leans out towards the edges.
        const e = Math.min(1, d / R)
        const z = Math.sqrt(1 - e * e)
        const inv = d > 1e-6 ? e / d : 0
        const n0 = nx * inv
        const n1 = ny * inv
        const diffuse = Math.max(0, n0 * LIGHT[0] + n1 * LIGHT[1] + z * LIGHT[2])
        const spec = Math.max(0, n0 * HALF[0] + n1 * HALF[1] + z * HALF[2]) ** 12
        // Plies: stripes slanting across the strand, twisting along it.
        const across = (side >= 0 ? 1 : -1) * e
        const ply = 0.86 + 0.14 * Math.cos(2 * Math.PI * (along / (1.5 * R) + 0.5 * across))
        // Fuzz: a little per-fibre noise.
        const fuzz = 0.94 + 0.06 * noise(px, py)
        const shade = Math.min(1.1, (0.28 + 0.76 * diffuse) * ply * fuzz * (0.72 + 0.28 * z))
        const gloss = (0.1 * spec + 0.045 * diffuse * diffuse) * ply * fuzz

        lum[k] = shade * cover + lum[k]! * (1 - cover)
        shine[k] = gloss * cover + shine[k]! * (1 - cover)
        alpha[k] = cover + alpha[k]! * (1 - cover)
      }
    }
  }

  const shade = new Float32Array(width * height)
  const gloss = new Float32Array(width * height)
  for (let k = 0; k < shade.length; k++)
    if (alpha[k]! > 0) {
      shade[k] = lum[k]! / alpha[k]!
      gloss[k] = shine[k]! / alpha[k]!
    }
  return { width, height, margin, shade, gloss, alpha }
}

const toLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const toSrgb = (c: number) => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, v)) * 255)
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** One channel of a colour at a shade, in linear light: darker by multiplying, lighter
 *  towards white. */
export function shadeChannel(v: number, shade: number): number {
  const c = toLinear(v)
  return toSrgb(shade <= 1 ? c * shade : c + (1 - c) * Math.min(1, shade - 1) * 0.8)
}

/** The sprite in a colour, as RGBA bytes. */
export function tint(sprite: Sprite, hex: string): Uint8ClampedArray<ArrayBuffer> {
  const [r, g, b] = hexRgb(hex).map(toLinear) as [number, number, number]
  const out = new Uint8ClampedArray(sprite.width * sprite.height * 4)
  for (let k = 0; k < sprite.shade.length; k++) {
    const a = sprite.alpha[k]!
    if (a <= 0) continue
    const s = sprite.shade[k]!
    const lift = s <= 1 ? 0 : Math.min(1, s - 1) * 0.8
    const m = Math.min(1, s)
    const gl = sprite.gloss[k]!
    out[k * 4] = toSrgb(r * m + (1 - r) * lift + gl)
    out[k * 4 + 1] = toSrgb(g * m + (1 - g) * lift + gl)
    out[k * 4 + 2] = toSrgb(b * m + (1 - b) * lift + gl)
    out[k * 4 + 3] = Math.round(a * 255)
  }
  return out
}
