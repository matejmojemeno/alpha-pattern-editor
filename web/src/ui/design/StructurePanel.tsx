/**
 * The Design stage's structural panel (§6.2, §9; design_window.py `_structural_panel`):
 * a border or a size (one section: the desktop's border and pad to size together), scale,
 * mirror, flip, rotate a quarter turn either way, and trim. Rows and columns are added
 * with the Add row and Add column tools, and deleted from the menu on their numbers
 * (screens/Design.tsx).
 *
 * The form lives in the Design screen (design/structureForm.ts), because the border
 * section drives the canvas: while it is open with something to add or remove, the
 * canvas shows it before it is applied, and dragging the pattern on the preview moves
 * it, writing the sides back here. Applying, and asking first when something would be
 * lost, is the screen's job too.
 */
import { useId, type ReactNode } from 'react'

import { MAX_BORDERED, NO_SIDES, SCALE_MAX, SCALE_MIN, scaledSize } from '../../design/structure.ts'
import {
  centred,
  endSize,
  isCentred,
  parseWhole,
  sizeText,
  typeSize,
  withSides,
  type Section,
  type StructureForm,
} from '../../design/structureForm.ts'
import { MAX_SIDE } from '../../logic/edit.ts'
import type { Pattern } from '../../model/types.ts'

export interface TransformAction {
  label: string
  title: string
  run: () => void
}

