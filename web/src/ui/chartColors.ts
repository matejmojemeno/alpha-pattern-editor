/** The page colours a chart canvas draws with (theme/tokens.css), for the Work chart
 *  and the Design canvas. */
import { useEffect, useState } from 'react'

import type { ChartColors } from '../render/chart.ts'

export function readColors(el: HTMLElement): ChartColors {
  const s = getComputedStyle(el)
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  return {
    background: v('--bg', '#ffffff'),
    text: v('--text', '#1d1d1f'),
    axis: v('--axis', '#888888'),
    accent: v('--accent', '#f0a800'),
    fontFamily: s.fontFamily || 'system-ui, sans-serif',
  }
}

export function useDarkScheme(): boolean {
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  const [dark, setDark] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const on = () => setDark(query.matches)
    query.addEventListener?.('change', on)
    return () => query.removeEventListener?.('change', on)
  }, [query])
  return dark
}
