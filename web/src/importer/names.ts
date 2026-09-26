/**
 * Everyday names for a palette's colours ("Blue", "Dark blue", "Burgundy"), a port of
 * alphareader/core/detect/names.py, which says how they are chosen. Detection names the
 * palette in Python; the import screen names it again here whenever a colour is removed
 * or restored, so one blue left alone is "Blue" again. fixtures/colour_names.json proves
 * the two agree.
 *
 * The table is colour-names.json, the xkcd colour survey's averages (provenance:
 * README.md here), a copy of core/detect/colour_names.json.
 */
import { hexToLab, type Lab } from '../logic/lab.ts'
import table from './colour-names.json'

const WORDS = ['Very dark', 'Dark', '', 'Light', 'Very light'] as const
const PLAIN = 2
const STEP = 10
const VERY = 25

interface Anchor {
  readonly family: string
  readonly name: string
  readonly lab: Lab
}

let cache: { anchors: Anchor[]; plain: Map<string, number> } | null = null

function anchors() {
  if (!cache) {
    const list: Anchor[] = []
    const plain = new Map<string, number>()
    for (const fam of table.families) {
      fam.anchors.forEach((a, i) => {
        const lab = hexToLab(a.hex)
        list.push({ family: fam.name, name: a.name, lab })
        if (i === 0) plain.set(fam.name, lab[0])
      })
    }
    cache = { anchors: list, plain }
  }
  return cache
}

const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
/** Python's `%`: the result takes the sign of the divisor. */
const mod = (x: number, m: number) => ((x % m) + m) % m

/** CIEDE2000 colour difference (Sharma, Wu and Dalal, 2005), kL = kC = kH = 1. */
export function ciede2000(x: Lab, y: Lab): number {
  const [l1, a1, b1] = x
  const [l2, a2, b2] = y
  const cBar = (Math.sqrt(a1 * a1 + b1 * b1) + Math.sqrt(a2 * a2 + b2 * b2)) / 2
  const c7 = cBar ** 7
  const g = 0.5 * (1 - Math.sqrt(c7 / (c7 + 25 ** 7)))
  const a1p = (1 + g) * a1
  const a2p = (1 + g) * a2
  const c1p = Math.sqrt(a1p * a1p + b1 * b1)
  const c2p = Math.sqrt(a2p * a2p + b2 * b2)
  const h1p = c1p ? mod(deg(Math.atan2(b1, a1p)), 360) : 0
  const h2p = c2p ? mod(deg(Math.atan2(b2, a2p)), 360) : 0
  const dlp = l2 - l1
  const dcp = c2p - c1p
  let dhp: number
  if (c1p * c2p === 0) dhp = 0
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360
  else dhp = h2p - h1p + 360
  const dhpBig = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp / 2))
  const lpBar = (l1 + l2) / 2
  const cpBar = (c1p + c2p) / 2
  let hpBar: number
  if (c1p * c2p === 0) hpBar = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hpBar = (h1p + h2p) / 2
  else if (h1p + h2p < 360) hpBar = (h1p + h2p + 360) / 2
  else hpBar = (h1p + h2p - 360) / 2
  const t =
    1 -
    0.17 * Math.cos(rad(hpBar - 30)) +
    0.24 * Math.cos(rad(2 * hpBar)) +
    0.32 * Math.cos(rad(3 * hpBar + 6)) -
    0.2 * Math.cos(rad(4 * hpBar - 63))
  const dTheta = 30 * Math.exp(-(((hpBar - 275) / 25) ** 2))
  const cp7 = cpBar ** 7
  const rC = 2 * Math.sqrt(cp7 / (cp7 + 25 ** 7))
  const sL = 1 + (0.015 * (lpBar - 50) ** 2) / Math.sqrt(20 + (lpBar - 50) ** 2)
  const sC = 1 + 0.045 * cpBar
  const sH = 1 + 0.015 * cpBar * t
  const rT = -Math.sin(rad(2 * dTheta)) * rC
  return Math.sqrt((dlp / sL) ** 2 + (dcp / sC) ** 2 + (dhpBig / sH) ** 2 + rT * (dcp / sC) * (dhpBig / sH))
}

