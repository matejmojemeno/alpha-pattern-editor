/**
 * The Design stage's colours (§6.2, design_window.py's palette list): each colour with
 * its name, hex and cell count; pick the one to paint with; add, recolour, rename and
 * delete. Every change is one undo step (design/editor.ts). Matching colours to a yarn
 * range is the import screen's, with the yarn estimate: here the colours are the chart's.
 *
 * Clicking a colour picks it to paint with and opens its menu: its name, and a colour
 * picker whose every move shows on the chart at once. Save keeps the change as one undo
 * step, Cancel or Escape drops it. A press anywhere else on the page closes the menu and
 * keeps the change, as the platform's popovers do: a kept change is one Undo away, a
 * dropped one would be gone. The press still does what it was for, so a press on the
 * chart paints with the colour just made.
 *
 * Its × deletes a colour, as on the import screen: its cells take the nearest remaining
 * colour. "Add colour" opens the same menu for a new colour, shown at the end of the list
 * while it is chosen, starting from the colour being painted with and named after what it
 * looks like until a name is typed. A new colour left untouched is not added.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { simpleNames } from '../../importer/names.ts'
import type { PaletteEntry } from '../../model/types.ts'
import { contrastOn } from '../../theme/contrast.ts'
import { DeleteIcon } from './icons.tsx'
import { cleanName, MAX_NAME_LENGTH } from '../names.ts'
import { ColourPicker } from './ColourPicker.tsx'

/** The colour a menu is open for (its id, or NEW), and what has been changed in it. */
interface Menu {
  id: string
  hex: string | null
  name: string | null
}

const NEW = 'new'
/** The menu's narrowest, in px: room for the picker's square and Cancel and Save. */
const MIN_WIDTH = 200

