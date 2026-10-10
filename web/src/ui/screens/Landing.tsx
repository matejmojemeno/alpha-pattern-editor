/**
 * The first screen: a large drop zone to import a chart, with the other ways in beside
 * it (Photo to pattern, Design from scratch, Library, Settings, Help, Feedback): the two
 * ways to make a new pattern sit together. Each tile is its name alone, named so that
 * it needs no description; the drop zone keeps one line, for what it takes. Reading a
 * chart is what the app is for, so it has the drop zone, and a dropped or pasted image is
 * read as one; turning a photo into a pattern is asked for by its own tile (§5a). The desktop opened straight onto the Library; the web
 * app starts here instead (docs/dev/history/web-port.md#landing-screen).
 */
import { useCallback, useState } from 'react'

import { useRepo } from '../../app/context.ts'
import { helpUrl } from '../../app/help.ts'
import { preloadDetection } from '../../app/detection.ts'
import { href, navigate, paths } from '../../app/router.ts'
import { DropOverlay, ImportButton, Notices, ReplaceDialog } from '../components.tsx'
import { useDocumentTitle, useFileDrop, usePastedImage, useProjects } from '../hooks.ts'
import { PHOTO_TO_PATTERN } from '../../importer/picture.ts'
import { DesignIcon, FeedbackIcon, HelpIcon, ImportIcon, LibraryIcon, Logo, PhotoIcon, SettingsIcon } from '../icons.tsx'
import { DESIGN_FROM_SCRATCH, NewPatternDialog } from '../NewPattern.tsx'
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
      </header>

      <div className="home">
        <ImportButton
          className={`drop-zone${drop.over ? ' drop-zone--over' : ''}`}
          onFiles={(f) => void importFiles(f)}
          onPreload={preloadDetection}
          disabled={!repo || busy}
        >
          <ImportIcon />
          <span className="drop-zone__title">Import a chart</span>
          <span className="drop-zone__how drop-zone__how--pointer">Drop, paste or click to choose an image or .alpha file</span>
          <span className="drop-zone__how drop-zone__how--touch">Tap to choose an image or .alpha file</span>
        </ImportButton>

        <ul className="tiles">
          <li>
            <a className="tile" href={href(paths.photo)} onPointerEnter={preloadDetection} onFocus={preloadDetection}>
              <PhotoIcon />
              <span className="tile__title">{PHOTO_TO_PATTERN}</span>
            </a>
          </li>
          <li>
            <button type="button" className="tile" onClick={() => setCreating(true)} disabled={!repo}>
              <DesignIcon />
              <span className="tile__title">{DESIGN_FROM_SCRATCH}</span>
            </button>
          </li>
          <li>
            <a className="tile" href={href(paths.library)}>
              <LibraryIcon />
              <span className="tile__title">Library</span>
              {count !== null && count > 0 && (
                <span className="tile__aside">
                  <span aria-hidden="true">{count}</span>
                  <span className="visually-hidden">
                    , {count} project{count === 1 ? '' : 's'}
                  </span>
                </span>
              )}
            </a>
          </li>
          <li>
            <a className="tile" href={href(paths.settings)}>
              <SettingsIcon />
              <span className="tile__title">Settings</span>
            </a>
          </li>
          <li>
            <a className="tile" href={helpUrl('home')} target="_blank" rel="noopener noreferrer">
              <HelpIcon />
              <span className="tile__title">Help</span>
              <NewTab />
            </a>
          </li>
          <li>
            <a className="tile" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
              <FeedbackIcon />
              <span className="tile__title">Feedback</span>
              <NewTab />
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

/** Help and Feedback leave the app for a new tab: an arrow says so, and the link's name. */
function NewTab() {
  return (
    <span className="tile__aside">
      <span aria-hidden="true">↗</span>
      <span className="visually-hidden"> (opens in a new tab)</span>
    </span>
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
