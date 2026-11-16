/**
 * "From another pattern": a panel in the Design stage that shows another pattern from the
 * Library, read only, to pick part of it (a shape, a rectangle or all of it) and bring it
 * into the pattern being designed. The pattern open is always the canvas; this panel is
 * only where pieces come from (design/source.ts).
 *
 * Bringing a piece in is the Select tool's paste (`onUse` gets a clip), so the colours
 * come with it and it lands floating, ready to drag, as one undo step. The other pattern
 * is never saved from here: picking in it changes nothing.
 *
 * The pattern chosen is remembered for as long as the tab is open (`remembered`), as the
 * clipboard is, so the panel opens on it again, in this pattern or the next.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { href, paths } from '../../app/router.ts'
import { clipFor, pickAll, pickShape, type Picked } from '../../design/source.ts'
import { rectBetween, rectCols, rectRows, type Clip } from '../../design/selection.ts'
import type { Pattern } from '../../model/types.ts'
import { fitCell, zoomStep, type Cell } from '../../render/design.ts'
import type { ProjectRepo, ProjectSummary } from '../../storage/repo.ts'
import { Thumb } from '../components.tsx'
import { DesignCanvas } from './DesignCanvas.tsx'

/** The pattern last chosen here, in this tab. */
let remembered: string | null = null

type Mode = 'shape' | 'rect'

type Source = { status: 'none' } | { status: 'loading'; id: string } | { status: 'ready'; pattern: Pattern } | { status: 'missing' }

export function FromPatternPanel({
  repo,
  currentId,
  target,
  from,
  onUse,
  onClose,
}: {
  repo: ProjectRepo
  /** The pattern being designed: not offered as a source. */
  currentId: string
  /** Its size, to centre what is brought in. */
  target: { rows: number; cols: number }
  /** A pattern to open first (one just imported from here). */
  from?: string
  onUse: (clip: Clip, sourceName: string) => void
  onClose: () => void
}) {
  const [chosen, setChosen] = useState<string | null>(() => {
    const id = from ?? remembered
    return id && id !== currentId ? id : null
  })
  // What opening `chosen` gave: until it matches `chosen`, it is still opening.
  const [opened, setOpened] = useState<{ id: string; pattern: Pattern | null } | null>(null)
  const source: Source = !chosen
    ? { status: 'none' }
    : opened?.id !== chosen
      ? { status: 'loading', id: chosen }
      : opened.pattern
        ? { status: 'ready', pattern: opened.pattern }
        : { status: 'missing' }
  const [list, setList] = useState<ProjectSummary[] | null>(null)

  // The Library, kept current: an import or a rename elsewhere shows here.
  useEffect(() => {
    let live = true
    const load = () =>
      void repo.list().then(
        (l) => live && setList(l),
        () => live && setList([]),
      )
    load()
    const off = repo.subscribe(load)
    return () => {
      live = false
      off()
    }
  }, [repo])

  useEffect(() => {
    if (!chosen) return
    remembered = chosen
    let live = true
    repo.open(chosen).then(
      (c) => live && setOpened({ id: chosen, pattern: c.project.pattern }),
      () => {
        if (!live) return
        if (remembered === chosen) remembered = null
        setOpened({ id: chosen, pattern: null })
      },
    )
    return () => {
      live = false
    }
  }, [repo, chosen])

  const others = useMemo(() => (list ?? []).filter((s) => s.id !== currentId), [list, currentId])

  return (
    <section className="from-pattern" aria-labelledby="source-heading">
      <div className="from-pattern__head">
        <h2 id="source-heading" className="design__heading from-pattern__title">
          From another pattern
        </h2>
        <button type="button" className="button button--small" onClick={onClose}>
          Close
        </button>
      </div>
      {source.status === 'ready' ? (
        <SourceView
          key={source.pattern.id}
          pattern={source.pattern}
          target={target}
          onUse={onUse}
          onChange={() => {
            remembered = null
            setChosen(null)
          }}
        />
      ) : source.status === 'loading' ? (
        <p className="muted">Opening…</p>
      ) : (
        <>
          {source.status === 'missing' && (
            <p className="notice notice--info" role="status">
              That pattern isn’t in your Library any more.
            </p>
          )}
          <Picker others={others} loading={list === null} currentId={currentId} onPick={setChosen} />
        </>
      )}
    </section>
  )
}

