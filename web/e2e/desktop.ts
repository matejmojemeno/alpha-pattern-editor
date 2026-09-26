/**
 * What the desktop code makes of a file (scripts/desktop_import.py): the reference the
 * import tests check the browser against.
 *
 * Needs a Python with numpy and Pillow: $PYTHON if set, else the repo's .venv, else
 * `python3`. The first call checks it can import both and fails with instructions if it
 * can't, rather than with a traceback from deep inside the script.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../..')
const VENV = resolve(ROOT, '.venv/bin/python')
const PYTHON = process.env.PYTHON ?? (existsSync(VENV) ? VENV : 'python3')

export interface DesktopPattern {
  ok: boolean
  code?: string
  rows: number
  cols: number
  cells: number[]
  palette: [hex: string, name: string, count: number][]
}

export interface DesktopProject extends DesktopPattern {
  name: string
  stage: string
  completed: number
  completed_row_ids: string[]
  current_row_id: string | null
  row_ids: string[]
  source: number[] | null
}

/**
 * A correction made on the confirm screen, in the order made (desktop_import.py applies
 * them the way confirm_window.py does):
 * - `rows=N`, `cols=N`: the spinboxes
 * - `de=X`: the colour-detail slider, as ΔE
 * - `crop=x0,y0,x1,y1`: a crop, in image pixels, which detects again
 * - `redetect`: the Re-detect button
 */
export type Correction = `rows=${number}` | `cols=${number}` | `de=${number}` | `crop=${string}` | 'redetect'

let checked = false

function checkPython(): void {
  if (checked) return
  const probe = spawnSync(PYTHON, ['-c', 'import numpy, PIL'], { encoding: 'utf-8' })
  if (probe.error || probe.status !== 0) {
    throw new Error(
      [
        `The import tests compare against the desktop code, which needs numpy and Pillow, but ${PYTHON} can't import them.`,
        'Create the repo\'s virtualenv (python3 -m venv .venv && .venv/bin/pip install -r requirements.txt, at the repo root),',
        'or set PYTHON to an interpreter that has them (in a git worktree, the main checkout\'s .venv/bin/python works).',
        (probe.error?.message ?? probe.stderr.trim().split('\n').at(-1)) || '',
      ].join('\n'),
    )
  }
  checked = true
}

function run(args: string[]): unknown {
  checkPython()
  return JSON.parse(execFileSync(PYTHON, [resolve(ROOT, 'scripts/desktop_import.py'), ...args], { encoding: 'utf-8' }))
}

/** Detect `file` as the desktop's import window does, then apply `corrections`. */
export const desktopDetect = (file: string, corrections: Correction[] = []) => run(['detect', file, ...corrections]) as DesktopPattern

/** Open a `.alpha` file as the desktop does. */
export const desktopLoad = (file: string) => run(['load', file]) as DesktopProject

/** Whether `png` is exactly what the desktop's Export PNG makes of the `.alpha` file. */
export const desktopPngMatches = (alpha: string, png: string) =>
  run(['png', alpha, png]) as { same: boolean; desktop: number[]; exported: number[] }
