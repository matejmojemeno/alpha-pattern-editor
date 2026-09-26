/**
 * The Design stage's structural panel (§6.2, §9; design_window.py `_structural_panel`):
 * borders, pad to size, scale, mirror, flip, rotate, trim, and inserting and deleting
 * rows and columns.
 *
 * The form lives in the Design screen (design/structureForm.ts), because the border and padding
 * sections drive the canvas: while one is open with something to add or remove, the
 * canvas shows it before it is applied, and dragging the pattern on the padding preview
 * writes its offsets back here. Applying, and asking first when something would be
 * lost, is the screen's job too.
 */
import { useId, type ReactNode } from 'react'

import { SCALE_MAX, SCALE_MIN, scaledSize } from '../../design/structure.ts'
import { parseWhole, rowForNumber, type Section, type StructureForm } from '../../design/structureForm.ts'
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
  /** The border's result size, or why it can't be made. */
  borderResult: { cols: number; rows: number } | { error: string } | null
  /** Pad offsets as they stand (clamped, centred when unset), and how much is added. */
  pad: { left: number; top: number; addedCols: number; addedRows: number }
  padError: string | null
  onBorder: () => void
  onPad: () => void
  onScale: () => void
  transforms: readonly TransformAction[]
  onRow: (action: 'above' | 'below' | 'delete', row: number) => void
  onCol: (action: 'left' | 'right' | 'delete', col: number) => void
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
  const { pattern: p, form, onForm, pad } = props
  const id = useId()
  const b = form.border
  const setSide = (side: (typeof SIDES)[number], v: string) =>
    onForm((f) => ({
      ...f,
      border: f.border.linked ? { ...f.border, top: v, right: v, bottom: v, left: v } : { ...f.border, [side]: v },
    }))
  const scaled = scaledSize(p, form.scale)
  const rowN = parseWhole(form.row)
  const colN = parseWhole(form.col)
  const rowOk = rowN !== null && rowN >= 1 && rowN <= p.rows
  const colOk = colN !== null && colN >= 1 && colN <= p.cols

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

      <Disclosure section="border" title="Border" form={form} onForm={onForm}>
        <p className="structure__hint muted">Cells to add on each side; negative numbers remove cells from that side.</p>
        <label className="check">
          <input
            type="checkbox"
            checked={b.linked}
            onChange={(e) => {
              const linked = e.target.checked
              onForm((f) => ({
                ...f,
                border: linked ? { ...f.border, linked, right: f.border.top, bottom: f.border.top, left: f.border.top } : { ...f.border, linked },
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
        {props.borderResult && (
          <p className={'error' in props.borderResult ? 'structure__result structure__result--error' : 'structure__result muted'} role="status">
            {'error' in props.borderResult ? props.borderResult.error : `Result: ${props.borderResult.cols} × ${props.borderResult.rows}`}
          </p>
        )}
        <div className="structure__apply">
          <button
            type="button"
            className="button button--small button--primary"
            disabled={!props.borderResult || 'error' in props.borderResult}
            onClick={props.onBorder}
          >
            Apply border
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={() => onForm((f) => ({ ...f, border: { ...f.border, top: '0', right: '0', bottom: '0', left: '0' } }))}
          >
            Clear
          </button>
        </div>
      </Disclosure>

      <Disclosure section="pad" title="Pad to size" form={form} onForm={onForm}>
        <p className="structure__hint muted">Grow the pattern to a size; drag it on the chart to place it.</p>
        <div className="structure__sides">
          <label className="structure__field">
            <span>Width</span>
            <input
              type="number"
              inputMode="numeric"
              min={p.cols}
              max={2000}
              value={form.pad.width}
              aria-invalid={props.padError !== null}
              onChange={(e) => onForm((f) => ({ ...f, pad: { ...f.pad, width: e.target.value } }))}
            />
          </label>
          <label className="structure__field">
            <span>Height</span>
            <input
              type="number"
              inputMode="numeric"
              min={p.rows}
              max={2000}
              value={form.pad.height}
              aria-invalid={props.padError !== null}
              onChange={(e) => onForm((f) => ({ ...f, pad: { ...f.pad, height: e.target.value } }))}
            />
          </label>
          <label className="structure__field">
            <span>Left</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={pad.addedCols}
              value={pad.left}
              disabled={pad.addedCols === 0}
              onChange={(e) => {
                const v = parseWhole(e.target.value)
                if (v !== null) onForm((f) => ({ ...f, pad: { ...f.pad, left: v } }))
              }}
            />
          </label>
          <label className="structure__field">
            <span>Top</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={pad.addedRows}
              value={pad.top}
              disabled={pad.addedRows === 0}
              onChange={(e) => {
                const v = parseWhole(e.target.value)
                if (v !== null) onForm((f) => ({ ...f, pad: { ...f.pad, top: v } }))
              }}
            />
          </label>
        </div>
        <p className="structure__hint muted">
          {pad.addedCols || pad.addedRows
            ? `Adds ${pad.left} left, ${pad.addedCols - pad.left} right, ${pad.top} top, ${pad.addedRows - pad.top} bottom.`
            : 'Set a size larger than the pattern.'}{' '}
          {(pad.addedCols > 0 || pad.addedRows > 0) && (
            <button type="button" className="linklike" onClick={() => onForm((f) => ({ ...f, pad: { ...f.pad, left: null, top: null } }))}>
              Centre
            </button>
          )}
        </p>
        <div className="structure__field structure__field--wide">
          <label htmlFor={`${id}-pad-colour`}>Colour</label>
          <ColourSelect
            id={`${id}-pad-colour`}
            pattern={p}
            value={form.pad.colour}
            fallback={props.borderIndex}
            onChange={(i) => onForm((f) => ({ ...f, pad: { ...f.pad, colour: i } }))}
          />
        </div>
        {props.padError && (
          <p className="structure__result structure__result--error" role="status">
            {props.padError}
          </p>
        )}
        <div className="structure__apply">
          <button
            type="button"
            className="button button--small button--primary"
            disabled={props.padError !== null || (pad.addedCols === 0 && pad.addedRows === 0)}
            onClick={props.onPad}
          >
            Apply padding
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

      <Disclosure section="rows" title="Rows and columns" form={form} onForm={onForm}>
        <p className="structure__hint muted">Or press a row or column number on the chart.</p>
        <div className="structure__line">
          <label className="structure__field">
            <span>Row</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={p.rows}
              value={form.row}
              aria-invalid={!rowOk}
              onChange={(e) => onForm((f) => ({ ...f, row: e.target.value }))}
            />
          </label>
          <div className="structure__buttons">
            <button type="button" className="button button--small" disabled={!rowOk} onClick={() => props.onRow('above', rowForNumber(p, rowN!))}>
              Insert above
            </button>
            <button type="button" className="button button--small" disabled={!rowOk} onClick={() => props.onRow('below', rowForNumber(p, rowN!))}>
              Insert below
            </button>
            <button
              type="button"
              className="button button--small button--danger-quiet"
              disabled={!rowOk}
              onClick={() => props.onRow('delete', rowForNumber(p, rowN!))}
            >
              Delete row
            </button>
          </div>
        </div>
        <div className="structure__line">
          <label className="structure__field">
            <span>Column</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={p.cols}
              value={form.col}
              aria-invalid={!colOk}
              onChange={(e) => onForm((f) => ({ ...f, col: e.target.value }))}
            />
          </label>
          <div className="structure__buttons">
            <button type="button" className="button button--small" disabled={!colOk} onClick={() => props.onCol('left', colN! - 1)}>
              Insert left
            </button>
            <button type="button" className="button button--small" disabled={!colOk} onClick={() => props.onCol('right', colN! - 1)}>
              Insert right
            </button>
            <button
              type="button"
              className="button button--small button--danger-quiet"
              disabled={!colOk}
              onClick={() => props.onCol('delete', colN! - 1)}
            >
              Delete column
            </button>
          </div>
        </div>
        <p className="structure__hint muted">New rows and columns are the colour you’re painting with.</p>
      </Disclosure>
    </section>
  )
}
