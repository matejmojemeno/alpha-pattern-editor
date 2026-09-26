/**
 * The Design stage's colours (§6.2, design_window.py's palette list): each colour with
 * its name, hex and cell count; pick the one to paint with; add, recolour, rename and
 * delete. Every change is one undo step (design/editor.ts).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { PaletteEntry } from '../../model/types.ts'
import { contrastOn } from '../../theme/contrast.ts'
import { RenameForm } from '../components.tsx'

/**
 * A native colour picker that reports only the colour chosen, on `change`. React's
 * onChange on a colour input fires on every `input` event, many times while the picker
 * is dragged, which would make each of those an undo step.
 */
function ColourInput({
  value,
  onPick,
  label,
  className,
}: {
  value: string
  onPick: (hex: string) => void
  label: string
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const pick = useRef(onPick)
  useLayoutEffect(() => {
    pick.current = onPick
  })
  useEffect(() => {
    const el = input.current!
    const onChange = () => pick.current(el.value)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])
  // Uncontrolled, so the picker can move freely; kept in step when the colour changes.
  useEffect(() => {
    if (input.current && input.current.value !== value) input.current.value = value
  }, [value])
  return <input ref={input} type="color" defaultValue={value} aria-label={label} className={className} />
}

export function ColoursPanel({
  palette,
  current,
  onSelect,
  onAdd,
  onRecolour,
  onRename,
  onDelete,
}: {
  palette: readonly PaletteEntry[]
  current: number
  onSelect: (index: number) => void
  onAdd: (hex: string) => void
  onRecolour: (index: number, hex: string) => void
  onRename: (index: number, name: string) => void
  onDelete: (index: number) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [newHex, setNewHex] = useState('#000000')
  const entry = palette[current]
  const only = palette.length <= 1
  const renameButton = useRef<HTMLButtonElement>(null)
  const wasRenaming = useRef(false)
  useEffect(() => {
    if (wasRenaming.current && !renaming) renameButton.current?.focus()
    wasRenaming.current = renaming
  }, [renaming])

  return (
    <section className="colours" aria-labelledby="colours-heading">
      <h2 id="colours-heading" className="design__heading">
        Colours
      </h2>
      <ul className="colours__list" aria-label="Palette">
        {palette.map((e, i) => (
          <li key={e.id}>
            <button
              type="button"
              className="colour"
              aria-pressed={i === current}
              aria-label={`${e.name || 'Unnamed'}, ${e.hex}, ${e.count} cell${e.count === 1 ? '' : 's'}`}
              onClick={() => onSelect(i)}
            >
              <span className="colour__swatch" style={{ background: e.hex, color: contrastOn(e.hex) }} aria-hidden="true">
                {i === current ? '✓' : ''}
              </span>
              <span className="colour__name">{e.name || 'Unnamed'}</span>
              <span className="colour__hex">{e.hex}</span>
              <span className="colour__count">{e.count}</span>
            </button>
          </li>
        ))}
      </ul>

      {entry && (
        <div className="colours__selected" aria-label="Selected colour" role="group">
          {renaming ? (
            <RenameForm
              className="rename colours__rename"
              label="Colour name"
              name={entry.name}
              onCancel={() => setRenaming(false)}
              onRename={(name) => {
                setRenaming(false)
                onRename(current, name)
              }}
            />
          ) : (
            <div className="colours__actions">
              <label className="button button--small colours__recolour">
                <ColourInput value={entry.hex} label={`Recolour “${entry.name}”`} onPick={(hex) => onRecolour(current, hex)} />
                Recolour
              </label>
              <button ref={renameButton} type="button" className="button button--small" onClick={() => setRenaming(true)}>
                Rename
              </button>
              <button
                type="button"
                className="button button--small button--danger-quiet"
                disabled={only}
                title={only ? 'A pattern needs at least one colour' : 'Its cells take the nearest remaining colour'}
                aria-label={`Delete “${entry.name}”`}
                onClick={() => onDelete(current)}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}

      <div className="colours__add">
        <ColourInput value={newHex} label="Colour to add" onPick={setNewHex} className="colours__new" />
        <button type="button" className="button button--small" onClick={() => onAdd(newHex)}>
          Add colour
        </button>
      </div>
    </section>
  )
}
