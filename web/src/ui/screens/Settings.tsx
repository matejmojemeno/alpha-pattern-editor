/**
 * App-wide display preferences. Anything that changes how a pattern is *read* (like
 * "start rows from the right") is saved on the pattern instead, and is set in the Work
 * stage, not here.
 */
import { useId } from 'react'

import { useSettings } from '../../app/context.ts'
import type { Settings as SettingsValues } from '../../settings/store.ts'
import { TopBar } from '../components.tsx'
import { useDocumentTitle } from '../hooks.ts'

const OPTIONS: { key: keyof SettingsValues; label: string; help: string }[] = [
  {
    key: 'emphasiseRows',
    label: 'Emphasise the rows around the current one',
    help: 'Draws the row you are working, and the rows either side of it, taller than the rest of the chart, so your place is easier to find again.',
  },
  {
    key: 'highContrast',
    label: 'High contrast',
    help: 'Light text on a near-black background, with stronger borders, across the whole app.',
  },
  {
    key: 'focusMode',
    label: 'Focus mode',
    help: 'Draws only the rows around the current one and hides the rest of the chart.',
  },
]

export function Settings() {
  useDocumentTitle('Settings')
  const [settings, set] = useSettings()
  const id = useId()
  return (
    <main className="screen settings">
      <TopBar title="Settings" />
      <form className="settings__list" onSubmit={(e) => e.preventDefault()}>
        {OPTIONS.map(({ key, label, help }) => (
          <div className="setting" key={key}>
            <input
              id={`${id}-${key}`}
              type="checkbox"
              role="switch"
              checked={settings[key]}
              aria-describedby={`${id}-${key}-help`}
              onChange={(e) => set({ [key]: e.target.checked })}
            />
            <label htmlFor={`${id}-${key}`}>{label}</label>
            <p id={`${id}-${key}-help`} className="muted">
              {help}
            </p>
          </div>
        ))}
      </form>
      <p className="muted settings__note">
        These are saved in this browser and apply to every project. Row emphasis and focus mode take effect in the
        Work stage, where they can also be changed from Options. Which side a row starts from is saved with each
        pattern instead.
      </p>
    </main>
  )
}
