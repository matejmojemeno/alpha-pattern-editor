/**
 * IndexedDB via `idb`. Two stores:
 *   projects   the `.alpha` archive as a Blob, keyed by pattern id
 *   summaries  what the Library shows per project, so it can list everything without
 *              opening every archive (the job io.list_saved_projects does on the desktop)
 *
 * Summaries are derived data: every field comes from the archive. ProjectRepo.open
 * rebuilds any that are missing, which is how schema changes to them are migrated.
 *
 * Both stores are always written in one transaction, so a summary never describes an
 * archive that isn't there.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type { ThumbnailKind } from './thumbnail.ts'

export interface ProjectSummary {
  id: string
  name: string
  rows: number
  cols: number
  /** 0..100 */
  progress_pct: number
  updated_at: number
  /** Preview image, at most THUMB_MAX_EDGE px on its long edge (see thumbnail.ts). */
  thumbnail: Blob
  /** 'photo': from source.png. 'cells': the pattern itself, one pixel per cell, to be
   *  scaled up without smoothing. */
  thumbnail_kind: ThumbnailKind
}

export interface AlphaDB extends DBSchema {
  projects: { key: string; value: Blob }
  summaries: { key: string; value: ProjectSummary; indexes: { 'by-updated': number } }
}

export type AlphaDatabase = IDBPDatabase<AlphaDB>

export const DB_NAME = 'alpha-pattern-editor'
/**
 * 1: projects + summaries, with the full-size source.png as the thumbnail.
 * 2: summaries hold a downscaled thumbnail and its kind. The v1 summaries store is
 *    dropped and recreated; ProjectRepo.open rebuilds its entries from the archives.
 */
export const DB_VERSION = 2

export function openAlphaDb(name: string = DB_NAME): Promise<AlphaDatabase> {
  return openDB<AlphaDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore('projects')
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains('summaries')) db.deleteObjectStore('summaries')
        const summaries = db.createObjectStore('summaries', { keyPath: 'id' })
        summaries.createIndex('by-updated', 'updated_at')
      }
    },
  })
}

/** Ids of archives that have no summary (after an upgrade, or any other mishap). */
export async function idsMissingSummaries(db: AlphaDatabase): Promise<string[]> {
  const tx = db.transaction(['projects', 'summaries'])
  const [archives, summaries] = await Promise.all([
    tx.objectStore('projects').getAllKeys(),
    tx.objectStore('summaries').getAllKeys(),
    tx.done,
  ])
  const have = new Set(summaries)
  return archives.filter((id) => !have.has(id))
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

export async function deleteProject(db: AlphaDatabase, id: string): Promise<void> {
  const tx = db.transaction(['projects', 'summaries'], 'readwrite')
  await Promise.all([tx.objectStore('projects').delete(id), tx.objectStore('summaries').delete(id), tx.done])
}
