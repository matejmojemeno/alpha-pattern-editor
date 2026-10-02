/**
 * The Work stage's Options menu, in three groups:
 *
 * - **How you work it**: the craft, the corner the first stitch is in, and whether rows go
 *   back and forth or in the round. These are saved with the pattern. Each choice with two
 *   or more named sides is a set of radio buttons, so the side not chosen is in view too:
 *   a checkbox such as "Start rows from the right" left you to work out what unticked meant.
 * - **Chart**: switches for how the chart looks, app-wide (also in Settings).
 * - **Pattern**: rename, edit in Design, export the chart as a picture, and help.
 */
import { useId, type ReactNode } from 'react'

import { helpUrl } from '../../app/help.ts'
import { CRAFTS, isCraftId, type Craft, type CraftId } from '../../craft/crafts.ts'
import type { Direction, Pattern } from '../../model/types.ts'
import type { Settings } from '../../settings/store.ts'
import { CHART_OPTIONS } from '../chartOptions.ts'
import { readingOrder } from './segments.ts'

/** The four corners, as they sit on the chart. */
const CORNERS: readonly { label: string; bottomUp: boolean; start: Direction }[] = [
  { label: 'Top left', bottomUp: false, start: 'LTR' },
  { label: 'Top right', bottomUp: false, start: 'RTL' },
  { label: 'Bottom left', bottomUp: true, start: 'LTR' },
  { label: 'Bottom right', bottomUp: true, start: 'RTL' },
]

export interface OptionsMenuProps {
  pattern: Pattern
  craft: Craft
  settings: Settings
  setSettings: (patch: Partial<Settings>) => void
  onCraft: (id: CraftId) => void
  /** Start in another corner: which row is row 1, and which way it runs. */
  onCorner: (bottomUp: boolean, start: Direction) => void
  onSameWay: (same: boolean) => void
  onRename: () => void
  /** Save the chart as a picture (render/chartPng.ts). */
  onExportPng: () => void
  onEdit: () => void
}

export function OptionsMenu(props: OptionsMenuProps) {
  const { pattern: p, craft, settings, setSettings } = props
  const id = useId()
  return (
    <div className="work__menu">
      <Group title="How you work it" note="Saved with this pattern.">
        <label className="options__field">
          Craft
          <select value={isCraftId(p.craft) ? p.craft : craft.id} onChange={(e) => props.onCraft(e.target.value as CraftId)}>
            {CRAFTS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="options__choice">
          <legend>First stitch</legend>
          <div className="choice choice--corners">
            {CORNERS.map((c) => (
              <label key={c.label} className="choice__option">
                <input
                  type="radio"
                  name={`${id}-corner`}
                  checked={p.bottom_up === c.bottomUp && p.start_direction === c.start}
                  onChange={() => props.onCorner(c.bottomUp, c.start)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="options__choice">
          <legend>Rows</legend>
          <div className="choice">
            <label className="choice__option">
              <input type="radio" name={`${id}-rows`} checked={p.alternate_direction} onChange={() => props.onSameWay(false)} />
              Back and forth
            </label>
            <label className="choice__option">
              <input type="radio" name={`${id}-rows`} checked={!p.alternate_direction} onChange={() => props.onSameWay(true)} />
              {craft.inRounds ? 'In the round' : 'All the same way'}
            </label>
          </div>
        </fieldset>
        <p className="options__summary muted" aria-live="polite">
          {readingOrder(p, craft.inRounds)}
        </p>
      </Group>

      <Group title="Chart" note="For every pattern; also in Settings.">
        {CHART_OPTIONS.filter((o) => o.key !== 'showCarries' || craft.carries).map((o) => (
          <div className="options__switch" key={o.key}>
            <input
              id={`${id}-${o.key}`}
              type="checkbox"
              role="switch"
              checked={settings[o.key]}
              aria-describedby={`${id}-${o.key}-hint`}
              onChange={(e) => setSettings({ [o.key]: e.target.checked })}
            />
            <label htmlFor={`${id}-${o.key}`}>{o.label}</label>
            <p id={`${id}-${o.key}-hint`} className="muted">
              {o.hint}
            </p>
          </div>
        ))}
      </Group>

      <Group title="Pattern">
        <div className="options__actions">
          <button type="button" className="button button--small" aria-label={`Rename “${p.name}”`} onClick={props.onRename}>
            Rename…
          </button>
          <button type="button" className="button button--small" onClick={props.onEdit}>
            Edit in Design
          </button>
          <button type="button" className="button button--small" onClick={props.onExportPng} title="The chart as a picture, with stitch numbers and where to carry yarn when they are on. No progress is shown.">
            Export PNG
          </button>
          {/* Also here, for phones, where the header has no room for its "?". */}
          <a className="button button--small" href={helpUrl('work')} target="_blank" rel="noopener noreferrer">
            Help
          </a>
        </div>
      </Group>
    </div>
  )
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="options__group" aria-labelledby={id}>
      <div className="options__head">
        <h2 id={id} className="options__title">
          {title}
        </h2>
        {note && <span className="options__note muted">{note}</span>}
      </div>
      {children}
    </section>
  )
}
