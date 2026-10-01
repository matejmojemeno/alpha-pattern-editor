/**
 * The first screen: a large drop zone to import a chart, with the other ways in beside
 * it (Library, Design pattern, Settings, Help, Feedback). The desktop opened straight onto the Library; the web
 * app starts here instead (docs/dev/history/web-port.md#landing-screen).
 */
import { useCallback, useState } from 'react'

import { useRepo } from '../../app/context.ts'
import { helpUrl } from '../../app/help.ts'
import { preloadDetection } from '../../app/detection.ts'
import { href, navigate, paths } from '../../app/router.ts'
import { DropOverlay, ImportButton, Notices, ReplaceDialog } from '../components.tsx'
import { useDocumentTitle, useFileDrop, usePastedImage, useProjects } from '../hooks.ts'
import { DesignIcon, FeedbackIcon, HelpIcon, ImportIcon, LibraryIcon, Logo, SettingsIcon } from '../icons.tsx'
import { NewPatternDialog } from '../NewPattern.tsx'
import { openImageImport, useAlphaImport } from '../useAlphaImport.ts'

const openPasted = (file: File) => openImageImport({ file })

/** There is no backend to send feedback to, so it goes to the public repo's issues. */
export const FEEDBACK_URL = 'https://github.com/matejmojemeno/alpha-pattern-editor/issues/new'

export function Landing() {
  useDocumentTitle('')
  const state = useRepo()
  const repo = state.status === 'ready' ? state.repo : null
  const count = useProjects(repo)?.length ?? null

  // One project imported: open it. Several: show them in the Library.
  const onImported = useCallback(
    (ids: string[]) => navigate(ids.length === 1 ? paths.work(ids[0]!) : paths.library),
    [],
  )
  const { importFiles, notices, busy, question } = useAlphaImport(repo, onImported)
  const drop = useFileDrop((files) => void importFiles(files))
  const [creating, setCreating] = useState(false)
  usePastedImage(openPasted)

  return (
    <main className="screen landing" {...drop.handlers}>
      <header className="landing__header">
        <Logo />
        <h1 tabIndex={-1}>Alpha Pattern Editor</h1>
        <p className="muted">Turn a photo of a crochet alpha chart into a pattern you can edit and follow row by row.</p>
      </header>

      <div className="home">
        <ImportButton
          className={`drop-zone${drop.over ? ' drop-zone--over' : ''}`}
          onFiles={(f) => void importFiles(f)}
          onPreload={preloadDetection}
          disabled={!repo || busy}
        >
          <ImportIcon />
          <span className="drop-zone__title">Import pattern</span>
          <span className="drop-zone__text">
            From a photo or screenshot of a chart (PNG, JPEG or WebP), or a <code>.alpha</code> file.
          </span>
          <span className="drop-zone__how drop-zone__how--pointer">
            Drop it here, paste it, or click to choose a file.
          </span>
          <span className="drop-zone__how drop-zone__how--touch">Tap to choose a file.</span>
        </ImportButton>

        <ul className="tiles">
          <li>
            <a className="tile" href={href(paths.library)}>
              <LibraryIcon />
              <span className="tile__title">Library</span>
              <span className="tile__text">
                {count === null
                  ? 'Your saved projects.'
                  : count === 0
                    ? 'No projects yet.'
                    : `${count} project${count === 1 ? '' : 's'} saved in this browser.`}
              </span>
            </a>
          </li>
          <li>
            <button type="button" className="tile" onClick={() => setCreating(true)} disabled={!repo}>
              <DesignIcon />
              <span className="tile__title">Design pattern</span>
              <span className="tile__text">Start from a blank grid, and paint your own chart.</span>
            </button>
          </li>
          <li>
            <a className="tile" href={href(paths.settings)}>
              <SettingsIcon />
              <span className="tile__title">Settings</span>
              <span className="tile__text">Row emphasis, focus mode, high contrast, and showing where to carry yarn.</span>
            </a>
          </li>
          <li>
            <a className="tile" href={helpUrl('home')} target="_blank" rel="noopener noreferrer">
              <HelpIcon />
              <span className="tile__title">Help</span>
              <span className="tile__text">The user guide: how to import, design and follow a pattern. Opens in a new tab.</span>
            </a>
          </li>
          <li>
            <a className="tile" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
              <FeedbackIcon />
              <span className="tile__title">Feedback</span>
              <span className="tile__text">
                Report a problem or suggest an idea, on GitHub (needs a free account). Opens in a new tab.
              </span>
            </a>
          </li>
        </ul>
      </div>

      {state.status === 'error' && <StorageUnavailable />}
      <Notices notices={notices} />
      <DropOverlay show={drop.over} />
      {question && <ReplaceDialog question={question} />}
      {creating && repo && <NewPatternDialog repo={repo} onCancel={() => setCreating(false)} />}
    </main>
  )
}

export function StorageUnavailable() {
  return (
    <p className="notice notice--error" role="alert">
      This browser isn't letting the app store projects (IndexedDB is unavailable). Private browsing modes can
      do this. Try a normal window.
    </p>
  )
}
