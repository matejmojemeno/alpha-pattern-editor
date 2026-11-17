/**
 * The links between a project's pieces, in its Library view (step 3 of the plan for
 * "multiple patterns"):
 *
 * - **New piece…**: a blank pattern at a size worked out from your swatch (or typed in
 *   stitches), which starts with the project's colours and is worked the way its first
 *   piece is. It's added to the project and opened in Design, where "From another
 *   pattern" lists the other pieces first.
 * - **Use the same colours in every piece…**: colours of different pieces that are the
 *   same yarn take one hex and one name (app/projectColours.ts), after showing what will
 *   change.
 *
 * Both are loaded with the Design chunk, as the project's Yarn & size is (GroupDialogs.tsx):
 * they use the yarn dialog's fields and styles.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import '../yarn.css'

import { useSettings } from '../../app/context.ts'
import {
  applyColourChanges,
  blankPiece,
  entryOf,
  projectColours,
  sameColoursPlan,
  type ColourChange,
} from '../../app/projectColours.ts'
import { navigate, paths } from '../../app/router.ts'
import { MAX_SIDE } from '../../logic/edit.ts'
import type { Pattern } from '../../model/types.ts'
import type { ProjectGroup, ProjectRepo } from '../../storage/repo.ts'
import { cmFrom, cmIn, stitchesFor } from '../../yarn/usage.ts'
import { Modal } from '../components.tsx'
import { cleanName, MAX_NAME_LENGTH } from '../names.ts'
import { swatchBorder } from '../work/segments.ts'
import { NumberField } from '../yarn/NumberField.tsx'

const POSITIVE = { value: 0, inclusive: false }

type Opened = { id: string; label: string; pattern: Pattern }[]

/** Every piece of `group`, opened, in its order. */
function usePieces(repo: ProjectRepo, group: ProjectGroup): { pieces: Opened | null; error: string | null } {
  const [pieces, setPieces] = useState<Opened | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    Promise.all(group.pieces.map(async (p) => ({ id: p.id, label: p.label, pattern: (await repo.open(p.id)).project.pattern })))
      .then((l) => live && setPieces(l))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [repo, group])
  return { pieces, error }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function Chip({ hex, className = 'project-colour__swatch' }: { hex: string; className?: string }) {
  return <span className={className} style={{ background: hex, borderColor: swatchBorder(hex) }} aria-hidden="true" />
}

/** A dialog shown while the pieces open, or when they couldn't. */
function Waiting({ title, error, onClose }: { title: string; error: string | null; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      buttons={
        <button type="button" className="button" onClick={onClose}>
          {error ? 'Close' : 'Cancel'}
        </button>
      }
    >
      <p className={error ? 'notice notice--error' : 'muted'}>{error ? `Couldn't open the pieces: ${error}` : 'Loading…'}</p>
    </Modal>
  )
}

const side = (n: number | null) => n !== null && Number.isInteger(n) && n >= 1 && n <= MAX_SIDE

/**
 * "New piece…": a name, a size (from a measurement and your swatch, or in stitches) and
 * the background, chosen from the project's colours.
 */
export function NewPieceDialog({ repo, group, onCancel }: { repo: ProjectRepo; group: ProjectGroup; onCancel: () => void }) {
  const { pieces, error } = usePieces(repo, group)
  if (!pieces) return <Waiting title="New piece" error={error} onClose={onCancel} />
  return <NewPieceForm repo={repo} group={group} pieces={pieces} onCancel={onCancel} />
}

