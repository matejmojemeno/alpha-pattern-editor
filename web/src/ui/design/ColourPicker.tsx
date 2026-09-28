/**
 * A colour picker drawn on the page: a saturation–brightness square, a hue slider and a
 * hex field. Every move reports the colour at once, so the chart can show it while it is
 * chosen. The browser's own picker is a separate window on some systems (Chrome on macOS)
 * that reports only when it closes and stays open when the page is clicked, which is what
 * this replaces in the colour menu.
 *
 * The hue is kept here, not derived from the colour, so greys and black (which have no
 * hue) don't throw the slider back to red.
 */
import { useId, useRef, useState } from 'react'

import { hexToHsv, type Hsv, hsvToHex, parseHex } from './hsv.ts'
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export function ColourPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const id = useId()
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  // A colour from outside (the hex field, an undo) moves the picker; its own moves don't.
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (hsvToHex(hsv) !== value) {
      const next = hexToHsv(value)
      setHsv(next.s && next.v ? next : { ...next, h: hsv.h })
    }
  }
  const [typed, setTyped] = useState<string | null>(null)

  const set = (next: Hsv) => {
    setHsv(next)
    const hex = hsvToHex(next)
    setSeen(hex)
    if (hex !== value) onChange(hex)
  }

  const area = useRef<HTMLDivElement>(null)
  const fromPointer = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect()
    set({ h: hsv.h, s: clamp((e.clientX - r.left) / r.width, 0, 1), v: clamp(1 - (e.clientY - r.top) / r.height, 0, 1) })
  }
  const onAreaKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const d = move[e.key]
    if (!d) return
    e.preventDefault()
    set({ h: hsv.h, s: clamp(hsv.s + d[0], 0, 1), v: clamp(hsv.v + d[1], 0, 1) })
  }

  const pct = (x: number) => `${Math.round(x * 100)}%`
  return (
    <div className="picker">
      <div
        ref={area}
        className="picker__area"
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.v * 100)}
        aria-valuetext={`Saturation ${pct(hsv.s)}, brightness ${pct(hsv.v)}`}
        style={{ '--hue': `hsl(${hsv.h} 100% 50%)` } as React.CSSProperties}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          fromPointer(e)
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && fromPointer(e)}
        onKeyDown={onAreaKey}
      >
        <span className="picker__thumb" style={{ left: pct(hsv.s), top: pct(1 - hsv.v), background: value }} aria-hidden="true" />
      </div>
      <input
        className="picker__hue"
        type="range"
        min={0}
        max={359}
        step={1}
        aria-label="Hue"
        value={Math.round(hsv.h) % 360}
        onChange={(e) => set({ ...hsv, h: Number(e.target.value) })}
      />
      <div className="picker__hex">
        <label htmlFor={`${id}-hex`}>Hex</label>
        <input
          id={`${id}-hex`}
          className="picker__hex-input"
          value={typed ?? value}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setTyped(e.target.value)
            const hex = parseHex(e.target.value)
            if (hex && hex !== value) onChange(hex)
          }}
          onBlur={() => setTyped(null)}
        />
      </div>
    </div>
  )
}