/** The Library's other patterns to choose from, and a way to import one. */
function Picker({
  others,
  loading,
  currentId,
  onPick,
}: {
  others: readonly ProjectSummary[]
  loading: boolean
  currentId: string
  onPick: (id: string) => void
}) {
  return (
    <div className="from-pattern__picker">
      <div className="from-pattern__imports">
        <a className="button button--small" href={href(paths.importInto('import', currentId))}>
          Import a chart
        </a>
        <a className="button button--small" href={href(paths.importInto('photo', currentId))}>
          Photo to pattern
        </a>
      </div>
      {loading ? (
        <p className="muted">Loading your Library…</p>
      ) : others.length === 0 ? (
        <p className="muted">No other patterns in your Library yet.</p>
      ) : (
        <ul className="from-pattern__list" aria-label="Patterns in your Library">
          {others.map((s) => (
            <li key={s.id}>
              <button type="button" className="from-pattern__item" onClick={() => onPick(s.id)}>
                <Thumb blob={s.thumbnail} kind={s.thumbnail_kind} />
                <span className="from-pattern__item-name">{s.name}</span>
                <span className="from-pattern__item-size muted">
                  {s.cols} × {s.rows}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The chosen pattern, to pick from: a shape with a click, or a rectangle with a drag. */
function SourceView({
  pattern: p,
  target,
  onUse,
  onChange,
}: {
  pattern: Pattern
  target: { rows: number; cols: number }
  onUse: (clip: Clip, sourceName: string) => void
  onChange: () => void
}) {
  const [mode, setMode] = useState<Mode>('shape')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [dragFrom, setDragFrom] = useState<Cell | null>(null)
  const [note, setNote] = useState('')
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  const [zoomed, setZoomed] = useState<number | null>(null)
  const fit = viewport ? fitCell(p.cols, p.rows, viewport.width, viewport.height) : null
  const cell = zoomed ?? fit ?? 8
  const zoom = useCallback((dir: number) => setZoomed((z) => zoomStep(z ?? fit ?? 8, dir)), [fit])

  const choose = (m: Mode) => {
    setMode(m)
    setDragFrom(null)
    setNote(m === 'shape' ? 'Click a shape to pick it.' : 'Drag across the cells to pick.')
  }

  const onDown = (c: Cell) => {
    if (mode === 'shape') {
      const s = pickShape(p, c)
      setPicked(s)
      setNote(s ? `Picked a shape, ${rectCols(s.rect)} × ${rectRows(s.rect)}.` : 'That’s the background. Click a shape to pick it.')
      return
    }
    setDragFrom(c)
    setPicked({ rect: rectBetween(c, c), clear: null })
  }
  const onMove = (c: Cell) => {
    if (mode === 'rect' && dragFrom) setPicked({ rect: rectBetween(dragFrom, c), clear: null })
  }
  const onUp = () => {
    if (mode !== 'rect' || !dragFrom) return
    setDragFrom(null)
    if (picked) setNote(`Picked ${rectCols(picked.rect)} × ${rectRows(picked.rect)} cells.`)
  }

  const use = () => {
    if (!picked) return
    onUse(clipFor(p, picked, target), p.name)
  }

  return (
    <div className="from-pattern__view">
      <div className="from-pattern__chosen">
        <span className="from-pattern__name" title={p.name}>
          {p.name}
        </span>
        <span className="muted from-pattern__size">
          {p.cols} × {p.rows}
        </span>
        <button type="button" className="button button--small" onClick={onChange}>
          Change
        </button>
      </div>
      <div className="from-pattern__modes" role="group" aria-label="Pick">
        <button type="button" className="button button--small" aria-pressed={mode === 'shape'} onClick={() => choose('shape')}>
          Shape
        </button>
        <button type="button" className="button button--small" aria-pressed={mode === 'rect'} onClick={() => choose('rect')}>
          Rectangle
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            setPicked(pickAll(p))
            setNote(`Picked all of it, ${p.cols} × ${p.rows}.`)
          }}
        >
          All
        </button>
      </div>
      <div className="from-pattern__chart">
        <DesignCanvas
          pattern={p}
          cell={cell}
          tool={mode === 'shape' ? 'object' : 'select'}
          preview={null}
          overlay={picked ? { selection: picked.rect } : null}
          onDown={onDown}
          onMove={onMove}
          onUp={onUp}
          onCancel={() => setDragFrom(null)}
          onAbort={() => {
            setDragFrom(null)
            if (mode === 'rect') setPicked(null)
          }}
          onZoom={zoom}
          onZoomTo={setZoomed}
          onViewport={setViewport}
          label={`${p.name}, ${p.cols} by ${p.rows}${picked ? `, ${rectCols(picked.rect)} by ${rectRows(picked.rect)} picked` : ''}`}
        />
      </div>
      <p className="from-pattern__note muted" role="status" aria-live="polite">
        {note || (mode === 'shape' ? 'Click a shape to pick it.' : 'Drag across the cells to pick.')}
      </p>
      <div className="from-pattern__foot">
        <div className="zoom">
          <button type="button" className="button button--small" aria-label="Zoom out" onClick={() => zoom(-1)}>
            −
          </button>
          <button type="button" className="button button--small" aria-label="Zoom in" onClick={() => zoom(1)}>
            +
          </button>
          <button type="button" className="button button--small" onClick={() => setZoomed(null)}>
            Fit
          </button>
        </div>
        <button
          type="button"
          className="button button--primary from-pattern__use"
          disabled={!picked}
          title={picked ? `Put a copy in the middle of your pattern, ready to drag` : 'Pick part of it first'}
          onClick={use}
        >
          Use in pattern
        </button>
      </div>
    </div>
  )
}
