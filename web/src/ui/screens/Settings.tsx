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
      <h2 className="settings__heading">Work chart, for every pattern</h2>
      <form className="settings__list" onSubmit={(e) => e.preventDefault()}>
        {CHART_OPTIONS.map(({ key, label, hint }) => (
          <div className="setting" key={key}>
            <input
              id={`${id}-${key}`}
              type="checkbox"
              role="switch"
              checked={settings[key]}
              aria-describedby={hint ? `${id}-${key}-help` : undefined}
              onChange={(e) => set({ [key]: e.target.checked })}
            />
            <label htmlFor={`${id}-${key}`}>{label}</label>
            {hint && (
              <p id={`${id}-${key}-help`} className="muted">
                {hint}
              </p>
            )}
          </div>
        ))}
      </form>
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
        Version {APP_VERSION}
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
        {' · '}
        <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
          What&rsquo;s new
        </a>
      </p>
    </section>
  )
}