export function ColoursPanel({
  palette,
  current,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
  onPreview,
}: {
  palette: readonly PaletteEntry[]
  current: number
  onSelect: (index: number) => void
  onAdd: (hex: string, name: string) => void
  onEdit: (index: number, hex: string, name: string) => void
  onDelete: (index: number) => void
  /** The colour being chosen for an entry, to show on the chart; null when none is. */
  onPreview: (preview: { id: string; hex: string } | null) => void
}) {
  const [openMenu, setMenu] = useState<Menu | null>(null)
  // An undo, or a delete, can take the colour away while its menu is open: it closes.
  const menu = openMenu && (openMenu.id === NEW || palette.some((e) => e.id === openMenu.id)) ? openMenu : null
  if (openMenu && !menu) setMenu(null)
  const only = palette.length <= 1
  const index = menu && menu.id !== NEW ? palette.findIndex((e) => e.id === menu.id) : -1
  const entry = index >= 0 ? palette[index]! : null
  // A new colour starts as the one being painted with.
  const [start, setStart] = useState('#000000')
  const hex = menu?.hex ?? entry?.hex ?? start
  const suggested = menu?.id === NEW ? simpleNames([...palette.map((e) => e.hex), hex]).at(-1)! : ''
  const name = cleanName(menu?.name ?? '') ?? entry?.name ?? suggested

  const preview = useRef(onPreview)
  useLayoutEffect(() => {
    preview.current = onPreview
  })
  const previewHex = entry && menu?.hex && menu.hex !== entry.hex ? menu.hex : null
  useEffect(() => {
    preview.current(previewHex && entry ? { id: entry.id, hex: previewHex } : null)
  }, [previewHex, entry?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => preview.current(null), [])

  const anchors = useRef(new Map<string, HTMLElement>())
  const box = useRef<HTMLDivElement>(null)

  /** Close the menu: keep the change, drop it, or (a press elsewhere) keep what was changed. */
  const live = useRef(menu)
  useLayoutEffect(() => {
    live.current = menu
  }, [menu])
  const close = (how: 'save' | 'cancel' | 'away', refocus = true) => {
    // Once only: a press elsewhere and the click after it can both ask.
    if (!menu || live.current !== menu) return
    live.current = null
    const touched = menu.hex !== null || menu.name !== null
    const keep = how === 'save' || (how === 'away' && touched)
    if (keep && menu.id === NEW) onAdd(hex, name)
    else if (keep && entry) onEdit(index, hex, name)
    setMenu(null)
    if (refocus) (anchors.current.get(menu.id === NEW ? 'add' : menu.id)?.querySelector('button') ?? null)?.focus()
  }
  const closeRef = useRef(close)
  useLayoutEffect(() => {
    closeRef.current = close
  })

  const focusMenu = useRef(false)
  const open = (id: string, byKeyboard: boolean) => {
    if (menu?.id === id) return close('away')
    if (menu) close('away', false)
    if (id === NEW) setStart(palette[current]?.hex ?? '#000000')
    setMenu({ id, hex: null, name: null })
    focusMenu.current = byKeyboard
  }

  // A press outside the menu (but not on what opened it, which toggles it) closes it,
  // keeping the change; so does Escape, dropping it, wherever the focus is.
  const openId = menu?.id ?? null
  useEffect(() => {
    if (!openId) return
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      const anchor = anchors.current.get(openId === NEW ? 'add' : openId)
      if (box.current?.contains(t) || anchor?.contains(t)) return
      closeRef.current('away', false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      closeRef.current('cancel', box.current?.contains(document.activeElement) ?? false)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [openId])

  // Under the colour, as wide as it (above it when there is no room below), so it covers
  // the panel and never the chart: a press on the chart must reach the chart. Kept in the
  // window.
  const [placed, setAt] = useState<{ id: string; left: number; top: number; width: number } | null>(null)
  const at = placed?.id === openId ? placed : null
  useLayoutEffect(() => {
    if (!openId) return
    const place = () => {
      const a = anchors.current.get(openId)
      const b = box.current
      if (!a || !b) return
      const r = a.getBoundingClientRect()
      const width = Math.max(r.width, MIN_WIDTH)
      const h = b.offsetHeight
      let top = r.bottom + 4
      if (top + h > window.innerHeight - 8 && r.top - h - 4 >= 8) top = r.top - h - 4
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
      setAt({ id: openId, left, top: Math.max(8, Math.min(top, window.innerHeight - h - 8)), width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [openId])

  // Opened from the keyboard, the focus goes into the menu, once it is placed (and so can
  // take it). Opened by a press, it stays on the colour, so the tool shortcuts still work
  // and a phone doesn't raise its keyboard for the name.
  useEffect(() => {
    if (!at || !focusMenu.current) return
    focusMenu.current = false
    box.current?.querySelector<HTMLElement>('input')?.focus()
  }, [at])

  const setAnchor = (id: string) => (el: HTMLElement | null) => {
    if (el) anchors.current.set(id, el)
    else anchors.current.delete(id)
  }

  const menuBox = menu && (menu.id === NEW || entry) && (
    <div
      ref={box}
      className="colour-menu"
      role="dialog"
      aria-label={menu.id === NEW ? 'New colour' : `Edit “${entry!.name}”`}
      style={at ? { left: at.left, top: at.top, width: at.width } : { visibility: 'hidden' }}
      onBlur={(e) => {
        // Tabbing out of the menu is leaving it, as a press elsewhere is.
        const to = e.relatedTarget as Node | null
        if (to && !e.currentTarget.contains(to)) close('away', false)
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          close('save')
        }}
      >
        <label className="colour-menu__name">
          <span>Name</span>
          <input
            value={menu.name ?? (menu.id === NEW ? suggested : entry!.name)}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => setMenu({ ...menu, name: e.target.value })}
          />
        </label>
        <ColourPicker value={hex} onChange={(h) => setMenu({ ...menu, hex: h })} />
        <div className="colour-menu__actions">
          <button type="button" className="button button--small" onClick={() => close('cancel')}>
            Cancel
          </button>
          <button type="submit" className="button button--small button--primary">
            {menu.id === NEW ? 'Add' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )

  return (
    <section className="colours" aria-labelledby="colours-heading">
      <h2 id="colours-heading" className="design__heading">
        Colours
      </h2>
      <ul className="colours__list" aria-label="Palette">
        {palette.map((e, i) => {
          const editing = menu?.id === e.id
          const shown = editing ? { hex, name } : e
          return (
            <li key={e.id} ref={setAnchor(e.id)} className="colours__entry">
              <button
                type="button"
                className="colour"
                aria-pressed={i === current}
                aria-haspopup="dialog"
                aria-expanded={editing}
                aria-label={`${shown.name || 'Unnamed'}, ${shown.hex}, ${e.count} cell${e.count === 1 ? '' : 's'}`}
                title="Paint with this colour; change its colour or name"
                onClick={(ev) => {
                  onSelect(i)
                  open(e.id, ev.detail === 0)
                }}
              >
                <span className="colour__swatch" style={{ background: shown.hex, color: contrastOn(shown.hex) }} aria-hidden="true">
                  {i === current ? '✓' : ''}
                </span>
                <span className="colour__name">{shown.name || 'Unnamed'}</span>
                <span className="colour__hex">{shown.hex}</span>
                <span className="colour__count">{e.count}</span>
              </button>
              <button
                type="button"
                className="colours__remove"
                aria-label={`Delete “${e.name}”`}
                title={only ? 'A pattern needs at least one colour' : `Delete ${e.name}: its cells take the nearest remaining colour`}
                disabled={only}
                onClick={() => onDelete(i)}
              >
                <DeleteIcon />
              </button>
              {editing && menuBox}
            </li>
          )
        })}
        {menu?.id === NEW && (
          <li ref={setAnchor(NEW)} className="colours__entry colours__entry--new" aria-hidden="true">
            <span className="colour">
              <span className="colour__swatch" style={{ background: hex }} />
              <span className="colour__name">{name}</span>
              <span className="colour__hex">{hex}</span>
              <span className="colour__count">0</span>
            </span>
          </li>
        )}
      </ul>

      <div className="colours__add" ref={setAnchor('add')}>
        <button
          type="button"
          className="button button--small"
          aria-haspopup="dialog"
          aria-expanded={menu?.id === NEW}
          onClick={(ev) => open(NEW, ev.detail === 0)}
        >
          + Add colour
        </button>
        {menu?.id === NEW && menuBox}
      </div>
    </section>
  )
}
