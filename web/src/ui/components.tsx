/** Small building blocks shared by the screens. */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

import { href, paths } from '../app/router.ts'
import type { ThumbnailKind } from '../storage/thumbnail.ts'
import { useBlobImage } from './hooks.ts'
import { cleanName, MAX_NAME_LENGTH } from './names.ts'
import { formatPct, IMPORT_ACCEPT, type Notice, type ReplaceQuestion } from './useAlphaImport.ts'

// --- layout -----------------------------------------------------------------------------

/** The header of every screen but the landing one: a way home, and the screen's title. */
export function TopBar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      <a className="topbar__home" href={href(paths.landing)}>
        <span aria-hidden="true">←</span> Home
      </a>
      <h1 tabIndex={-1}>{title}</h1>
      {children && <div className="topbar__actions">{children}</div>}
    </header>
  )
}

export function Notices({ notices }: { notices: readonly Notice[] }) {
  // Always rendered, so screen readers announce what is added to it.
  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map((n, i) => (
        <p key={i} className={`notice notice--${n.tone}`}>
          {n.text}
        </p>
      ))}
    </div>
  )
}

export function ProgressBar({ pct }: { pct: number }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <span className="progress">
      <span className="progress__track" aria-hidden="true">
        <span className="progress__fill" style={{ width: `${v}%` }} />
      </span>
      <span className="progress__label">{v}% done</span>
    </span>
  )
}

export function Thumb({ blob, kind }: { blob: Blob; kind: ThumbnailKind }) {
  const img = useBlobImage(blob)
  return (
    <span className={`thumb thumb--${kind}`} aria-hidden="true">
      <img ref={img} alt="" draggable={false} />
    </span>
  )
}

// --- importing --------------------------------------------------------------------------

/**
 * A button that opens a file picker: by default for `.alpha` files and chart images.
 * `onPreload` runs when the pointer or focus reaches it, to start loading whatever
 * handling the files will need.
 */
export function ImportButton({
  onFiles,
  onPreload,
  disabled,
  className = 'button button--primary',
  accept = IMPORT_ACCEPT,
  multiple = true,
  label = 'Choose a pattern file or chart image to import',
  children,
}: {
  onFiles: (files: File[]) => void
  onPreload?: () => void
  disabled?: boolean
  className?: string
  accept?: string
  multiple?: boolean
  label?: string
  children: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => input.current?.click()}
        onPointerEnter={onPreload}
        onFocus={onPreload}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        aria-label={label}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = '' // so choosing the same file again still fires
          onFiles(files)
        }}
      />
    </>
  )
}

export function DropOverlay({ show, text = 'Drop a chart image or .alpha files to import them' }: { show: boolean; text?: string }) {
  if (!show) return null
  return (
    <div className="drop-overlay" aria-hidden="true">
      <p>{text}</p>
    </div>
  )
}

// --- dialogs ------------------------------------------------------------------------------

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'

/**
 * A modal dialog. Focus starts on `initialFocus` (or the first control), Tab stays inside
 * the dialog, Escape closes it, and focus goes back where it was when it closes.
 */
export function Modal({
  title,
  role = 'dialog',
  onClose,
  initialFocus,
  className,
  buttons,
  children,
}: {
  title: ReactNode
  role?: 'dialog' | 'alertdialog'
  onClose: () => void
  initialFocus?: RefObject<HTMLElement | null>
  className?: string
  /** The dialog's buttons, kept out of its description. */
  buttons?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ;(initialFocus?.current ?? box.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
    // Focus is placed once, when the dialog opens.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (el) => !(el as HTMLButtonElement).disabled,
      )
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className={className ? `dialog ${className}` : 'dialog'}
        role={role}
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onKeyDown={onKeyDown}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        <div id={`${id}-body`} className="dialog__body">
          {children}
        </div>
        {buttons && <div className="dialog__buttons">{buttons}</div>}
      </div>
    </div>
  )
}

/** A modal yes/no question. Focus starts on Cancel, the safe answer. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  return (
    <Modal
      title={title}
      role="alertdialog"
      onClose={onCancel}
      initialFocus={cancel}
      buttons={
        <>
          <button ref={cancel} type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={danger ? 'button button--danger' : 'button button--primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  )
}

/** Asked when an imported file is a project the Library already has. */
export function ReplaceDialog({ question: q }: { question: ReplaceQuestion }) {
  return (
    <ConfirmDialog
      title="Already in your library"
      confirmLabel="Replace"
      onConfirm={() => q.answer(true)}
      onCancel={() => q.answer(false)}
    >
      <p>
        “{q.name}” is already in your library, {formatPct(q.existingPct)} done. Replace it with the imported copy,{' '}
        {formatPct(q.incomingPct)} done?
      </p>
    </ConfirmDialog>
  )
}

// --- renaming -------------------------------------------------------------------------------

/**
 * An inline "rename" field: Enter or Save renames, Escape or Cancel leaves the name as it
 * was. An empty name isn't accepted.
 */
export function RenameForm({
  name,
  onRename,
  onCancel,
  className = 'rename',
}: {
  name: string
  onRename: (name: string) => void
  onCancel: () => void
  className?: string
}) {
  const id = useId()
  const [value, setValue] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const clean = cleanName(value)
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault()
        if (clean === null) return
        if (clean === name) onCancel()
        else onRename(clean)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <label htmlFor={`${id}-name`} className="visually-hidden">
        Project name
      </label>
      <input
        ref={input}
        id={`${id}-name`}
        className="rename__input"
        value={value}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="button button--small button--primary" disabled={clean === null}>
        Save
      </button>
      <button type="button" className="button button--small" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}

// --- icons ----------------------------------------------------------------------------------

/**
 * A 3×3 chart fragment with some cells inked in the accent colour: the same metaphor as
 * the desktop's tool icons (icons.py), since every screen here is about cells.
 */
export function CellsIcon({ filled }: { filled: ReadonlyArray<readonly [number, number]> }) {
  const on = new Set(filled.map(([r, c]) => r * 3 + c))
  return (
    <svg className="cells-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {Array.from({ length: 9 }, (_, i) => (
        <rect
          key={i}
          x={1 + (i % 3) * 6}
          y={1 + Math.floor(i / 3) * 6}
          width={6}
          height={6}
          fill={on.has(i) ? 'var(--accent)' : 'none'}
          stroke="currentColor"
          strokeOpacity={0.67}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ))}
    </svg>
  )
}