function NewPieceForm({
  repo,
  group,
  pieces,
  onCancel,
}: {
  repo: ProjectRepo
  group: ProjectGroup
  pieces: Opened
  onCancel: () => void
}) {
  const id = useId()
  const [settings, set] = useSettings()
  const { units } = settings
  const unit = units === 'metric' ? 'cm' : 'in'
  const colours = useState(() => projectColours(pieces.map((p) => p.pattern)))[0]
  const [name, setName] = useState(`Piece ${pieces.length + 1}`)
  const [by, setBy] = useState<'size' | 'stitches'>('size')
  // What's asked for, always kept in cm (shown in the chosen units).
  const [widthCm, setWidthCm] = useState<number | null>(null)
  const [heightCm, setHeightCm] = useState<number | null>(null)
  const [cols, setCols] = useState<number | null>(40)
  const [rows, setRows] = useState<number | null>(40)
  const [background, setBackground] = useState(colours[0]?.hex ?? '#ffffff')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)

  const swatch = {
    stitches: settings.swatchStitches,
    rows: settings.swatchRows,
    widthCm: settings.swatchWidthCm,
    heightCm: settings.swatchHeightCm,
    grams: settings.swatchGrams,
  }
  const measured = swatch.widthCm !== null && swatch.heightCm !== null
  const fromSize = stitchesFor(widthCm, heightCm, swatch)
  const size = by === 'size' ? fromSize : { cols, rows }
  const clean = cleanName(name)
  const valid = clean !== null && side(size.cols) && side(size.rows)

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setFailed(null)
    try {
      const pattern = blankPiece({ name: clean, cols: size.cols!, rows: size.rows! }, colours, background, pieces[0]?.pattern ?? null)
      const saved = await repo.addNewPiece(group.id, pattern, clean)
      navigate(paths.design(saved.pattern.id))
    } catch (e) {
      setFailed(`Couldn't add the piece: ${message(e)}`)
      setBusy(false)
    }
  }

  let result: ReactNode
  if (by === 'size') {
    if (!measured) result = 'Measure your swatch to work out the stitches.'
    else if (fromSize.cols === null || fromSize.rows === null) result = 'Type the width and height you want.'
    else if (!side(fromSize.cols) || !side(fromSize.rows))
      result = `That’s ${fromSize.cols} × ${fromSize.rows} stitches; a piece can be at most ${MAX_SIDE} on a side.`
    else
      result = (
        <>
          <strong>
            {fromSize.cols} × {fromSize.rows}
          </strong>{' '}
          stitches
        </>
      )
  } else if (!side(cols) || !side(rows)) result = `Columns and rows can each be 1 to ${MAX_SIDE}.`

  return (
    <Modal
      title={`New piece for “${group.name}”`}
      onClose={onCancel}
      initialFocus={first}
      className="new-piece"
      buttons={
        <>
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" form={`${id}-form`} className="button button--primary" disabled={!valid || busy}>
            Create
          </button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        className="new-piece__form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="group-dialog__name">
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            ref={first}
            id={`${id}-name`}
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <fieldset className="new-piece__group">
          <legend>Size</legend>
          <div className="new-piece__by">
            <label>
              <input type="radio" name={`${id}-by`} checked={by === 'size'} onChange={() => setBy('size')} />
              From a measurement
            </label>
            <label>
              <input type="radio" name={`${id}-by`} checked={by === 'stitches'} onChange={() => setBy('stitches')} />
              In stitches
            </label>
          </div>
          {by === 'size' ? (
            <>
              <div className="yarn__inputs">
                <NumberField
                  label="Width"
                  unit={unit}
                  value={widthCm === null ? null : cmIn(widthCm, units)}
                  places={1}
                  min={POSITIVE}
                  onCommit={(v) => setWidthCm(v === null ? null : cmFrom(v, units))}
                />
                <NumberField
                  label="Height"
                  unit={unit}
                  value={heightCm === null ? null : cmIn(heightCm, units)}
                  places={1}
                  min={POSITIVE}
                  onCommit={(v) => setHeightCm(v === null ? null : cmFrom(v, units))}
                />
              </div>
              <p className="new-piece__swatch-title">Your swatch (the same as in Yarn &amp; size)</p>
              <div className="yarn__inputs">
                <NumberField
                  label="Stitches"
                  unit=""
                  value={swatch.stitches}
                  places={0}
                  min={POSITIVE}
                  onCommit={(v) => v !== null && set({ swatchStitches: v })}
                />
                <NumberField
                  label="Rows"
                  unit=""
                  value={swatch.rows}
                  places={0}
                  min={POSITIVE}
                  onCommit={(v) => v !== null && set({ swatchRows: v })}
                />
                <NumberField
                  label="Swatch width"
                  unit={unit}
                  value={swatch.widthCm === null ? null : cmIn(swatch.widthCm, units)}
                  places={2}
                  min={POSITIVE}
                  onCommit={(v) => set({ swatchWidthCm: v === null ? null : cmFrom(v, units) })}
                />
                <NumberField
                  label="Swatch height"
                  unit={unit}
                  value={swatch.heightCm === null ? null : cmIn(swatch.heightCm, units)}
                  places={2}
                  min={POSITIVE}
                  onCommit={(v) => set({ swatchHeightCm: v === null ? null : cmFrom(v, units) })}
                />
              </div>
            </>
          ) : (
            <div className="yarn__inputs">
              <NumberField label="Columns" unit="" value={cols} places={0} min={POSITIVE} onCommit={setCols} />
              <NumberField label="Rows" unit="" value={rows} places={0} min={POSITIVE} onCommit={setRows} />
            </div>
          )}
          {result && (
            <p className="new-piece__result" aria-live="polite">
              {result}
            </p>
          )}
        </fieldset>

        {colours.length > 1 && (
          <fieldset className="new-piece__group">
            <legend>Background</legend>
            <div className="new-piece__colours">
              {colours.map((c) => (
                <label key={c.hex} className="new-piece__colour" title={c.hex}>
                  <input type="radio" name={`${id}-bg`} checked={background === c.hex} onChange={() => setBackground(c.hex)} />
                  <Chip hex={c.hex} />
                  {c.name}
                </label>
              ))}
            </div>
            <p className="muted new-piece__note">It starts with the project’s {colours.length} colours, ready to paint with.</p>
          </fieldset>
        )}
      </form>
      {failed && (
        <p className="notice notice--error" role="alert">
          {failed}
        </p>
      )}
    </Modal>
  )
}

