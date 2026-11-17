/** The ⋯ menu on a Library card, and on a project's header. */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { MoreIcon } from './icons.tsx'

/** One thing on a ⋯ menu: a place to go, or something to do. */
export type MenuItem = { label: string; danger?: boolean } & ({ href: string } | { onSelect: () => void })

/**
 * The ⋯ menu on a card: a menu button (Enter, Space or a click opens it, with focus on
 * the first item), arrow keys between items, Escape back to the button, and a click
 * outside or Tab closes it. Choosing an item puts focus back on ⋯ first, so a dialog the
 * item opens (Delete's) returns focus there.
 */
export function CardMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  const entries = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

  useEffect(() => {
    if (!open) return
    entries()[0]?.focus()
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const all = entries()
      const at = all.indexOf(document.activeElement as HTMLElement)
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
      all[next]?.focus()
    }
  }
  const choose = (item: MenuItem) => {
    button.current?.focus()
    setOpen(false)
    if ('onSelect' in item) item.onSelect()
  }

  return (
    <div className="card-menu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="button button--small card-menu__button"
        aria-label={`More for “${name}”`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div id={id} role="menu" className="card-menu__list" aria-label={`More for “${name}”`}>
          {items.map((item) =>
            'href' in item ? (
              <a
                key={item.label}
                role="menuitem"
                tabIndex={-1}
                className="card-menu__item"
                href={item.href}
                onClick={() => choose(item)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                role="menuitem"
                tabIndex={-1}
                type="button"
                className={`card-menu__item${item.danger ? ' card-menu__item--danger' : ''}`}
                onClick={() => choose(item)}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
