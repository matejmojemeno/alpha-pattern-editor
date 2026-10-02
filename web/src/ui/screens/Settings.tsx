/**
 * App-wide display preferences. Anything that changes how a pattern is *read* (like
 * which corner the first stitch is in) is saved on the pattern instead, and is set in the
 * Work stage, not here.
 */
import { useId } from 'react'

import { APP_COMMIT, APP_VERSION } from '../../app/build.ts'
import { useSettings } from '../../app/context.ts'
import { CHANGELOG_URL, REPO_URL } from '../../app/help.ts'
import { CHART_OPTIONS } from '../chartOptions.ts'
import { TopBar } from '../components.tsx'
import { useDocumentTitle } from '../hooks.ts'

export function Settings() {
  useDocumentTitle('Settings')
  const [settings, set] = useSettings()
  const id = useId()
  return (
    <main className="screen settings">
      <TopBar title="Settings" help="settings" />
      <h2 className="settings__heading">Work chart</h2>
      <form className="settings__list" onSubmit={(e) => e.preventDefault()}>
        {CHART_OPTIONS.map(({ key, label, help }) => (
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
        These are saved in this browser and apply to every project. You can also change them while you work, from
        Options in the Work stage, under Chart. Which corner you start from, and whether rows go back and forth or in
        the round, are saved with each pattern instead, under How you work it.
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