/** The index of the nearest anchor, in the table's order; the first of equals. */
export function nearestAnchor(lab: Lab): { index: number; deltaE: number } {
  let index = -1
  let deltaE = Infinity
  anchors().anchors.forEach((a, i) => {
    const d = ciede2000(lab, a.lab)
    if (d < deltaE) {
      index = i
      deltaE = d
    }
  })
  return { index, deltaE }
}

function idealSlot(l: number, plain: number): number {
  const d = l - plain
  if (d <= -VERY) return 0
  if (d <= -STEP) return 1
  if (d < STEP) return 2
  if (d < VERY) return 3
  return 4
}

/** Strictly increasing slots, as close to `ideal` as they can be (names.py, `_spread`). */
function spread(ideal: readonly number[]): number[] {
  const n = ideal.length
  const [lo, hi] = n <= 3 ? [1, 3] : [0, 4]
  const cost = Array.from({ length: n }, () => Array<number>(5).fill(Infinity))
  const back = Array.from({ length: n }, () => Array<number>(5).fill(-1))
  for (let s = lo; s <= hi; s++) cost[0]![s] = Math.abs(s - ideal[0]!)
  for (let i = 1; i < n; i++) {
    for (let s = lo; s <= hi; s++) {
      for (let p = lo; p < s; p++) {
        const c = cost[i - 1]![p]! + Math.abs(s - ideal[i]!)
        if (c < cost[i]![s]!) {
          cost[i]![s] = c
          back[i]![s] = p
        }
      }
    }
  }
  let s = lo
  for (let k = lo + 1; k <= hi; k++) if (cost[n - 1]![k]! < cost[n - 1]![s]!) s = k
  const out = Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    out[i] = s
    s = back[i]![s]!
  }
  return out
}

const chroma = (lab: Lab) => Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2])
const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)

/** A different everyday name for each colour of a palette. */
export function simpleNames(hexes: readonly string[]): string[] {
  const { anchors: list, plain } = anchors()
  const labs = hexes.map(hexToLab)
  const near = labs.map((lab) => nearestAnchor(lab).index)
  const out = hexes.map(() => '')
  const groups = new Map<string, number[]>()
  near.forEach((a, i) => {
    const fam = list[a]!.family
    const g = groups.get(fam)
    if (g) g.push(i)
    else groups.set(fam, [i])
  })
  for (const [fam, group] of groups) {
    // Darkest first; equal lightness keeps palette order.
    const members = [...group].sort((i, j) => labs[i]![0] - labs[j]![0] || i - j)
    if (fam === 'grey') {
      if (list[near[members[0]!]!]!.name === 'black') out[members.shift()!] = 'Black'
      if (members.length && list[near[members[members.length - 1]!]!]!.name === 'white') out[members.pop()!] = 'White'
    }
    const n = members.length
    if (n === 0) continue
    if (n === 1) {
      out[members[0]!] = cap(fam)
    } else if (
      n === 2 &&
      Math.abs(chroma(labs[members[0]!]!) - chroma(labs[members[1]!]!)) > Math.abs(labs[members[0]!]![0] - labs[members[1]!]![0])
    ) {
      const [strong, weak] = [...members].sort((i, j) => chroma(labs[j]!) - chroma(labs[i]!) || i - j)
      out[strong!] = `Bright ${fam}`
      out[weak!] = `Muted ${fam}`
    } else if (n <= WORDS.length) {
      const slots = spread(members.map((i) => idealSlot(labs[i]![0], plain.get(fam)!)))
      members.forEach((i, k) => {
        const s = slots[k]!
        out[i] = s === PLAIN ? cap(fam) : `${WORDS[s]} ${fam}`
      })
    } else {
      members.forEach((i, k) => (out[i] = `${cap(fam)} ${k + 1}`))
    }
  }
  return out
}