export interface StructurePanelProps {
  pattern: Pattern
  form: StructureForm
  onForm: (fn: (f: StructureForm) => StructureForm) => void
  /** The border colour the pattern has now (major_border_index). */
  borderIndex: number
  /** The border's result size, or why it can't be made; null when it changes nothing. */
  borderResult: { cols: number; rows: number } | { error: string } | null
  onBorder: () => void
  onScale: () => void
  transforms: readonly TransformAction[]
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const
const SIDE_LABEL = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' } as const

function ColourSelect({
  id,
  pattern,
  value,
  fallback,
  onChange,
}: {
  id: string
  pattern: Pattern
  value: number | null
  fallback: number
  onChange: (i: number) => void
}) {
  const i = value !== null && value < pattern.palette.length ? value : fallback
  const hex = pattern.palette[i]?.hex ?? '#ffffff'
  return (
    <span className="structure__colour">
      <span className="colour__swatch" style={{ background: hex }} aria-hidden="true" />
      <select id={id} value={i} onChange={(e) => onChange(Number(e.target.value))}>
        {pattern.palette.map((e, k) => (
          <option key={e.id} value={k}>
            {e.name || 'Unnamed'}{k === fallback ? ' (border colour)' : ''}
          </option>
        ))}
      </select>
    </span>
  )
}

function Disclosure({
  section,
  title,
  form,
  onForm,
  children,
}: {
  section: Section
  title: string
  form: StructureForm
  onForm: StructurePanelProps['onForm']
  children: ReactNode
}) {
  const id = useId()
  const open = form.open === section
  return (
    <div className="structure__section" data-open={open}>
      <h3 className="structure__title">
        <button
          type="button"
          className="structure__toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => onForm((f) => ({ ...f, open: open ? null : section }))}
        >
          <span aria-hidden="true" className="structure__chevron">
            {open ? '▾' : '▸'}
          </span>
          {title}
        </button>
      </h3>
      {open && (
        <div id={id} className="structure__body">
          {children}
        </div>
      )}
    </div>
  )
}

export function StructurePanel(props: StructurePanelProps) {
  const { pattern: p, form, onForm } = props
  const id = useId()
  const b = form.border
  const size = sizeText(b, p)
  const setSide = (side: (typeof SIDES)[number], v: string) =>
    onForm((f) => ({
      ...f,
      border: f.border.linked
        ? { ...f.border, top: v, right: v, bottom: v, left: v, size: null }
        : { ...f.border, [side]: v, size: null },
    }))
  const scaled = scaledSize(p, form.scale)
  const failed = props.borderResult !== null && 'error' in props.borderResult

  return (
    <section className="structure" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="design__heading">
        Structure
      </h2>

      <div className="structure__transforms" role="group" aria-label="Transform">
        {props.transforms.map((t) => (
          <button key={t.label} type="button" className="button button--small" title={t.title} onClick={t.run}>
            {t.label}
          </button>
        ))}
      </div>

      <Disclosure section="border" title="Border & size" form={form} onForm={onForm}>
        <p className="structure__hint muted">
          Set a size, or the cells to add on each side (negative numbers remove cells). Drag the pattern on the chart to
          move it.
        </p>
        <div className="structure__sides">
          {(['width', 'height'] as const).map((axis) => (
            <label key={axis} className="structure__field">
              <span>{axis === 'width' ? 'Width' : 'Height'}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_BORDERED}
                step={1}
                value={size[axis]}
                aria-invalid={parseWhole(size[axis]) === null || failed}
                onChange={(e) => {
                  const v = e.target.value
                  onForm((f) => typeSize(f, p, axis, v))
                }}
                onBlur={() => onForm(endSize)}
              />
            </label>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={b.linked}
            onChange={(e) => {
              const linked = e.target.checked
              onForm((f) => ({
                ...f,
                border: linked
                  ? { ...f.border, linked, right: f.border.top, bottom: f.border.top, left: f.border.top, size: null }
                  : { ...f.border, linked },
              }))
            }}
          />
          Same on every side
        </label>
        <div className="structure__sides">
          {SIDES.map((side) => (
            <label key={side} className="structure__field">
              <span>{SIDE_LABEL[side]}</span>
              <input
                type="number"
                inputMode="numeric"
                step={1}
                value={b[side]}
                aria-invalid={parseWhole(b[side]) === null}
                onChange={(e) => setSide(side, e.target.value)}
              />
            </label>
          ))}
        </div>
        {!isCentred(form) && (
          <p className="structure__hint">
            <button type="button" className="linklike" onClick={() => onForm(centred)}>
              Centre the pattern
            </button>
          </p>
        )}
        <div className="structure__field structure__field--wide">
          <label htmlFor={`${id}-border-colour`}>Colour</label>
          <ColourSelect
            id={`${id}-border-colour`}
            pattern={p}
            value={b.colour}
            fallback={props.borderIndex}
            onChange={(i) => onForm((f) => ({ ...f, border: { ...f.border, colour: i } }))}
          />
        </div>
        {props.borderResult && 'error' in props.borderResult && (
          <p className="structure__result structure__result--error" role="status">
            {props.borderResult.error}
          </p>
        )}
        <div className="structure__apply">
          <button type="button" className="button button--small button--primary" disabled={!props.borderResult || failed} onClick={props.onBorder}>
            Apply
          </button>
          <button type="button" className="button button--small" onClick={() => onForm((f) => withSides(f, NO_SIDES))}>
            Clear
          </button>
        </div>
      </Disclosure>

      <Disclosure section="scale" title="Scale" form={form} onForm={onForm}>
        <p className="structure__hint muted">Every cell becomes a block of cells; no new colours.</p>
        <div className="structure__field structure__field--wide">
          <label htmlFor={`${id}-scale`}>Factor</label>
          <select id={`${id}-scale`} value={form.scale} onChange={(e) => onForm((f) => ({ ...f, scale: Number(e.target.value) }))}>
            {Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, i) => SCALE_MIN + i).map((k) => (
              <option key={k} value={k}>
                ×{k}
              </option>
            ))}
          </select>
        </div>
        <p className="structure__result muted" role="status">
          Result: {scaled.cols} × {scaled.rows}
        </p>
        {scaled.large && (
          <p className="structure__result structure__result--warn" role="alert">
            That’s more than {MAX_SIDE} on a side, the most the import screen allows. A pattern this large is slow to edit and
            to work from.
          </p>
        )}
        <div className="structure__apply">
          <button type="button" className="button button--small button--primary" onClick={props.onScale}>
            Scale ×{form.scale}
          </button>
        </div>
      </Disclosure>
    </section>
  )
}
