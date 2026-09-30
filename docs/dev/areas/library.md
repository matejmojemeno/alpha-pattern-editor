# Home screen, Library and Settings

The screens around the stages: the home screen, the Library of saved projects, and
Settings. Code: [`web/src/ui/screens/`](../../../web/src/ui/screens/) (`Landing.tsx`,
`Library.tsx`, `Settings.tsx`), [`web/src/app/`](../../../web/src/app/) (routing, saving) and
[`web/src/settings/`](../../../web/src/settings/). How projects are stored is in
[`storage.md`](storage.md).

## After the port

Newest last, as they were built.

- <a id="home-screen"></a>**Home screen** (`ui/screens/Landing.tsx`): "Import pattern" is a large dashed drop
  zone on the left (click it, drop on it or anywhere on the page, or paste), and
  **Library**, **Design pattern**, **Settings** and **Feedback** are stacked beside it;
  one column under 44rem, drop zone first. The zone highlights while a file is dragged
  over the page, and on touch screens (`hover: none` and `pointer: coarse`) says "Tap to
  choose a file" instead of drop or paste. There is no backend, so **Feedback** opens
  the public repo's GitHub "New issue" page in a new tab (needs a GitHub account).

## During the port

What each phase of the port built here, newest first. The plan each phase followed is in
[`history/web-port.md`](../history/web-port.md).

### Phase 1

- **App shell, Landing, Library, Settings** (PR #7):
  - Hash routing (`#/library`, `#/work/<id>`), so deep links survive a refresh on any
    static host without an SPA fallback rule.
  - `theme/tokens.css` (the port of `theme.py`) and `contrastOn()`.
  - The settings decision is made: **app-wide display preferences in `localStorage`**
    (`src/settings/store.ts`: row emphasis, high contrast, focus mode). Anything that
    changes how a pattern is read stays on the pattern.
  - Library card grid with Export, delete, keyboard opening, and `.alpha` import by picker
    or drop. Thumbnails are downscaled at save time (DB version 2), and
    `navigator.storage.persist()` is requested after the first save or import.
  - Playwright (`npm run test:e2e`) proves persistence across a real reload.