/**
 * "Use the same colours in every piece…": shows each colour that will change, piece by
 * piece, each ticked; Use the same colours changes the ticked ones.
 */
export function SameColoursDialog({
  repo,
  group,
  onCancel,
  onDone,
}: {
  repo: ProjectRepo
  group: ProjectGroup
  onCancel: () => void
  onDone: (colours: number, pieces: number) => void
}) {
  const { pieces, error } = usePieces(repo, group)
  if (!pieces) return <Waiting title="Same colours in every piece" error={error} onClose={onCancel} />
  return <SameColoursForm repo={repo} pieces={pieces} onCancel={onCancel} onDone={onDone} />
}

function SameColoursForm({
  repo,
  pieces,
  onCancel,
  onDone,
}: {
  repo: ProjectRepo
  pieces: Opened
  onCancel: () => void
  onDone: (colours: number, pieces: number) => void
}) {
  const id = useId()
  const plan = useState(() => sameColoursPlan(pieces.map((p) => p.pattern)))[0]
  const key = (piece: number, c: ColourChange) => `${pieces[piece]!.id} ${c.entryId}`
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(plan.flatMap((cs, i) => cs.map((c) => key(i, c)))))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const any = plan.some((cs) => cs.length)

  const submit = async () => {
    if (!ticked.size || busy) return
    setBusy(true)
    setFailed(null)
    let colours = 0
    let changed = 0
    try {
      for (const [i, p] of pieces.entries()) {
        const changes = plan[i]!.filter((c) => ticked.has(key(i, c)))
        if (!changes.length) continue
        await repo.editPattern(p.id, (pattern) => applyColourChanges(pattern, changes))
        colours += changes.length
        changed++
      }
      onDone(colours, changed)
    } catch (e) {
      setFailed(`Couldn't change every piece${changed ? ` (${changed} done)` : ''}: ${message(e)}`)
      setBusy(false)
    }
  }

  const label = (c: { hex: string; name: string }) => `${c.name || c.hex}`
  return (
    <Modal
      title="Same colours in every piece"
      onClose={onCancel}
      className="same-colours"
      buttons={
        <>
          <button type="button" className="button" onClick={onCancel}>
            {any ? 'Cancel' : 'Close'}
          </button>
          {any && (
            <button type="submit" form={`${id}-form`} className="button button--primary" disabled={!ticked.size || busy}>
              Use the same colours
            </button>
          )}
        </>
      }
    >
      {!any ? (
        <p>Every piece already uses the same colours: no two pieces have colours this close that differ.</p>
      ) : (
        <form
          id={`${id}-form`}
          className="group-dialog__form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <p className="same-colours__intro">
            These are the same yarn as in an earlier piece. Each takes that piece’s colour and name; no stitch moves.
          </p>
          {pieces.map((p, i) =>
            plan[i]!.length === 0 ? null : (
              <fieldset key={p.id} className="same-colours__piece">
                <legend>{p.label || p.pattern.name}</legend>
                {plan[i]!.map((c) => {
                  const k = key(i, c)
                  const stitches = entryOf(p.pattern, c)?.count ?? 0
                  return (
                    <label key={k} className="group-dialog__choice same-colours__change" title={`${c.from.hex} → ${c.to.hex}`}>
                      <input
                        type="checkbox"
                        checked={ticked.has(k)}
                        onChange={(e) => {
                          const next = new Set(ticked)
                          if (e.target.checked) next.add(k)
                          else next.delete(k)
                          setTicked(next)
                        }}
                      />
                      <Chip hex={c.from.hex} />
                      <span className="visually-hidden">{label(c.from)} becomes</span>
                      <span aria-hidden="true">{label(c.from)} →</span>
                      <Chip hex={c.to.hex} />
                      <span className="group-dialog__label">{label(c.to)}</span>
                      <span className="group-dialog__size">{stitches.toLocaleString('en-GB')} st</span>
                    </label>
                  )
                })}
              </fieldset>
            ),
          )}
        </form>
      )}
      {failed && (
        <p className="notice notice--error" role="alert">
          {failed}
        </p>
      )}
    </Modal>
  )
}

