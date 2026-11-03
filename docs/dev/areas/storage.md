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

## During the port

What each phase of the port built here, newest first. The plan each phase followed is in
[`history/web-port.md`](../history/web-port.md).

### Hardening before hosting (after Phase 2, one PR)

- The flaky `repo.test.ts` change-events test awaits each listing.

### Phase 1

- **Storage and logic** (PR #6): `.alpha` read/write compatible with the desktop in both
  directions, IndexedDB via `ProjectRepo`, and `readout.ts`/`work.ts` replaying the golden
  fixtures.
