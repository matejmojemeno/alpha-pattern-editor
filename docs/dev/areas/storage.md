# Storage

How projects are kept: `.alpha` files, stored in the browser's IndexedDB. Every `.alpha`
file the removed desktop app saved must still open. Code:
[`web/src/storage/`](../../../web/src/storage/); the test files are described in
[`fixtures/alpha/README.md`](../../../fixtures/alpha/README.md).

## After the port

- <a id="made-photo"></a>**A photo of what was made: `made.jpg`** (`storage/alpha.ts`,
  `MADE_PHOTO_ENTRY`). An optional entry, written only by the web app, stored as it comes
  (it's a JPEG, already compressed). It needs no `format_version` change: the Python
  reference (`alphareader.core.io`) opens archives by entry name and ignores it, which
  `fixtures/alpha/from-ts/built-made-photo.alpha` checks, and the desktop files have
  none. The Python would drop it on a save, but nothing saves with the Python any more.
  - `ProjectRepo.save` keeps the stored one unless it's given (`madePhoto`, null removes
    it), as for `source.png`. `setMadePhoto` changes only the photo; `copy` (Make again)
    leaves it out, since the copy hasn't been made yet.
  - **Writes to one project are queued** (`serial`), so the Work stage's autosave can't
    write back an archive read before the photo was added
    ([rule](../rules.md#serial-writes)). A test fails without the queue.
  - **The summary has `made_photo`**, added without a DB version bump or a rebuild: no
    archive had a photo before it, so a summary lacking it means none. The thumbnail is
    made from the photo (`thumbnail_kind: 'made'`), falling back to the source image or
    the cells if it can't be downscaled; the Library asks `made_photo`, not the kind,
    whether there is one.
  - The photo is re-encoded before it's stored, which drops its EXIF data, location
    included ([rule](../rules.md#made-photo)).

- <a id="groups"></a>**Projects with pieces: the `groups` store** (DB version 3, `storage/db.ts`,
  `ProjectRepo` in `storage/repo.ts`; what the Library does with it is in
  [library](library.md#projects)). A group is `{id, name, pieces: [{id, label}], created_at,
  updated_at}`: pattern ids in order, each with what it's called in the project. It lives
  only in IndexedDB, never in a `.alpha` file, so the format and the Python reference are
  unchanged and every old file opens as before.
  - **Version 3 adds the store and changes nothing else.** `tests/storage/groups.test.ts`
    builds a version 2 database as the app before it did and checks every archive and
    summary is still there. A tab still open on the old version holds the upgrade back
    until it's closed or reloaded (neither version closes its connection on
    `versionchange`); the new tab shows **Loading…** until then.
  - **A pattern is a piece of one group at most.** Every write goes through
    `storeGroup`, which strips the group's pieces from every other group, leaves out ids
    that aren't stored and repeats, and removes a group left with none.
  - **Each write reads and writes in one transaction** (`db.updateGroups`), so two quick
    edits can't each write back the other's old version
    ([rule](../rules.md#group-writes)). A test fails when the read is outside it.
  - **Deleting a pattern takes it out of its group** in the same transaction
    (`db.deleteProject`). **Ungrouping** deletes only the record. `copy` (Make again)
    doesn't put the copy in a group.
  - **Export is one `.zip`** (`storage/groupFile.ts`): `project.json` (`{format:
    "alpha-pattern-editor/project", version: 1, id, name, pieces: [{file, label}]}`) and
    each piece's `.alpha` exactly as stored, uncompressed (an `.alpha` is already a zip).
    Unzipped, it's a folder of ordinary `.alpha` files. A newer `version` is refused.
  - **Import** (`useAlphaImport`) takes each piece through the `.alpha` path, with its own
    "Already in your library" question, then `importGroup` stores the group around the
    pieces that are in the Library, kept or replaced. The same group id replaces the
    group, keeping its `created_at`, as an `.alpha` with the same id replaces a pattern.

## During the port

What each phase of the port built here, newest first. The plan each phase followed is in
[`history/web-port.md`](../history/web-port.md).

### Hardening before hosting (after Phase 2, one PR)

- The flaky `repo.test.ts` change-events test awaits each listing.

### Phase 1

- **Storage and logic** (PR #6): `.alpha` read/write compatible with the desktop in both
  directions, IndexedDB via `ProjectRepo`, and `readout.ts`/`work.ts` replaying the golden
  fixtures.
