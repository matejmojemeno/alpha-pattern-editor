/**
 * App-wide display preferences. Anything that changes how a pattern is *read* (like
 * "start rows from the right") is saved on the pattern instead, and is set in the Work
 * stage, not here.
 */
import { useId } from 'react'

import { APP_COMMIT, APP_VERSION } from '../../app/build.ts'
import { useSettings } from '../../app/context.ts'
import { CHANGELOG_URL, REPO_URL } from '../../app/help.ts'
import type { Settings as SettingsValues } from '../../settings/store.ts'
import { TopBar } from '../components.tsx'
import { useDocumentTitle } from '../hooks.ts'

type Switch = { [K in keyof SettingsValues]: SettingsValues[K] extends boolean ? K : never }[keyof SettingsValues]

const OPTIONS: { key: Switch; label: string; help: string }[] = [
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
  {
    key: 'showCarries',
    label: 'Show where to carry yarn',
    help: 'For tapestry crochet worked over the yarn you are not using, keeping each colour only until the next row needs it. A line through the stitches shows which colour to carry inside them, and each colour in the row says how many stitches to carry another over.',
  },
]

export function Settings() {
  useDocumentTitle('Settings')
  const [settings, set] = useSettings()
  const id = useId()
  return (
    <main className="screen settings">
      <TopBar title="Settings" help="settings" />
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
        These are saved in this browser and apply to every project. Row emphasis, focus mode and carrying take effect
        in the Work stage, where they can also be changed from Options. Which side a row starts from is saved with each
        pattern instead.
      </p>
      <About />
    </main>
  )
}

/** Which build this is, so a bug report can say which version it's about. */
function About() {
  return (
    <section className="settings__about" aria-labelledby="about-heading">
      <h2 id="about-heading">About</h2>
      <p>
        Alpha Pattern Editor, version {APP_VERSION}
        {APP_COMMIT && (
          <>
            {' '}
            (build{' '}
            <a href={`${REPO_URL}/commit/${APP_COMMIT}`} target="_blank" rel="noopener noreferrer">
              <code>{APP_COMMIT}</code>
            </a>
            )
          </>
        )}
        .
      </p>
      <p>
        <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
          What&rsquo;s new
        </a>{' '}
        lists the changes in each version. If you report a problem, say which version you are using.
      </p>
    </section>
  )
}
