/**
 * IndexedDB via `idb`. Three stores:
 *   projects   the `.alpha` archive as a Blob, keyed by pattern id
 *   summaries  what the Library shows per project, so it can list everything without
 *              opening every archive (the job io.list_saved_projects does on the desktop)
 *   groups     projects with pieces: a name and an ordered list of pattern ids, each with
 *              a label ("Front", "Sleeve"). Web-only state, never inside a `.alpha` file,
 *              so the format is unchanged (docs/dev/areas/library.md#projects).
 *
 * Summaries are derived data: every field comes from the archive. ProjectRepo.open
 * rebuilds any that are missing, which is how schema changes to them are migrated.
 *
 * Both stores are always written in one transaction, so a summary never describes an
 * archive that isn't there.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type { ThumbnailKind } from './thumbnail.ts'

/** Where a project's Library section is: no work recorded, some, or every row done. */
export type WorkStatus = 'not-started' | 'in-progress' | 'finished'

export interface ProjectSummary {
  id: string
  name: string
  rows: number
  cols: number
  /** 0..100 */
  progress_pct: number
  /** Added after v2 without a version bump: a summary lacking it is rebuilt on open,
   *  keeping its thumbnail (ProjectRepo.rebuildMissingSummaries). */
  work_status: WorkStatus
  updated_at: number
  /** Preview image, at most THUMB_MAX_EDGE px on its long edge (see thumbnail.ts). */
  thumbnail: Blob
  /** 'made': from made.jpg, the photo of the finished piece. 'photo': from source.png.
   *  'cells': the pattern itself, one pixel per cell, to be scaled up without smoothing. */
  thumbnail_kind: ThumbnailKind
  /** Whether the archive has a photo of the finished piece (made.jpg). Added after v2
   *  without a version bump or a rebuild: no archive had one before it, so a summary
   *  lacking it means false. Kept apart from `thumbnail_kind`, which falls back to the
   *  source or the cells when the photo can't be downscaled. */
  made_photo?: boolean
}

/** One pattern in a project with pieces. */
export interface GroupPiece {
  /** The pattern's id. */
  id: string
  /** What the piece is called in its project ("Front"); the pattern's name when added. */
  label: string
}

/**
 * A project with pieces: a group of ordinary patterns, each worked on its own. A pattern
 * is a piece of at most one project. Removing the project (ungrouping) never deletes a
 * pattern.
 */
export interface ProjectGroup {
  id: string
  name: string
  /** In the order they're made. */
  pieces: GroupPiece[]
  created_at: number
  /** Seconds since the epoch: the last change to the group itself (not to its pieces). */
  updated_at: number
}

export interface AlphaDB extends DBSchema {
  projects: { key: string; value: Blob }
  summaries: { key: string; value: ProjectSummary; indexes: { 'by-updated': number } }
  groups: { key: string; value: ProjectGroup }
}

export type AlphaDatabase = IDBPDatabase<AlphaDB>

export const DB_NAME = 'alpha-pattern-editor'
/**
 * 1: projects + summaries, with the full-size source.png as the thumbnail.
 * 2: summaries hold a downscaled thumbnail and its kind. The v1 summaries store is
 *    dropped and recreated; ProjectRepo.open rebuilds its entries from the archives.
 * 3: groups (projects with pieces). Nothing else changes.
 */
export const DB_VERSION = 3

export function openAlphaDb(name: string = DB_NAME): Promise<AlphaDatabase> {
  return openDB<AlphaDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore('projects')
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains('summaries')) db.deleteObjectStore('summaries')
        const summaries = db.createObjectStore('summaries', { keyPath: 'id' })
        summaries.createIndex('by-updated', 'updated_at')
      }
      if (oldVersion < 3) db.createObjectStore('groups', { keyPath: 'id' })
    },
  })
}

/** Ids of archives that have no summary (after an upgrade, or any other mishap), and
 *  of those whose summary predates a field (`stale`, to rebuild keeping its thumbnail). */
export async function idsMissingSummaries(db: AlphaDatabase): Promise<{ missing: string[]; stale: ProjectSummary[] }> {
  const tx = db.transaction(['projects', 'summaries'])
  const [archives, summaries] = await Promise.all([
    tx.objectStore('projects').getAllKeys(),
    tx.objectStore('summaries').getAll(),
    tx.done,
  ])
  const have = new Set(summaries.map((s) => s.id))
  return {
    missing: archives.filter((id) => !have.has(id)),
    stale: summaries.filter((s) => s.work_status === undefined),
  }
}

export function putSummary(db: AlphaDatabase, summary: ProjectSummary): Promise<string> {
  return db.put('summaries', summary)
}

/** Store an archive and its summary together. */
export async function putProject(db: AlphaDatabase, archive: Blob, summary: ProjectSummary): Promise<void> {
  const tx = db.transaction(['projects', 'summaries'], 'readwrite')
  await Promise.all([
    tx.objectStore('projects').put(archive, summary.id),
    tx.objectStore('summaries').put(summary),
    tx.done,
  ])
}

export function getArchive(db: AlphaDatabase, id: string): Promise<Blob | undefined> {
  return db.get('projects', id)
}

export function getSummary(db: AlphaDatabase, id: string): Promise<ProjectSummary | undefined> {
  return db.get('summaries', id)
}

/** Every summary, most recently updated first (the desktop Library's order). */
export async function listSummaries(db: AlphaDatabase): Promise<ProjectSummary[]> {
  return (await db.getAllFromIndex('summaries', 'by-updated')).reverse()
}

/** Delete a pattern, and take it out of the project it's a piece of (a project left
 *  with no pieces goes too), in one transaction. */
export async function deleteProject(db: AlphaDatabase, id: string): Promise<void> {
  const tx = db.transaction(['projects', 'summaries', 'groups'], 'readwrite')
  const groups = tx.objectStore('groups')
  const all = await groups.getAll()
  const writes: Promise<unknown>[] = [tx.objectStore('projects').delete(id), tx.objectStore('summaries').delete(id)]
  for (const g of all) {
    if (!g.pieces.some((p) => p.id === id)) continue
    const pieces = g.pieces.filter((p) => p.id !== id)
    writes.push(pieces.length ? groups.put({ ...g, pieces }) : groups.delete(g.id))
  }
  await Promise.all([...writes, tx.done])
}

export async function listGroups(db: AlphaDatabase): Promise<ProjectGroup[]> {
  return db.getAll('groups')
}

/**
 * Change the groups in one transaction: `change` gets every group and returns the ones to
 * store (new or changed) and the ids to delete. Reading and writing in one transaction
 * means two changes can never each write back the other's old list.
 */
export async function updateGroups(
  db: AlphaDatabase,
  change: (groups: ProjectGroup[]) => { put?: ProjectGroup[]; remove?: string[] },
): Promise<void> {
  const tx = db.transaction('groups', 'readwrite')
  const store = tx.objectStore('groups')
  let changes: { put?: ProjectGroup[]; remove?: string[] }
  try {
    changes = change(await store.getAll())
  } catch (e) {
    tx.abort()
    await tx.done.catch(() => {})
    throw e
  }
  const { put = [], remove = [] } = changes
  await Promise.all([...put.map((g) => store.put(g)), ...remove.map((id) => store.delete(id)), tx.done])
}
