/**
 * Two-finger pinch and pan, shared by the Design canvas and the Work chart.
 *
 * `TwoFingers` is plain bookkeeping, fed points by whatever events the view listens to
 * (pointer events on the Design canvas, where every touch is the app's; touch events on
 * the Work chart, where one finger must keep scrolling natively). It knows nothing of
 * what a pinch does to the view.
 *
 * A gesture runs from the first finger down to the last one up. It becomes a pinch the
 * moment a second finger lands, and stays one until every finger is lifted, so the
 * finger left behind when the other lifts never starts painting.
 */

export interface Point {
  readonly x: number
  readonly y: number
}

/** One step of a pinch, since the previous one. */
export interface PinchStep {
  /** The midpoint between the two fingers now (in the coordinates fed in). */
  readonly mid: Point
  /** Distance between the fingers now over the distance before: > 1 spreads them. */
  readonly scale: number
  /** How far the midpoint moved. */
  readonly dx: number
  readonly dy: number
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export class TwoFingers {
  private readonly points = new Map<number, Point>()
  /** The two fingers the pinch follows, and where they were at the last step. */
  private pair: [number, number] | null = null
  private last: { mid: Point; dist: number } | null = null
  private pinched = false

  /** Fingers down now. */
  get count(): number {
    return this.points.size
  }

  /** Whether this gesture has been a pinch (it stays one until every finger lifts). */
  get pinching(): boolean {
    return this.pinched
  }

  /** A finger landed. True when this one turns the gesture into a pinch. */
  down(id: number, p: Point): boolean {
    this.points.set(id, p)
    if (this.points.size === 2 && !this.pair) {
      const [a, b] = [...this.points.keys()] as [number, number]
      this.pair = [a, b]
      this.last = this.measure()
      const was = this.pinched
      this.pinched = true
      return !was
    }
    return false
  }

  /** A finger moved. The pinch step it makes, or null (one finger, or no change). */
  move(id: number, p: Point): PinchStep | null {
    if (!this.points.has(id)) return null
    this.points.set(id, p)
    if (!this.pair || !this.pair.includes(id) || !this.last) return null
    const now = this.measure()!
    const step: PinchStep = {
      mid: now.mid,
      scale: this.last.dist > 0 && now.dist > 0 ? now.dist / this.last.dist : 1,
      dx: now.mid.x - this.last.mid.x,
      dy: now.mid.y - this.last.mid.y,
    }
    this.last = now
    return step.scale === 1 && step.dx === 0 && step.dy === 0 ? null : step
  }

  /** A finger lifted (or was cancelled). True when that ends the gesture: none left. */
  up(id: number): boolean {
    if (!this.points.delete(id)) return false
    if (this.pair?.includes(id)) {
      this.pair = null
      this.last = null
      // A third finger still down can carry the pinch on with the one left.
      if (this.points.size >= 2) {
        const [a, b] = [...this.points.keys()] as [number, number]
        this.pair = [a, b]
        this.last = this.measure()
      }
    }
    if (this.points.size === 0) {
      this.pinched = false
      return true
    }
    return false
  }

  /** Forget everything (the view went away mid-gesture). */
  reset(): void {
    this.points.clear()
    this.pair = null
    this.last = null
    this.pinched = false
  }

  private measure(): { mid: Point; dist: number } | null {
    if (!this.pair) return null
    const a = this.points.get(this.pair[0])!
    const b = this.points.get(this.pair[1])!
    return { mid: midpoint(a, b), dist: dist(a, b) }
  }
}

/**
 * The scroll offset along one axis that keeps the content under `at` (a point in the
 * view, measured from where the scaled content starts) still when the content scales by
 * `ratio`: zooming about the fingers.
 */
export function scrollAbout(scroll: number, at: number, ratio: number): number {
  return Math.max(0, (scroll + at) * ratio - at)
}
