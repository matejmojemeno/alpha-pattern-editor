/**
 * The project repository the UI talks to: `.alpha` archives (alpha.ts) kept in
 * IndexedDB (db.ts). It replaces the desktop's saved/ folder.
 *
 * Archives are stored exactly as a `.alpha` file, so export is a straight copy and
 * import is a validate-then-store: the bytes a user brings in are the bytes they get out.
 */
import { workStatus } from '../app/stages.ts'
import { newId } from '../logic/edit.ts'
import { emptyProgress, type Project } from '../model/types.ts'
import { alphaFileName, progressPct, readAlpha, writeAlpha, type AlphaContents, type TraceImage } from './alpha.ts'
import * as db from './db.ts'
import { makeThumbnail, type Downscaler } from './thumbnail.ts'

export type { ProjectSummary, WorkStatus } from './db.ts'

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
    const t = await makeThumbnail(pattern, contents.sourcePng, downscale, contents.madePhoto)
    thumbnail = { thumbnail: t.blob, thumbnail_kind: t.kind }
  }
  return {
    id: pattern.id,
    name: pattern.name,
    rows: pattern.rows,
    cols: pattern.cols,
    progress_pct: progressPct(pattern, progress),
    work_status: workStatus(pattern, progress),
    updated_at: pattern.updated_at,
    thumbnail: thumbnail.thumbnail,
    thumbnail_kind: thumbnail.thumbnail_kind,
    made_photo: contents.madePhoto !== null,
  }
}

/** What a save stores beside the project: bytes (or the image to trace) to store, null to
 *  drop it, or left out to keep what the stored archive has. */
export interface SaveImages {
  sourcePng?: Uint8Array | null
  madePhoto?: Uint8Array | null
  trace?: TraceImage | null
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
  /** The last write queued for each project id (see `serial`). */
  private readonly writing = new Map<string, Promise<unknown>>()

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

  /** Recreate the summary of every archive that lacks one, or whose summary lacks a
   *  field added since (keeping its thumbnail). Returns how many. An archive that no
   *  longer parses is left alone rather than deleted: it is still exportable. */
  async rebuildMissingSummaries(): Promise<number> {
    let rebuilt = 0
    const { missing, stale } = await db.idsMissingSummaries(this.db)
    const jobs: [string, db.ProjectSummary | undefined][] = [
      ...missing.map((id): [string, undefined] => [id, undefined]),
      ...stale.map((s): [string, db.ProjectSummary] => [s.id, s]),
    ]
    for (const [id, old] of jobs) {
      const blob = await db.getArchive(this.db, id)
      if (blob === undefined) continue
      try {
        await db.putSummary(this.db, await summarize(readAlpha(await bytesOf(blob)), this.opts.downscale, old))
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
   * Run the writes to one project one after another. Each write reads the stored archive
   * to keep the images it isn't given, so two at once (the Work stage's autosave and
   * adding a photo of the finished piece) could each keep the other's old version.
   */
  private serial<T>(id: string, write: () => Promise<T>): Promise<T> {
    const run = (this.writing.get(id) ?? Promise.resolve()).then(write, write)
    const settled = run.catch(() => undefined)
    this.writing.set(id, settled)
    void settled.then(() => {
      if (this.writing.get(id) === settled) this.writing.delete(id)
    })
    return run
  }

  /**
   * Save a project, stamping a fresh updated_at like io.save_project, and return the
   * saved copy (the argument is not modified). `sourcePng`, `madePhoto` and `trace`:
   * what to store, null to drop it, or omitted to keep whatever the stored archive
   * already has.
   */
  save(project: Project, opts: SaveImages = {}): Promise<Project> {
    return this.serial(project.pattern.id, () => this.write(project, opts))
  }

  private async write(project: Project, opts: SaveImages): Promise<Project> {
    let { sourcePng, madePhoto, trace } = opts
    // Kept images keep their thumbnail: re-decoding a photo on every save would be
    // wasted work. A cells thumbnail is cheap, and the cells may have changed.
    let thumbnail: db.ProjectSummary | undefined
    if (sourcePng === undefined || madePhoto === undefined || trace === undefined) {
      const existing = await db.getArchive(this.db, project.pattern.id)
      const stored = existing ? readAlpha(await bytesOf(existing)) : null
      if (sourcePng === undefined) sourcePng = stored?.sourcePng ?? null
      if (madePhoto === undefined) madePhoto = stored?.madePhoto ?? null
      if (trace === undefined) trace = stored?.trace ?? null
      if (opts.sourcePng === undefined && opts.madePhoto === undefined) {
        const summary = await db.getSummary(this.db, project.pattern.id)
        if (summary && summary.thumbnail_kind !== 'cells' && (sourcePng || madePhoto)) thumbnail = summary
      }
    }
    const { bytes, project: saved } = writeAlpha(project, { sourcePng, madePhoto, trace, now: this.clock() })
    await db.putProject(
      this.db,
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ALPHA_MIME }),
      await summarize({ project: saved, sourcePng, madePhoto, trace }, this.opts.downscale, thumbnail),
    )
    this.stored()
    return saved
  }

  /** Rename a stored project, keeping everything else about it (progress, stage,
   *  images). Returns the saved copy. */
  rename(id: string, name: string): Promise<Project> {
    return this.serial(id, async () => {
      const { project } = await this.open(id)
      return this.write({ ...project, pattern: { ...project.pattern, name } }, {})
    })
  }

  /** The stored image to trace over this project's Design chart, or null. */
  async trace(id: string): Promise<TraceImage | null> {
    return (await this.open(id)).trace
  }

  /** The stored photo of what was made from this project (made.jpg), or null. */
  async madePhoto(id: string): Promise<Uint8Array | null> {
    return (await this.open(id)).madePhoto
  }

  /**
   * Store a photo of the finished piece (an encoded JPEG; see app/madePhoto.ts), or
   * remove it with null. Everything else about the project is kept as it is stored. The
   * Library's thumbnail becomes the photo, or goes back to what it was without one.
   */
  setMadePhoto(id: string, photo: Uint8Array | null): Promise<Project> {
    return this.serial(id, async () => {
      const { project } = await this.open(id)
      return this.write(project, { madePhoto: photo })
    })
  }

  /**
   * A copy of a stored project, for making it again: a new id and `name`, no progress,
   * in the Work stage, with the same chart, settings, source image and image to trace.
   * Row ids are kept: they only need to be unique within a pattern. The original is left
   * as it was, and keeps its photo of the finished piece: the copy hasn't been made yet,
   * so has none.
   */
  async copy(id: string, name: string): Promise<Project> {
    const { project, sourcePng, trace } = await this.open(id)
    const pattern = { ...project.pattern, id: newId(), name, created_at: this.clock() }
    return this.save({ pattern, progress: emptyProgress(), stage: 'work' }, { sourcePng, madePhoto: null, trace })
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
