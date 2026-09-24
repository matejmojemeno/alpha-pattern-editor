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
import { makeThumbnail, type Downscaler } from './thumbnail.ts'

export type { ProjectSummary } from './db.ts'

/** Seconds since the epoch, like Python's time.time(). */
export type Clock = () => number

const ALPHA_MIME = 'application/zip'

export interface RepoOptions {
  /** How to shrink a large source.png for its thumbnail. Defaults to a canvas. */
  downscale?: Downscaler
  /** Called after every successful save or import, e.g. to ask the browser to keep
   *  this site's storage (navigator.storage.persist). Errors from it are ignored. */
  onStored?: () => void
}

async function bytesOf(data: Blob | Uint8Array): Promise<Uint8Array> {
  return data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer())
}

/** A project's Library summary. Pass `thumbnail` to reuse one already made. */
async function summarize(
  contents: AlphaContents,
  downscale: Downscaler | undefined,
  thumbnail?: Pick<db.ProjectSummary, 'thumbnail' | 'thumbnail_kind'>,
): Promise<db.ProjectSummary> {
  const { pattern, progress } = contents.project
  if (!thumbnail) {
    const t = await makeThumbnail(pattern, contents.sourcePng, downscale)
    thumbnail = { thumbnail: t.blob, thumbnail_kind: t.kind }
  }
  return {
    id: pattern.id,
    name: pattern.name,
    rows: pattern.rows,
    cols: pattern.cols,
    progress_pct: progressPct(pattern, progress),
    updated_at: pattern.updated_at,
    thumbnail: thumbnail.thumbnail,
    thumbnail_kind: thumbnail.thumbnail_kind,
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
  private readonly opts: RepoOptions
  private readonly listeners = new Set<() => void>()

  constructor(database: db.AlphaDatabase, clock: Clock = () => Date.now() / 1000, opts: RepoOptions = {}) {
    this.db = database
    this.clock = clock
    this.opts = opts
  }

  /** Open the database, rebuilding any missing summaries (see db.ts). */
  static async open(name?: string, clock?: Clock, opts?: RepoOptions): Promise<ProjectRepo> {
    const repo = new ProjectRepo(await db.openAlphaDb(name), clock, opts)
    await repo.rebuildMissingSummaries()
    return repo
  }

  /** Recreate the summary of every archive that lacks one. Returns how many. An archive
   *  that no longer parses is left alone rather than deleted: it is still exportable. */
  async rebuildMissingSummaries(): Promise<number> {
    let rebuilt = 0
    for (const id of await db.idsMissingSummaries(this.db)) {
      const blob = await db.getArchive(this.db, id)
      if (blob === undefined) continue
      try {
        await db.putSummary(this.db, await summarize(readAlpha(await bytesOf(blob)), this.opts.downscale))
        rebuilt++
      } catch {
        // Unreadable archive: nothing sensible to show for it.
      }
    }
    return rebuilt
  }

  private stored(): void {
    try {
      this.opts.onStored?.()
    } catch {
      // Best effort only.
    }
    this.changed()
  }

  /**
   * Be told after every save, import and delete, wherever it came from, so a screen that
   * lists projects can re-list. Returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private changed(): void {
    for (const l of [...this.listeners]) {
      try {
        l()
      } catch {
        // One listener's failure is not the repository's.
      }
    }
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
    // A kept photo keeps its thumbnail: re-decoding the photo on every save would be
    // wasted work. A cells thumbnail is cheap, and the cells may have changed.
    let thumbnail: db.ProjectSummary | undefined
    if (sourcePng === undefined) {
      const existing = await db.getArchive(this.db, project.pattern.id)
      sourcePng = existing ? readAlpha(await bytesOf(existing)).sourcePng : null
      const summary = await db.getSummary(this.db, project.pattern.id)
      if (sourcePng && summary?.thumbnail_kind === 'photo') thumbnail = summary
    }
    const { bytes, project: saved } = writeAlpha(project, { sourcePng, now: this.clock() })
    await db.putProject(
      this.db,
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ALPHA_MIME }),
      await summarize({ project: saved, sourcePng }, this.opts.downscale, thumbnail),
    )
    this.stored()
    return saved
  }

  /** Rename a stored project, keeping everything else about it (progress, stage, source
   *  image). Returns the saved copy. */
  async rename(id: string, name: string): Promise<Project> {
    const { project } = await this.open(id)
    return this.save({ ...project, pattern: { ...project.pattern, name } })
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
    const summary = await summarize(contents, this.opts.downscale)
    const replaced = (await db.getSummary(this.db, contents.project.pattern.id)) !== undefined
    await db.putProject(this.db, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ALPHA_MIME }), summary)
    this.stored()
    return { ...contents, replaced }
  }

  /** The stored archive and the filename the desktop would give it, ready to download. */
  async exportFile(id: string): Promise<{ blob: Blob; filename: string }> {
    const [blob, summary] = await Promise.all([db.getArchive(this.db, id), db.getSummary(this.db, id)])
    if (blob === undefined || summary === undefined) throw new ProjectNotFoundError(id)
    return { blob, filename: alphaFileName(summary) }
  }

  /** The Library summary for one project, or undefined if there is no such project. */
  summary(id: string): Promise<db.ProjectSummary | undefined> {
    return db.getSummary(this.db, id)
  }

  async delete(id: string): Promise<void> {
    await db.deleteProject(this.db, id)
    this.changed()
  }
}
