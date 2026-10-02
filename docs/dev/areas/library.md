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
  **Photo to pattern**, **Design pattern**, **Library**, **Settings**, **Help** and
  **Feedback** are stacked beside it, in that order: the two ways to make a new pattern
  sit together, under the drop zone's way of reading one;
  one column under 44rem, drop zone first. The zone highlights while a file is dragged
  over the page, and on touch screens (`hover: none` and `pointer: coarse`) says "Tap to
  choose a file" instead of drop or paste. There is no backend, so **Feedback** opens
  the public repo's GitHub "New issue" page in a new tab (needs a GitHub account).

- <a id="home-icons"></a>**Home-screen icons that mean something** (`ui/icons.tsx`, from Lucide): the tiles
  had the app's 3×3 grid with arbitrary cells inked (Settings a middle row, Feedback an
  L), which said nothing. Now a picture with an upward arrow (Import pattern), books on
  a shelf (Library), a pencil (Design pattern, as the Paint tool), a gear (Settings) and
  a speech bubble (Feedback). The 3×3 grid stays as the app's mark beside its name, the
  same as the favicon. The import screen's warnings have a drawn warning triangle
  instead of ⚠, which some systems show as a colour emoji.

- <a id="help-links"></a>**The app links to the guide** (`app/help.ts`, `HelpLink` in
  `ui/components.tsx`): a **Help** tile on the home screen (a question mark in a circle,
  between Settings and Feedback) opens `docs/guide/index.md`, and a small **?** at the end
  of every header (Library, Settings, Import, Design, Work) opens that screen's page.
  They open in a new tab, so the pattern on screen stays put. On a phone the Work
  header has no room for it (the pattern's name was cut to "Toa…"), so below 700 px it's
  hidden there and **Options** has a **Help** link instead, at every width. Every link is
  in `help.ts`, and `tests/docs.test.ts` checks each page and anchor exists; the guide is
  read on GitHub until it's on the website, and then only `GUIDE_BASE` changes.
- <a id="about"></a>**About, at the bottom of Settings**: the version from
  `web/package.json` (now `1.0.0`; the package is `alpha-pattern-editor`, not `web`) and
  the commit the build was made from, linked on GitHub, with **What's new** linking
  `CHANGELOG.md`. `vite.config.ts` writes both in (`src/app/build.ts`): the commit from
  Cloudflare's `WORKERS_CI_COMMIT_SHA`, or `git rev-parse HEAD` elsewhere, or none.
  The guide's screenshot build sets it empty, so `settings.png` doesn't change with
  every commit. Writing the commit into the main chunk means its hash changes on every
  deploy, which a new deploy's `index.html` asks for anyway.
- <a id="description"></a>**What the app says it's for**: the home screen's subtitle and
  `index.html`'s description are the README's sentence ("Turn a photo of a crochet alpha
  chart into a pattern you can edit and follow row by row."), and the Settings tile
  names all four preferences, carrying yarn included. `index.html` has Open Graph and
  Twitter card tags, so a shared link shows the Design screenshot: `vite.config.ts`
  copies `docs/guide/media/design.png` into the build as `/social.png` (outside
  `/assets`, so not cached for good). The tags need absolute URLs, so they name the
  production address; a custom domain means changing them.
- <a id="full-width"></a>**The Library uses the whole width**: it was capped at 72rem (1152 px)
  like every screen, while Import and Design filled the window. Now `.screen.library`
  has no cap and the card grid adds columns. The home screen and Settings keep 72rem:
  their tiles and form would only spread out.

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
