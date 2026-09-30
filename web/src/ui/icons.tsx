/**
 * The app's icons, named for what they mean here. An icon earns its place by saying what
 * its label says, so each is the one people already know from other apps (a gear is
 * settings, a picture with an arrow is importing one), all from one set, Lucide (ISC
 * licence), so they share a stroke and a size. Only the logo is the app's own: a 3×3
 * chart fragment, the same as the favicon.
 *
 * The Design stage's own icons (its tools, the turns, deleting a colour) are in
 * design/icons.tsx, so they load with that stage rather than with the app.
 */
import { ImageUp, LibraryBig, MessageSquareText, Pencil, Settings, TriangleAlert, type LucideProps } from 'lucide-react'

/** The props every icon gets: decorative (its button or link has the words), and sized
 *  by CSS (`.icon`) rather than by the set's 24 px default. */
const ICON = { 'aria-hidden': true, focusable: false, className: 'icon' } as const

/** The home screen: import from a picture, the library, a new design, settings, feedback. */
export const ImportIcon = (props: LucideProps) => <ImageUp {...ICON} {...props} />
export const LibraryIcon = (props: LucideProps) => <LibraryBig {...ICON} {...props} />
export const DesignIcon = (props: LucideProps) => <Pencil {...ICON} {...props} />
export const SettingsIcon = (props: LucideProps) => <Settings {...ICON} {...props} />
export const FeedbackIcon = (props: LucideProps) => <MessageSquareText {...ICON} {...props} />

export const WarningIcon = (props: LucideProps) => <TriangleAlert {...ICON} {...props} />

/** The app's mark: a 3×3 chart fragment with five cells inked, as in favicon.svg. */
export function Logo() {
  const inked = new Set([0, 4, 5, 6, 7])
  return (
    <svg className="logo" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {Array.from({ length: 9 }, (_, i) => (
        <rect
          key={i}
          x={1 + (i % 3) * 6}
          y={1 + Math.floor(i / 3) * 6}
          width={6}
          height={6}
          fill={inked.has(i) ? 'var(--accent)' : 'none'}
          stroke="currentColor"
          strokeOpacity={0.67}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ))}
    </svg>
  )
}
