/**
 * The first screen: four ways in. The desktop opened straight onto the Library; the web
 * app starts here instead (docs/web-port-plan.md, "Landing screen").
 */
import { useCallback } from 'react'

import { useRepo } from '../../app/context.ts'
import { preloadDetection } from '../../app/detection.ts'
import { PASTED_NAME } from '../../app/pendingImage.ts'
import { href, navigate, paths } from '../../app/router.ts'
import { CellsIcon, DropOverlay, ImportButton, Notices, ReplaceDialog } from '../components.tsx'
import { useDocumentTitle, useFileDrop, usePastedImage, useProjects } from '../hooks.ts'
import { openImageImport, useAlphaImport } from '../useAlphaImport.ts'

const openPasted = (file: File) => openImageImport({ file, name: PASTED_NAME })

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
  usePastedImage(openPasted)

  return (
    <main className="screen landing" {...drop.handlers}>
      <header className="landing__header">
        <CellsIcon filled={[[0, 0], [1, 1], [1, 2], [2, 0], [2, 1]]} />
        <h1 tabIndex={-1}>Alpha Pattern Editor</h1>
        <p className="muted">Follow a crochet alpha chart row by row, and keep your place.</p>
      </header>

      <ul className="tiles">
        <li>
          <ImportButton
            className="tile"
            onFiles={(f) => void importFiles(f)}
            onPreload={preloadDetection}
            disabled={!repo || busy}
          >
            <CellsIcon filled={[[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]]} />
            <span className="tile__title">Import pattern</span>
            <span className="tile__text">
              From a photo or screenshot of a chart (PNG, JPEG or WebP), or a <code>.alpha</code> file. You can also
              drop or paste one on this page.
            </span>
          </ImportButton>
        </li>
        <li>
          <button
            type="button"
            className="tile"
            aria-disabled="true"
            aria-describedby="design-later"
            onClick={(e) => e.preventDefault()}
          >
            <CellsIcon filled={[[1, 1]]} />
            <span className="tile__title">
              Design pattern <span className="badge">Coming later</span>
            </span>
            <span className="tile__text" id="design-later">
              Start from a blank grid. The Design stage isn't built yet.
            </span>
          </button>
        </li>
        <li>
          <a className="tile" href={href(paths.library)}>
            <CellsIcon filled={[[0, 0], [0, 1], [1, 0], [1, 1]]} />
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
          <a className="tile" href={href(paths.settings)}>
            <CellsIcon filled={[[1, 0], [1, 1], [1, 2]]} />
            <span className="tile__title">Settings</span>
            <span className="tile__text">Display preferences: row emphasis, high contrast, focus mode.</span>
          </a>
        </li>
      </ul>

      {state.status === 'error' && <StorageUnavailable />}
      <Notices notices={notices} />
      <DropOverlay show={drop.over} />
      {question && <ReplaceDialog question={question} />}
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
