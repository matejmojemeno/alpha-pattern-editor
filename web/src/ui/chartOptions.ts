/**
 * The Work chart's display switches, worded once for both places they're set: the Work
 * stage's Options ("Chart") and the Settings screen. In the order both show them. Each is
 * named to say what it does; a `hint` only where the name can't say enough. "Show the
 * colours in this row" is in Settings only: in the Work stage it's the panel button in
 * the header.
 */
import type { Settings } from '../settings/store.ts'

export type ChartSwitch = Extract<
  keyof Settings,
  'stitchNumbers' | 'showRowColours' | 'showCarries' | 'emphasiseRows' | 'focusMode'
>

export const CHART_OPTIONS: readonly { key: ChartSwitch; label: string; hint?: string }[] = [
  {
    key: 'stitchNumbers',
    label: 'Number the stitches',
    hint: 'Each block of one colour counts from 1, the way you work the row.',
  },
  {
    key: 'showRowColours',
    label: 'Show the colours in this row',
    hint: 'Beside the chart, to tick off as you go.',
  },
  {
    key: 'showCarries',
    label: 'Show where to carry yarn',
    hint: 'For tapestry crochet: which colour to work over, and for how many stitches.',
  },
  { key: 'emphasiseRows', label: 'Enlarge the current row' },
  { key: 'focusMode', label: 'Focus mode', hint: 'Shows only the rows around the current one.' },
]
