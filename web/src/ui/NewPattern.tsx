/**
 * "Design pattern": start from a blank grid (docs/web-port-plan.md, "Landing screen").
 * A small dialog asks for the size and the colour, then the pattern is saved and opened
 * in the Design stage.
 */
import { useId, useRef, useState } from 'react'

import { createPattern } from '../app/newProject.ts'
import { MAX_SIDE } from '../logic/edit.ts'
import type { ProjectRepo } from '../storage/repo.ts'
import { Modal } from './components.tsx'
import { cleanName, MAX_NAME_LENGTH } from './names.ts'

const NEW_DEFAULTS = { name: 'New pattern', cols: 40, rows: 40, hex: '#ffffff' } as const

function side(value: string): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= MAX_SIDE ? n : null
}

/** Asks for the size and colour, then creates the pattern and opens it in Design. */
export function NewPatternDialog({ repo, onCancel }: { repo: ProjectRepo; onCancel: () => void }) {
  const id = useId()
  const [name, setName] = useState<string>(NEW_DEFAULTS.name)
  const [cols, setCols] = useState(String(NEW_DEFAULTS.cols))
  const [rows, setRows] = useState(String(NEW_DEFAULTS.rows))
  const [hex, setHex] = useState<string>(NEW_DEFAULTS.hex)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const c = side(cols)
  const r = side(rows)
  const clean = cleanName(name)
  const valid = c !== null && r !== null && clean !== null

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await createPattern(repo, { name: clean, cols: c, rows: r, hex })
    } catch (e) {
      setError(`Couldn't create the pattern: ${String(e)}`)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New pattern"
      onClose={onCancel}
      initialFocus={first}
      className="new-pattern"
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
        className="new-pattern__form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label htmlFor={`${id}-name`}>Name</label>
        <input
          ref={first}
          id={`${id}-name`}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor={`${id}-cols`}>Columns</label>
        <input
          id={`${id}-cols`}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_SIDE}
          value={cols}
          aria-invalid={c === null}
          onChange={(e) => setCols(e.target.value)}
        />
        <label htmlFor={`${id}-rows`}>Rows</label>
        <input
          id={`${id}-rows`}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_SIDE}
          value={rows}
          aria-invalid={r === null}
          onChange={(e) => setRows(e.target.value)}
        />
        <label htmlFor={`${id}-colour`}>Colour</label>
        <input id={`${id}-colour`} type="color" value={hex} onChange={(e) => setHex(e.target.value)} />
      </form>
      <p className="muted new-pattern__note">
        {c !== null && r !== null
          ? `${c * r} stitches, ${c + 1} strings needed. You can add more colours as you go.`
          : `Columns and rows can each be 1 to ${MAX_SIDE}.`}
      </p>
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
