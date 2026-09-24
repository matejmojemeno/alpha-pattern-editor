/**
 * IndexedDB via `idb`. Two stores:
 *   projects   the `.alpha` archive as a Blob, keyed by pattern id
 *   summaries  what the Library shows per project, so it can list everything without
 *              opening every archive (the job io.list_saved_projects does on the desktop)
 *
 * Both stores are always written in one transaction, so a summary never describes an
 * archive that isn't there.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface ProjectSummary {
  id: string
  name: string
  rows: number
  cols: number
  /** 0..100 */
  progress_pct: number
  updated_at: number
  /** Preview image. Today that is source.png, as on the desktop; null when the project
   *  has none (for example, one designed from blank). */
  thumbnail: Blob | null
}

export interface AlphaDB extends DBSchema {
  projects: { key: string; value: Blob }
  summaries: { key: string; value: ProjectSummary; indexes: { 'by-updated': number } }
}

export type AlphaDatabase = IDBPDatabase<AlphaDB>

export const DB_NAME = 'alpha-pattern-editor'
const DB_VERSION = 1

export function openAlphaDb(name: string = DB_NAME): Promise<AlphaDatabase> {
  return openDB<AlphaDB>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('projects')
      const summaries = db.createObjectStore('summaries', { keyPath: 'id' })
      summaries.createIndex('by-updated', 'updated_at')
    },
  })
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
