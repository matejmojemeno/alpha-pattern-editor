/**
 * The project repository the UI talks to: `.alpha` archives (alpha.ts) kept in
 * IndexedDB (db.ts). It replaces the desktop's saved/ folder.
 *
 * Archives are stored exactly as a `.alpha` file, so export is a straight copy and
 * import is a validate-then-store: the bytes a user brings in are the bytes they get out.
 */
import { workStatus } from '../app/stages.ts'
import { newId } from '../logic/edit.ts'
import { emptyProgress, type Pattern, type Project } from '../model/types.ts'
import { alphaFileName, progressPct, readAlpha, writeAlpha, type AlphaContents } from './alpha.ts'
import * as db from './db.ts'
import { groupFileName, writeGroupFile } from './groupFile.ts'
import { makeThumbnail, type Downscaler } from './thumbnail.ts'

export type { GroupPiece, ProjectGroup, ProjectSummary, WorkStatus } from './db.ts'

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
   * saved copy (the argument is not modified). `sourcePng` and `madePhoto`: bytes to
   * store, null to drop the image, or omitted to keep whatever the stored archive
   * already has.
   */
  save(project: Project, opts: { sourcePng?: Uint8Array | null; madePhoto?: Uint8Array | null } = {}): Promise<Project> {
    return this.serial(project.pattern.id, () => this.write(project, opts))
  }

  private async write(
    project: Project,
    opts: { sourcePng?: Uint8Array | null; madePhoto?: Uint8Array | null },
  ): Promise<Project> {
    let { sourcePng, madePhoto } = opts
    // Kept images keep their thumbnail: re-decoding a photo on every save would be
    // wasted work. A cells thumbnail is cheap, and the cells may have changed.
    let thumbnail: db.ProjectSummary | undefined
    if (sourcePng === undefined || madePhoto === undefined) {
      const existing = await db.getArchive(this.db, project.pattern.id)
      const stored = existing ? readAlpha(await bytesOf(existing)) : null
      if (sourcePng === undefined) sourcePng = stored?.sourcePng ?? null
      if (madePhoto === undefined) madePhoto = stored?.madePhoto ?? null
      if (opts.sourcePng === undefined && opts.madePhoto === undefined) {
        const summary = await db.getSummary(this.db, project.pattern.id)
        if (summary && summary.thumbnail_kind !== 'cells' && (sourcePng || madePhoto)) thumbnail = summary
      }
    }
    const { bytes, project: saved } = writeAlpha(project, { sourcePng, madePhoto, now: this.clock() })
    await db.putProject(
      this.db,
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ALPHA_MIME }),
      await summarize({ project: saved, sourcePng, madePhoto }, this.opts.downscale, thumbnail),
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

  /** Change a stored pattern with `edit`, keeping its progress, stage and images, as
   *  `rename` does. Returns the saved copy. */
  editPattern(id: string, edit: (p: Pattern) => Pattern): Promise<Project> {
    return this.serial(id, async () => {
      const { project } = await this.open(id)
      return this.write({ ...project, pattern: edit(project.pattern) }, {})
    })
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
   * in the Work stage, with the same chart, settings and source image. Row ids are kept:
   * they only need to be unique within a pattern. The original is left as it was, and
   * keeps its photo of the finished piece: the copy hasn't been made yet, so has none.
   */
  async copy(id: string, name: string): Promise<Project> {
    const { project, sourcePng } = await this.open(id)
    const pattern = { ...project.pattern, id: newId(), name, created_at: this.clock() }
    return this.save({ pattern, progress: emptyProgress(), stage: 'work' }, { sourcePng, madePhoto: null })
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

  /** Delete a pattern. It also leaves the project it was a piece of (db.deleteProject). */
  async delete(id: string): Promise<void> {
    await db.deleteProject(this.db, id)
    this.changed()
  }

  // --- projects with pieces (groups) ------------------------------------------------------
  //
  // A group names patterns that are stored as they always are; nothing here opens or
  // rewrites an archive. A pattern is a piece of at most one group: putting it in one
  // takes it out of any other, and a group left with no pieces is removed.

  /** Every project with pieces, in no particular order. */
  groups(): Promise<db.ProjectGroup[]> {
    return db.listGroups(this.db)
  }

  async group(id: string): Promise<db.ProjectGroup | undefined> {
    return (await this.groups()).find((g) => g.id === id)
  }

  /** The project a pattern is a piece of, if any. */
  async groupOf(patternId: string): Promise<db.ProjectGroup | undefined> {
    return (await this.groups()).find((g) => g.pieces.some((p) => p.id === patternId))
  }

  /**
   * Store `group` as given (a new one, or a changed copy of one), taking its pieces out of
   * every other group, all in one transaction. Pieces that aren't stored patterns, and
   * repeats, are left out; with none left, the group is removed instead.
   */
  private putGroup(group: db.ProjectGroup): Promise<db.ProjectGroup | undefined> {
    return this.storeGroup(() => group)
  }

  /**
   * The one way groups are written. `make` gets every stored group, inside the write
   * transaction, and returns the group to store (or throws), so two quick edits can't
   * each write back the other's old version.
   */
  private async storeGroup(make: (all: db.ProjectGroup[]) => db.ProjectGroup): Promise<db.ProjectGroup | undefined> {
    const known = new Set((await this.list()).map((s) => s.id))
    let kept: db.ProjectGroup | undefined
    await db.updateGroups(this.db, (all) => {
      const group = make(all)
      const seen = new Set<string>()
      const pieces = group.pieces.filter((p) => known.has(p.id) && !seen.has(p.id) && seen.add(p.id))
      kept = pieces.length ? { ...group, pieces } : undefined
      const put: db.ProjectGroup[] = kept ? [kept] : []
      const remove: string[] = kept ? [] : [group.id]
      for (const g of all) {
        if (g.id === group.id || !g.pieces.some((p) => seen.has(p.id))) continue
        const rest = g.pieces.filter((p) => !seen.has(p.id))
        if (rest.length) put.push({ ...g, pieces: rest, updated_at: this.clock() })
        else remove.push(g.id)
      }
      return { put, remove }
    })
    this.changed()
    return kept
  }

  /** Change a stored group with `edit`, stamping updated_at. */
  private editGroup(id: string, edit: (g: db.ProjectGroup) => db.ProjectGroup): Promise<db.ProjectGroup | undefined> {
    return this.storeGroup((all) => {
      const g = all.find((x) => x.id === id)
      if (!g) throw new GroupNotFoundError(id)
      return { ...edit(g), updated_at: this.clock() }
    })
  }

  /** A new project named `name` with these patterns as its pieces, in this order, each
   *  labelled with the pattern's name. */
  async createGroup(name: string, patternIds: readonly string[]): Promise<db.ProjectGroup> {
    const names = new Map((await this.list()).map((s) => [s.id, s.name]))
    const now = this.clock()
    const g = await this.putGroup({
      id: newId(),
      name,
      pieces: patternIds.map((id) => ({ id, label: names.get(id) ?? '' })),
      created_at: now,
      updated_at: now,
    })
    if (!g) throw new ProjectNotFoundError(patternIds[0] ?? '')
    return g
  }

  /** Add patterns to the end of a project, each labelled with its name. One already in
   *  this project stays where it is. */
  async addPieces(groupId: string, patternIds: readonly string[]): Promise<db.ProjectGroup | undefined> {
    const names = new Map((await this.list()).map((s) => [s.id, s.name]))
    return this.editGroup(groupId, (g) => ({
      ...g,
      pieces: [...g.pieces, ...patternIds.filter((id) => !g.pieces.some((p) => p.id === id)).map((id) => ({ id, label: names.get(id) ?? '' }))],
    }))
  }

  /**
   * Save `pattern` as a new pattern in the Design stage and put it at the end of a project,
   * labelled `label`. If the project has gone meanwhile (ungrouped in another tab), the
   * new pattern is deleted again rather than left in the Library unasked for, and this
   * throws GroupNotFoundError.
   */
  async addNewPiece(groupId: string, pattern: Pattern, label: string): Promise<Project> {
    if (!(await this.group(groupId))) throw new GroupNotFoundError(groupId)
    const saved = await this.save({ pattern, progress: emptyProgress(), stage: 'design' }, { sourcePng: null, madePhoto: null })
    try {
      await this.editGroup(groupId, (g) => ({ ...g, pieces: [...g.pieces, { id: saved.pattern.id, label }] }))
    } catch (e) {
      await this.delete(saved.pattern.id)
      throw e
    }
    return saved
  }

  /** Take a pattern out of its project, keeping the pattern. The last piece out removes
   *  the project. */
  removePiece(groupId: string, patternId: string): Promise<db.ProjectGroup | undefined> {
    return this.editGroup(groupId, (g) => ({ ...g, pieces: g.pieces.filter((p) => p.id !== patternId) }))
  }

  /** Move a piece to position `to` (clamped) in its project's order. */
  movePiece(groupId: string, patternId: string, to: number): Promise<db.ProjectGroup | undefined> {
    return this.editGroup(groupId, (g) => {
      const piece = g.pieces.find((p) => p.id === patternId)
      if (!piece) return g
      const rest = g.pieces.filter((p) => p.id !== patternId)
      const at = Math.max(0, Math.min(rest.length, to))
      return { ...g, pieces: [...rest.slice(0, at), piece, ...rest.slice(at)] }
    })
  }

  /** What a piece is called in its project; the pattern keeps its own name. */
  relabelPiece(groupId: string, patternId: string, label: string): Promise<db.ProjectGroup | undefined> {
    return this.editGroup(groupId, (g) => ({ ...g, pieces: g.pieces.map((p) => (p.id === patternId ? { ...p, label } : p)) }))
  }

  renameGroup(id: string, name: string): Promise<db.ProjectGroup | undefined> {
    return this.editGroup(id, (g) => ({ ...g, name }))
  }

  /** Remove a project, keeping every one of its patterns, which go back to being on
   *  their own in the Library. */
  async ungroup(id: string): Promise<void> {
    await db.updateGroups(this.db, () => ({ remove: [id] }))
    this.changed()
  }

  /** The project as one file: a zip of `project.json` and each piece's `.alpha` as
   *  stored (groupFile.ts). */
  async exportGroup(id: string): Promise<{ blob: Blob; filename: string }> {
    const g = await this.group(id)
    if (!g) throw new GroupNotFoundError(id)
    const pieces = await Promise.all(
      g.pieces.map(async (p) => {
        const { blob, filename } = await this.exportFile(p.id)
        return { label: p.label, file: filename, bytes: await bytesOf(blob) }
      }),
    )
    const bytes = writeGroupFile({ id: g.id, name: g.name, pieces }, new Date(this.clock() * 1000))
    return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ALPHA_MIME }), filename: groupFileName(g) }
  }

  /**
   * After importing a project's file piece by piece (each as an `.alpha`, so each gets
   * that path's checks and its replace question), store the project itself. The same id
   * replaces the project as it was, as an `.alpha` with the same id does. `pieces` are
   * the ids that are now stored, in the file's order, with their labels; a piece that
   * was refused or kept as it was is still in it, if it's stored.
   */
  async importGroup(group: { id: string; name: string; pieces: db.GroupPiece[] }): Promise<db.ProjectGroup | undefined> {
    const old = await this.group(group.id)
    const now = this.clock()
    return this.putGroup({ ...group, created_at: old?.created_at ?? now, updated_at: now })
  }
}

export class GroupNotFoundError extends Error {
  constructor(id: string) {
    super(`No project with pieces with id ${id}.`)
    this.name = 'GroupNotFoundError'
  }
}
