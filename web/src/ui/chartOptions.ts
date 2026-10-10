/**
 * The Work chart's display switches, worded once for both places they're set: the Work
 * stage's Options ("Chart", with the short `hint`) and the Settings screen (with `help`).
 * In the order both show them.
 */
import type { Settings } from '../settings/store.ts'

export type ChartSwitch = Extract<
  keyof Settings,
  'stitchNumbers' | 'showRowColours' | 'showCarries' | 'emphasiseRows' | 'focusMode'
>

export const CHART_OPTIONS: readonly { key: ChartSwitch; label: string; hint: string; help: string }[] = [
  {
    key: 'stitchNumbers',
    label: 'Number the stitches',
    hint: 'Counts from 1 in each block of one colour.',
    help: 'Writes on each stitch of the Work chart which one it is in its block of one colour, counted the way you work the row, so you can keep count as you go. Stitches too small to hold a number stay plain; zoom in to see them.',
  },
  {
    key: 'showRowColours',
    label: 'Show the colours in this row',
    hint: 'The list of the row’s colour blocks and their stitch counts. Off, the chart gets the room.',
    help: 'Lists the row you are working beside the chart (under it on a phone): each block of one colour, with how many stitches it is, to tick off as you go. Switch it off to give a wide chart the whole width, and count from the stitch numbers or the chart itself. Tap a stitch in the row to mark your place up to it.',
  },
  {
    key: 'showCarries',
    label: 'Show where to carry yarn',
    hint: 'Which colour to work over, and for how many stitches.',
    help: 'For tapestry crochet worked over the yarn you are not using, keeping each colour only until the next row needs it. A line through the stitches shows which colour to carry inside them, and each colour in the row says how many stitches to carry another over.',
  },
  {
    key: 'emphasiseRows',
    label: 'Enlarge the current row',
    hint: 'And the rows either side of it, so your place stands out.',
    help: 'Draws the row you are working, and the rows either side of it, taller than the rest of the chart, so your place is easier to find again.',
  },
  {
    key: 'focusMode',
    label: 'Focus mode',
    hint: 'Shows only the rows around the current one.',
    help: 'Draws only the rows around the current one, and hides the rest of the chart and the “Next” line under the colours.',
  },
]
