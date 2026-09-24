/** Small building blocks shared by the screens. */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

import { href, paths } from '../app/router.ts'
import type { ThumbnailKind } from '../storage/thumbnail.ts'
import { useBlobImage } from './hooks.ts'
import { formatPct, type Notice, type ReplaceQuestion } from './useAlphaImport.ts'

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

/** A button that opens a file picker for `.alpha` files. */
export function ImportButton({
  onFiles,
  disabled,
  className = 'button button--primary',
  children,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => input.current?.click()}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept=".alpha"
        multiple
        hidden
        aria-label="Choose .alpha files to import"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = '' // so choosing the same file again still fires
          onFiles(files)
        }}
      />
    </>
  )
}

export function DropOverlay({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="drop-overlay" aria-hidden="true">
      <p>Drop .alpha files to import them</p>
    </div>
  )
}

// --- dialogs ------------------------------------------------------------------------------

/**
 * A modal yes/no question. Focus starts on Cancel (the safe answer), Tab stays inside
 * the dialog, Escape cancels, and focus goes back where it was when the dialog closes.
 */
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
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Tab') {
      const buttons = [...(box.current?.querySelectorAll('button') ?? [])]
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
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
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={box}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onKeyDown={onKeyDown}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        <div id={`${id}-body`} className="dialog__body">
          {children}
        </div>
        <div className="dialog__buttons">
          <button ref={cancel} type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'button button--danger' : 'button button--primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
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
