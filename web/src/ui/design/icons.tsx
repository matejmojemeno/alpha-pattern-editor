/**
 * The Design stage's icons (see ui/icons.tsx for the rest, and why Lucide). The tools
 * are the ones every drawing program has: a dashed marquee selects, a pencil paints one
 * cell, a bucket fills, a rectangle draws one, a pipette picks a colour up. Filling a
 * row or a column shows the grid with that band inked; adding one is Lucide's
 * "insert between".
 */
import {
  BetweenHorizontalStart,
  BetweenVerticalStart,
  PaintBucket,
  Pencil,
  Pipette,
  RotateCcw,
  RotateCw,
  Square,
  SquareDashed,
  Trash2,
  TrianglesCenterlineDashedHorizontal,
  TrianglesCenterlineDashedVertical,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'

import type { Tool } from '../../design/editor.ts'
import type { Turn } from '../../design/selection.ts'

/** As in ui/icons.tsx: decorative, and sized by CSS (`.icon`). */
const ICON = { 'aria-hidden': true, focusable: false, className: 'icon' } as const

/** Lucide's grid (rows-3, columns-3), with one band filled in the accent colour: the
 *  filled band is the part that says "fill". */
function Band({ kind, ...props }: LucideProps & { kind: 'row' | 'col' }) {
  const band = kind === 'row' ? { x: 3, y: 9, width: 18, height: 6 } : { x: 9, y: 3, width: 6, height: 18 }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...ICON}
      {...props}
    >
      <rect {...band} fill="var(--accent)" stroke="none" />
      <rect x={3} y={3} width={18} height={18} rx={2} />
      {kind === 'row' ? <path d="M3 9h18M3 15h18" /> : <path d="M9 3v18M15 3v18" />}
    </svg>
  )
}

const FillRow = (props: LucideProps) => <Band kind="row" {...props} />
const FillColumn = (props: LucideProps) => <Band kind="col" {...props} />

const TOOL_ICONS: Record<Tool, LucideIcon | typeof FillRow> = {
  select: SquareDashed,
  paint: Pencil,
  fill: PaintBucket,
  rect: Square,
  eyedropper: Pipette,
  row: FillRow,
  col: FillColumn,
  addRow: BetweenHorizontalStart,
  addCol: BetweenVerticalStart,
}

export function ToolIcon({ tool }: { tool: Tool }) {
  const I = TOOL_ICONS[tool]
  return <I {...ICON} />
}

/** Mirror, flip and the two quarter turns, on the whole pattern or on a selection. */
const TURN_ICONS: Record<Turn, LucideIcon> = {
  mirror: TrianglesCenterlineDashedVertical,
  flip: TrianglesCenterlineDashedHorizontal,
  cw: RotateCw,
  ccw: RotateCcw,
}

export function TurnIcon({ turn }: { turn: Turn }) {
  const I = TURN_ICONS[turn]
  return <I {...ICON} />
}

/** Deleting a colour. (× is for closing things; a colour isn't closed, it's deleted.) */
export const DeleteIcon = (props: LucideProps) => <Trash2 {...ICON} {...props} />
