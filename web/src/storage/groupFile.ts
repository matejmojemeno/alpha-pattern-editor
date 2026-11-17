/**
 * A project with pieces as one file, for Export and Import: a zip holding `project.json`
 * and each piece's `.alpha` archive exactly as stored. Unzipped, it is a folder of
 * ordinary `.alpha` files, each of which opens on its own; the `.alpha` format itself is
 * unchanged. The pieces are stored, not compressed again: an `.alpha` is already a zip.
 *
 *   project.json   {format: "alpha-pattern-editor/project", version: 1, id, name,
 *                   pieces: [{file, label}, …]} in the project's order
 *   <file>.alpha   one per piece, named as Export names a single pattern
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'

import { slug } from './alpha.ts'

export const GROUP_FORMAT = 'alpha-pattern-editor/project'
export const GROUP_VERSION = 1
export const GROUP_MANIFEST = 'project.json'
/** What a project's file is called on disk. */
export const GROUP_EXT = '.zip'

export class GroupFileError extends Error {
  readonly code: 'NEWER_VERSION' | 'NOT_A_PROJECT' | 'CORRUPT'
  constructor(code: GroupFileError['code'], message: string) {
    super(message)
    this.name = 'GroupFileError'
    this.code = code
  }
}

export interface GroupFilePiece {
  label: string
  /** The piece's `.alpha` file name inside the zip. */
  file: string
  bytes: Uint8Array
}

export interface GroupFileContents {
  id: string
  name: string
  pieces: GroupFilePiece[]
}

export function groupFileName(g: { name: string; id: string }): string {
  return `${slug(g.name)}-${g.id.slice(0, 6)}${GROUP_EXT}`
}

/** Whether a file looks like a project's file (by its name; its contents decide). */
export const isGroupFileName = (name: string) => /\.zip$/i.test(name)

/** Zip timestamps can't predate 1980. */
const DOS_EPOCH_MS = Date.UTC(1980, 0, 2)

export function writeGroupFile(contents: GroupFileContents, mtime: Date = new Date()): Uint8Array {
  const used = new Set<string>([GROUP_MANIFEST])
  const files: Zippable = {}
  const pieces = contents.pieces.map((p) => {
    // Two pieces can't share a name inside the zip. Export names files by name and id,
    // so this only guards against a hand-made clash.
    let file = p.file
    for (let n = 2; used.has(file); n++) file = p.file.replace(/(\.alpha)?$/i, `-${n}.alpha`)
    used.add(file)
    files[file] = [p.bytes, { level: 0 }]
    return { file, label: p.label }
  })
  const manifest = { format: GROUP_FORMAT, version: GROUP_VERSION, id: contents.id, name: contents.name, pieces }
  files[GROUP_MANIFEST] = strToU8(JSON.stringify(manifest, null, 2) + '\n')
  const when = mtime.getTime() < DOS_EPOCH_MS ? new Date(DOS_EPOCH_MS) : mtime
  return zipSync(files, { level: 6, mtime: when })
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Read a project's file. The pieces' bytes are returned as they are, not yet parsed:
 *  each is then imported as an `.alpha` file, with that path's checks and questions. */
export function readGroupFile(bytes: Uint8Array): GroupFileContents {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new GroupFileError('NOT_A_PROJECT', 'It is not a zip archive.')
  }
  const raw = files[GROUP_MANIFEST]
  if (!raw) throw new GroupFileError('NOT_A_PROJECT', 'This zip has no project.json, so it is not a project.')
  let m: unknown
  try {
    m = JSON.parse(strFromU8(raw))
  } catch {
    throw new GroupFileError('CORRUPT', 'project.json is not valid JSON.')
  }
  if (!isRecord(m) || m.format !== GROUP_FORMAT) {
    throw new GroupFileError('NOT_A_PROJECT', 'project.json is not an Alpha Pattern Editor project.')
  }
  if (typeof m.version !== 'number' || m.version > GROUP_VERSION) {
    throw new GroupFileError('NEWER_VERSION', `Project file version ${String(m.version)} is newer than this app reads.`)
  }
  if (typeof m.id !== 'string' || !m.id || typeof m.name !== 'string' || !Array.isArray(m.pieces)) {
    throw new GroupFileError('CORRUPT', 'project.json is missing its id, name or pieces.')
  }
  const pieces = (m.pieces as unknown[]).map((p, i): GroupFilePiece => {
    if (!isRecord(p) || typeof p.file !== 'string' || typeof p.label !== 'string') {
      throw new GroupFileError('CORRUPT', `Piece ${i + 1} in project.json has no file or label.`)
    }
    const data = files[p.file]
    if (!data) throw new GroupFileError('CORRUPT', `The piece “${p.label}” (${p.file}) is missing from the zip.`)
    return { label: p.label, file: p.file, bytes: data }
  })
  return { id: m.id, name: m.name, pieces }
}
