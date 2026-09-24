/**
 * The project repository the UI talks to: `.alpha` archives (alpha.ts) kept in
 * IndexedDB (db.ts). It replaces the desktop's saved/ folder.
 *
 * Archives are stored exactly as a `.alpha` file, so export is a straight copy and
 * import is a validate-then-store: the bytes a user brings in are the bytes they get out.
 */
import type { Project } from '../model/types.ts'
import { alphaFileName, progressPct, readAlpha, writeAlpha, type AlphaContents } from './alpha.ts'
import * as db from './db.ts'

export type { ProjectSummary } from './db.ts'

/** Seconds since the epoch, like Python's time.time(). */
export type Clock = () => number

const ALPHA_MIME = 'application/zip'

async function bytesOf(data: Blob | Uint8Array): Promise<Uint8Array> {
  return data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer())
}

function summarize(contents: AlphaContents): db.ProjectSummary {
  const { pattern, progress } = contents.project
  return {
    id: pattern.id,
    name: pattern.name,
    rows: pattern.rows,
    cols: pattern.cols,
    progress_pct: progressPct(pattern, progress),
    updated_at: pattern.updated_at,
    thumbnail: contents.sourcePng ? new Blob([contents.sourcePng as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : null,
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`No saved project with id ${id}.`)
    this.name = 'ProjectNotFoundError'
  }
}

export class ProjectRepo {
  private readonly db: db.AlphaDatabase
  private readonly clock: Clock

  constructor(database: db.AlphaDatabase, clock: Clock = () => Date.now() / 1000) {
    this.db = database
    this.clock = clock
  }

  static async open(name?: string, clock?: Clock): Promise<ProjectRepo> {
    return new ProjectRepo(await db.openAlphaDb(name), clock)
  }

  close(): void {
    this.db.close()
  }

  /** Library listing, most recently updated first. Opens no archives. */
  list(): Promise<db.ProjectSummary[]> {
    return db.listSummaries(this.db)
  }

  async open(id: string): Promise<AlphaContents> {
    const blob = await db.getArchive(this.db, id)
    if (blob === undefined) throw new ProjectNotFoundError(id)
    return readAlpha(await bytesOf(blob))
  }

  /**
   * Save a project, stamping a fresh updated_at like io.save_project, and return the
   * saved copy (the argument is not modified). `sourcePng`: bytes to store, null to
   * drop the image, or omitted to keep whatever the stored archive already has.
   */
  async save(project: Project, opts: { sourcePng?: Uint8Array | null } = {}): Promise<Project> {
    let sourcePng = opts.sourcePng
    if (sourcePng === undefined) {
      const existing = await db.getArchive(this.db, project.pattern.id)
      sourcePng = existing ? readAlpha(await bytesOf(existing)).sourcePng : null
    }
    const { bytes, project: saved } = writeAlpha(project, { sourcePng, now: this.clock() })
    await db.putProject(
      this.db,
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ALPHA_MIME }),
      summarize({ project: saved, sourcePng }),
    )
    return saved
  }

  /**
   * Import an `.alpha` file (from a file picker or drop). It is validated by parsing it
   * first; a file the desktop would reject, such as a newer format, throws
   * AlphaFormatError and stores nothing. A project with the same id is replaced, as
   * saving over the same file does on the desktop; `replaced` says whether that happened.
   */
  async importFile(file: Blob | Uint8Array): Promise<AlphaContents & { replaced: boolean }> {
    const bytes = await bytesOf(file)
    const contents = readAlpha(bytes)
    const replaced = (await db.getSummary(this.db, contents.project.pattern.id)) !== undefined
    await db.putProject(this.db, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ALPHA_MIME }), summarize(contents))
    return { ...contents, replaced }
  }

  /** The stored archive and the filename the desktop would give it, ready to download. */
  async exportFile(id: string): Promise<{ blob: Blob; filename: string }> {
    const [blob, summary] = await Promise.all([db.getArchive(this.db, id), db.getSummary(this.db, id)])
    if (blob === undefined || summary === undefined) throw new ProjectNotFoundError(id)
    return { blob, filename: alphaFileName(summary) }
  }

  delete(id: string): Promise<void> {
    return db.deleteProject(this.db, id)
  }
}
