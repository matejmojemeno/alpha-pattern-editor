# Documentation plan: from work in progress to product

Alpha Pattern Editor started as a desktop experiment and became a hosted web app. Its
documentation still reads like the experiment: the README describes the desktop app, the
product spec (`plan.md`) is a build brief for a PySide6 app, `docs/web-port-plan.md` is
part plan, part rulebook, part changelog, and there is no documentation for the people
who use the app.

This plan turns that into documentation for a product that keeps changing. It covers
where each kind of document lives, how every existing file moves, what else in the repo
and on GitHub needs to change, and the rules and tooling that keep all of it true as the
app keeps being developed. The work is split into small PRs (below), each one reviewable
on its own.

When this plan is done, delete this file; `CONTRIBUTING.md` and `docs/README.md` carry
its rules from then on.

## Goals

1. **Someone who lands on the GitHub repo understands the product in ten seconds:** what
   it does, what it looks like, and the link to open it.
2. **Someone using the app can find out how to do something** without reading code or
   the spec: a user guide, one page per screen, written in the crocheter's words.
3. **Someone developing the app finds the rules and the reasons** without scrolling
   through a year of history.
4. **Updating the docs is part of every change, and cheap:** screenshots regenerate from
   a script, tests catch broken links and stale references, and each change touches only
   the page for the screen it changed.

## Principles that make it easy to keep up to date

These are the choices the rest of the plan follows from.

- **Three audiences, three places, never mixed.**

  | Audience | Question | Where | Tense |
  |---|---|---|---|
  | People using the app | "How do I…?" | `docs/guide/` | the present: how it works *now* |
  | People developing it | "Why is it like this, and what mustn't I break?" | `docs/dev/`, `CONTRIBUTING.md` | the present, with reasons |
  | Everyone | "What changed?" | `CHANGELOG.md`, git history, PRs | the past |

  Today `docs/web-port-plan.md` mixes all three, which is why it grows with every PR and
  why its older entries go stale ("since PR #27, before that…"). The guide never tells
  history; history goes to the changelog.

- **One page per screen, so a change touches one page.** The guide mirrors the app's
  screens (Import, Design, Work, Library, Settings) plus the dialogs big enough to need
  their own page (Yarn & size, Visualize). A PR that changes the Design stage updates
  `docs/guide/design.md` and nothing else in the guide.

- **Screenshots and recordings are generated, never taken by hand.** A Playwright script
  drives the real app through a fixed demo pattern and writes every image. After a UI
  change, one command refreshes them all, and the script failing is a signal: if a
  button the docs show was renamed, the script can't find it.

- **Names match the UI exactly.** The guide writes button and section names in bold,
  exactly as the app shows them (**Save & edit pattern**, **Border & size**). The app is
  the source of truth for names; the guide follows it.

- **Stable anchors.** Guide headings are tasks ("Fix a grid that's one row short"), and
  their anchors are what the app links to from its help buttons. A test checks every
  anchor the app links to still exists.

- **Tests keep the links honest.** Every relative link and image in the docs, and every
  `docs/…` path cited in code comments, must exist, or `npm test` fails. Moving a file
  can't silently strand a reference again.

- **Frozen numbers stay frozen.** The code cites the spec as §N about 150 times. The spec
  moves but is never renumbered; new sections are appended.

## Target layout

```
README.md                     the product's front page (below)
CHANGELOG.md                  what changed, for users, one line per PR
CONTRIBUTING.md               setup, the checks, how a change is made, the docs rules
LICENSE                       (the owner's decision, see "Decisions for the owner")
.github/
  ISSUE_TEMPLATE/             bug report, idea; the app's Feedback button lands here
  pull_request_template.md    the definition-of-done checklist, docs included
docs/
  README.md                   map of the docs: what lives where, and the rules above
  guide/                      USER GUIDE: published on the website (phase 2) and on GitHub
    index.md                  Getting started: what the app is, the three stages, a 2-minute tour
    import.md                 Importing a chart: which photos work, checking the grid, colours
    design.md                 Designing: tools, colours, Border & size, rotate/mirror, undo, export
    work.md                   Following a pattern: rows, direction, partial rows, carrying yarn
    yarn-and-size.md          Yarn & size: swatch, finished size, how much yarn
    visualize.md              Visualize: the stitch preview and what it assumes
    library.md                Library: projects, .alpha files, backups, moving to another device
    settings.md               Settings
    your-data.md              Where your projects are stored, what never leaves your browser
    troubleshooting.md        Questions and problems, with the fix for each
    media/                    GENERATED screenshots and recordings; never edit by hand
  dev/
    architecture.md           Tier A / Tier B, the Pyodide boundary, storage, hosting
    rules.md                  "Rules for anyone working on this", moved from web-port-plan.md
    spec.md                   was plan.md; § numbers unchanged
    areas/                    technical notes per area, the "why" behind each feature
      import.md  work.md  design.md  yarn.md  visualize.md  storage.md  detection.md
    desktop-app.md            the legacy PySide6 app: launching it, what it still does
    history/
      web-port.md             Phases 0–3 of the port, frozen as a record
fixtures/
  images/                     was test_images/; test data with a provenance README
```

### Why the guide is Markdown in the repo

It sits next to the code, so a PR changes the code and its page together, the owner
reviews both at once, and git keeps its history. GitHub renders it as it is, so it's
readable on day one. And the same files can later be built into pages on the website
(phase 2) with no rewrite. A wiki or a separate docs repo would drift from the code the
first time someone forgot it existed. GitHub's wiki is on for this repo and unused;
turn it off so there's one place, not two.

## The README

The README becomes the product's front page. Everything about developing the app moves
to `CONTRIBUTING.md` and `docs/dev/`, and the README links there in one line.

Outline:

1. **Name and one sentence:** "Turn a photo of a crochet alpha chart into a pattern you
   can edit and follow row by row."
2. **[Open the app →](https://alpha-pattern-editor.8b2mbys5sy.workers.dev)**, prominent,
   above the fold.
3. **A recording** (GIF, about 15 seconds, generated): drop a chart photo, the grid is
   found, save, a quick edit in Design, then following rows in Work.
4. **What it does**, three short blocks with one screenshot each:
   - **Import:** a photo or screenshot of a chart becomes a grid of colours; check it and
     fix what the detector wasn't sure about.
   - **Design:** paint, fill, recolour, add a border, resize, rotate, preview it as
     stitches, and work out how much yarn you need.
   - **Work:** follow it row by row on a phone or tablet, with stitch counts per colour,
     the direction of each row, and your place saved.
5. **Your projects stay on your device:** no account, no upload; how to back up. Links
   to `docs/guide/your-data.md`.
6. **Works in:** the browsers it is tested in (today, Chromium only; see "Couldn't
   verify" below).
7. **User guide · What's new · Report a problem**: links to `docs/guide/`,
   `CHANGELOG.md`, and the issue templates.
8. **Developing it:** one paragraph, and links to `CONTRIBUTING.md` and
   `docs/dev/architecture.md`.
9. **Licence and credits:** the licence, and the data sources the app credits
   (temperature-blanket.com's yarn colour data under CC BY 4.0, and the others listed in
   `web/src/yarn/data/README.md` and `web/src/stitch/README.md`).

What the README stops doing: listing milestones M0–M3, the `alphareader/` tree, desktop
launch commands, and detection accuracy figures. The first three move to
`docs/dev/desktop-app.md`; the accuracy figures to `docs/dev/areas/detection.md`.

## Where every existing file goes

Moves use `git mv`, so history follows the file. The moves are in one PR with no
changes to what the files say, apart from updating paths, so the owner can review the
restructure separately from new writing.

| Now | Goes to | What happens to it |
|---|---|---|
| `README.md` | `README.md` | Rewritten as the front page (above). The desktop sections move to `docs/dev/desktop-app.md`; the test guarantees to `docs/dev/areas/detection.md` |
| `plan.md` | `docs/dev/spec.md` | Moved, § numbers unchanged. A header says it was written for the desktop app, that the web app follows it except where `docs/dev/areas/` says otherwise, and that new sections are appended (§15 onwards), never inserted. The ~26 files that name `plan.md` are updated |
| `docs/web-port-plan.md`, "Status" and "After the port" | `docs/dev/areas/*.md` (the why), `docs/guide/*.md` (the how, rewritten for users), `CHANGELOG.md` (the when) | Split by area. Each entry's technical content (invariants, measured sizes, fixtures) goes to its area note; each user-visible behaviour is written again, in the present tense, in the guide; each entry becomes one line in the changelog's history |
| `docs/web-port-plan.md`, "Rules for anyone working on this" | `docs/dev/rules.md` | Moved as it is. Each rule gets a short anchor, so code comments can cite `docs/dev/rules.md#nd-py` instead of a heading's wording |
| `docs/web-port-plan.md`, Context, Central decision, Repo layout, Stack | `docs/dev/architecture.md` | Updated to what exists now (the repo layout still lists `reconstruction.ts` and "Phase 2") |
| `docs/web-port-plan.md`, Phases 0–3, Verification, Effort, Risks | `docs/dev/history/web-port.md` | Frozen: a record of how the port was done. Nobody updates it |
| `web/README.md` | `web/README.md` | Stays: commands and the layout of `web/src/`. The deploy section stays too; `CONTRIBUTING.md` links to it |
| `test_images/` | `fixtures/images/` | It's test data, used by 5 e2e specs, the Python tests and the parity check. Its README's advice on which photos work moves to `docs/guide/import.md`. Its new README records where each image came from (see "Decisions") |
| `test_images/failed/` | `fixtures/images/failed/` | Same; kept, the images detection is known to reject |
| `detect_cli.py` (repo root) | `scripts/detect_cli.py` | A developer tool; the root keeps only what a visitor needs |
| `fixtures/README.md`, `scripts/parity/README.md`, `web/src/yarn/data/README.md`, `web/src/stitch/README.md` | where they are | They document the folder they sit in, and that's right; `docs/README.md` links to them |
| `CLAUDE.md` | `CLAUDE.md` | Keeps what's specific to agents. The process that applies to everyone (checks, commits, PRs, docs rules) moves to `CONTRIBUTING.md`, and `CLAUDE.md` says "follow `CONTRIBUTING.md`" rather than repeating it, so the two can't disagree |

Code comments that cite "docs/web-port-plan.md, 'Some heading'" (27 files) are updated
to the new file and anchor in the same PR. `docs/web-port-plan.md` is then removed
rather than left as a stub: a stub is one more page to keep true, and the path check
(below) proves nothing points at it any more.

## The user guide

### Content, page by page

Each page opens with one paragraph saying what the screen is for, then is organised by
task. First drafts come from what already exists: the in-app text, the "After the port"
entries (rewritten in the present tense, for users), `test_images/README.md`, and the
e2e specs, which describe every behaviour step by step.

- **Getting started** (`index.md`): what an alpha chart is and what the app does with
  one; the three stages and when you're in each; a two-minute tour with the recording;
  "Import your first chart" as numbered steps.
- **Importing a chart** (`import.md`): which photos work (gridlines, not rotated, at
  least ~6 pixels per cell, numbers and watermarks are fine); dropping, pasting or
  choosing a file; reading the result; dragging the outline; cells marked unsure; the
  colour list (spotlight, ×, fewer or more colours); **Reset to detected grid**; naming
  and saving; what to do when it says it can't find a grid.
- **Designing** (`design.md`): starting from a blank grid; each tool and its key;
  **Add row** and **Add column**; colours (rename, recolour, delete, add); **Border &
  size**; rotate, mirror, flip, trim; undo; exporting a PNG; going to Work, and what
  happens to your progress when you change the pattern's structure.
- **Following a pattern** (`work.md`): which row is row 1 and which way it runs;
  **Start rows from the right**; the colour chips; finishing a row, going back, stopping
  mid-row; **Show where to carry yarn**; the keyboard; zoom and scroll on a phone; the
  screen staying awake; exporting the readout.
- **Yarn & size** (`yarn-and-size.md`): measuring a swatch; finished size; yarn by
  weight or length; carried yarn; matching colours to a yarn range, and where the colour
  data comes from.
- **Visualize** (`visualize.md`): the stitches it can show, what the preview assumes
  (worked bottom up, right side facing), and why it isn't exact.
- **Library** (`library.md`): opening, renaming, exporting and deleting projects; what a
  `.alpha` file is; backing up; moving projects to another device or browser; importing
  `.alpha` files from the desktop app.
- **Settings** (`settings.md`): each setting and what it changes.
- **Your data** (`your-data.md`): projects live in this browser only; nothing is
  uploaded, including photos; the one download (Pyodide, about 9 MB, only the first time
  you import a photo); clearing browser data deletes your projects, so export them; each
  web address has its own library.
- **Troubleshooting** (`troubleshooting.md`): each problem as a heading, with its fix.
  Seeded from the failure messages the import screen shows, the storage-unavailable
  notice, and the issues people file.

### Style

- Second person, present tense, short sentences, the crocheter's words ("row", "stitch",
  "colour"), never the code's ("palette index", "extent").
- British spelling, as the app uses ("colour").
- UI names in bold, exactly as shown. Keys as `Shift+H`.
- A screenshot only where it saves words; each has alt text saying what it shows.
- No history ("used to", "since", "now"), no PR numbers, no internals. If the "why"
  matters to users, one sentence; the rest belongs in `docs/dev/areas/`.

### Linking from the app to the guide

Add a **Help** tile on the landing screen, beside Library, Design pattern, Settings and
Feedback, and a small **?** link in each stage's header that opens that stage's guide
page in a new tab. Links go to stable anchors. `web/src/app/help.ts` holds every link in
one place, and a unit test checks each anchor exists in `docs/guide/`.

Where the links point depends on phase:

- **Phase 1:** the guide on GitHub
  (`https://github.com/matejmojemeno/alpha-pattern-editor/blob/main/docs/guide/…`).
  Works immediately, but GitHub is a developer's site; someone crocheting on a phone
  shouldn't have to go there.
- **Phase 2:** the guide on the website itself at `/help/`, built from the same Markdown
  (below). `help.ts` changes its base URL; nothing else does.

### Publishing the guide on the website (phase 2)

Build `docs/guide/` into static pages with **VitePress** in the same Cloudflare build,
into `web/dist/help/`. Why VitePress: it builds plain Markdown with no front matter
required, has search, works on phones, and uses Vite, which the app already uses.

Constraints this must keep:

- **It doesn't touch the app's bundle.** It's a separate build, so the main chunk
  (about 103 KB gzipped) and the Design chunk don't change; `e2e/bundle.spec.ts` keeps
  proving it.
- **Caching:** VitePress puts hashed files in `help/assets/`. `public/_headers` marks
  `/help/assets/*` immutable and leaves the `.html` pages to revalidate, and
  `e2e/bundle.spec.ts` checks the new folder's files are versioned, as it does for
  `/assets`.
- **Routing:** the app routes by `#` hash, so `/help/…` paths never collide with it.
- **Previews:** every PR's preview build includes the guide, so the owner reads the new
  page on the preview link the Cloudflare bot posts.
- **Free-plan limits:** a few dozen pages and images, well within 20,000 files.

## Screenshots and recordings

### How they're made

`web/e2e/docs-media.spec.ts`, run with `npm run docs:media`, drives the production
build in real Chromium and writes every image to `docs/guide/media/`. It isn't part of
`npm run test:e2e` (it's slow, and rewrites committed files), but it uses the same
helpers (`e2e/importing.ts`) and fails the same way when the UI changes under it.

To make the output the same on every run:

- **A demo pattern the project owns.** `fixtures/demo/demo.alpha` is a chart made in the
  app's own Design stage for this purpose, so its rights aren't in question. For the
  import screenshots, the script imports `fixtures/demo/demo-chart.png`, the same
  pattern exported with **Export PNG**, then photographed (see "Decisions for the
  owner").
- **A fixed clock** (`page.clock.setFixedTime`), because a pasted chart is named after
  the date.
- **Fixed viewports:** 1280×800 for desktop shots, and an iPhone-sized viewport with
  touch for the Work stage, which is where it gets used.
- **Light theme** (`colorScheme: 'light'`), device scale factor 2 for sharp images.
- **Only rewrite what changed.** The script decodes the existing PNG and compares
  pixels before writing, so an unchanged screen causes no git diff.

The list of images lives in the script, one `test()` per image, named after the file
it writes. Adding a screenshot to the guide means adding one test.

### The recording

The same script records the tour (Playwright `recordVideo`, 1280×720): drop the demo
chart, the grid appears, save, one edit in Design, three rows in Work. `ffmpeg` turns it
into:

- `docs/guide/media/tour.gif` for the README (GitHub doesn't play video files committed
  to the repo inline in a README, but it does animate GIFs). Aim for under 3 MB: 12 fps,
  960 px wide, a 128-colour palette.
- `docs/guide/media/tour.mp4` for the guide on the website (phase 2), which plays it as
  video, much smaller for the same quality.

`ffmpeg` is needed only by whoever regenerates the media, and the script says so if
it's missing. Repo size: about 25 images at 50–200 KB plus the GIF is roughly 5–8 MB,
and a regeneration only adds the images that changed.

## CHANGELOG and versions

- **`CHANGELOG.md`**, in the "Keep a Changelog" layout: an `## Unreleased` section at
  the top, and below it one section per release. Every PR that changes something a user
  can see adds one line, in plain words, under Unreleased (Added / Changed / Fixed).
  Internal changes don't need a line.
- **Releases:** because every merge to `main` already deploys, a release is a label for
  a point worth naming, not a deploy step. The owner cuts one when they want to
  announce something: rename Unreleased to `## 1.1.0 (2026-10-14)`, set
  `web/package.json`'s version to match, tag `v1.1.0`, and publish a GitHub Release with
  that section as its text.
- **The first release** is `1.0.0`, cut when this plan's PRs have landed. Its changelog
  section is a summary of what the app does; the history before it is summarised in one
  paragraph that links to `docs/dev/history/web-port.md`, rather than reconstructed PR
  by PR.
- **The app shows its version** in Settings (**About** at the bottom): the version from
  `package.json` and the short commit it was built from (Vite `define`, from the
  Cloudflare build's commit), with a link to "What's new". Bug reports then say which
  build they're about.

## Keeping it true: the rules

These go into `CONTRIBUTING.md` (and so apply to agents through `CLAUDE.md`) and into
the PR template's checklist.

**In the same PR as any change a user can see:**

1. Update the guide page for that screen. If a name on screen changed, search the guide
   for the old name.
2. Add a line to `CHANGELOG.md` under Unreleased.
3. If the screen looks different, run `npm run docs:media` and commit the images that
   changed. Leave unchanged ones alone (the script already does).
4. If the change adds a rule developers must keep, add it to `docs/dev/rules.md`; if it
   explains an area's design, to `docs/dev/areas/<area>.md`.

**The PR description says which guide pages changed,** so the owner can read them on
the preview link.

**Checks, in `npm test`** (a new `web/tests/docs.test.ts`):

- every relative link and image in `README.md`, `CONTRIBUTING.md` and `docs/**/*.md`
  points at a file that exists, and every `#anchor` at a heading that exists;
- every `docs/…`, `plan.md`-style path cited in a code comment under `web/src`,
  `web/e2e`, `alphareader/` and `scripts/` exists;
- every help link in `web/src/app/help.ts` points at an existing guide page and anchor;
- every image in `docs/guide/media/` is used by some page, and every image a page uses
  is one `docs-media.spec.ts` writes (so there are no hand-made or orphaned images).

**What the checks can't catch** is text that is still valid Markdown but no longer
true. That stays a review task: the PR template asks "Which guide pages did this
change, and did you read them on the preview?"

## Other things to change

Found while surveying the repo for this plan.

### On GitHub (settings, done by the owner or with `gh`)

- **Description** (empty now): the README's one sentence.
- **Website** (empty now): the app's address.
- **Topics:** `crochet`, `alpha-pattern`, `tapestry-crochet`, `pattern-editor`,
  `pyodide`, `react`.
- **Social preview image:** a generated screenshot, so shared links show the app.
- **Wiki:** turn off (unused; one place for docs).
- **Issue templates** (`.github/ISSUE_TEMPLATE/`): a bug report that asks for the
  browser and device, what they did, and optionally the chart image or an exported
  `.alpha` file (with a note that attaching it makes it public); an idea template; and
  `config.yml` pointing questions to the user guide. The app's **Feedback** tile opens
  `issues/new`, which will then offer these.
- **Labels by area:** `import`, `design`, `work`, `library`, `docs`, beside the defaults,
  so issues map to guide pages and area notes.
- **Releases:** from 1.0.0 (above).

### In the app

- **The description is out of date.** `index.html`'s `<meta name="description">` and
  the landing screen's subtitle both say "Follow a crochet alpha chart row by row, and
  keep your place.", which leaves out import and design. Suggested: "Turn a photo of a
  crochet alpha chart into a pattern you can edit and follow row by row."
- **Link previews:** add Open Graph and Twitter card tags (`og:title`,
  `og:description`, `og:image` as a generated screenshot, `og:url`) so a link shared in
  a chat or forum shows a picture.
- **The Settings tile** says "Display preferences: row emphasis, high contrast, focus
  mode." Settings also holds **Show where to carry yarn** now; the tile should say so.
- **Help** tile and **?** links (above), and **About** with the version (above).
- **`web/package.json`:** `"name": "web"` and `"version": "0.0.0"` become
  `"alpha-pattern-editor"` and `"1.0.0"`.

### In the repo

- **No licence.** Without one, the public code is "all rights reserved": others may look
  but not reuse it. See "Decisions".
- **The product has three names:** "Alpha Pattern Editor" (the app, the repo), "Alpha
  Pattern Reader" (the spec's title), `alphareader` (the Python package). The package
  name can stay (renaming it touches every import for nothing); the spec's title
  becomes "Alpha Pattern Editor: product specification".
- **The spec describes a desktop app.** Its §3 (PySide6, PyInstaller), §12 (milestones
  M0–M7) and §13 (acceptance criteria, e.g. "closing and reopening the app") are about
  the desktop. They stay, since code cites them, but the header added on the move says
  so, and `docs/dev/architecture.md` is where the web app's architecture is described.
- **The repo layout in `docs/web-port-plan.md` is stale** (it lists
  `render/reconstruction.ts`, and phases as future work). Fixed as it moves to
  `architecture.md`.
- **Root clutter:** `detect_cli.py` moves to `scripts/`. What a visitor sees at the root
  becomes: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `CLAUDE.md`,
  `alphareader/`, `docs/`, `fixtures/`, `scripts/`, `web/`, `requirements.txt`.
- **`requirements.txt`** installs PySide6 for everyone, though only the legacy desktop
  app needs it. Optional: split into `requirements.txt` (numpy, Pillow, SciPy for tests)
  and `requirements-desktop.txt` (PySide6), so a contributor to the web app skips
  PySide6 (1.1 GB installed, measured in the repo's `.venv`). `CONTRIBUTING.md` says which to use.
- **Browser support is untested outside Chromium.** The e2e suite runs Chromium only,
  but crocheters follow patterns on iPhones and iPads, which means Safari. Adding
  Playwright's WebKit project (at least for the Work and Library specs) would let the
  README say which browsers work instead of guessing. Until then the README says
  "tested in Chrome and Edge".

## The PRs, in order

Each is one worktree, one branch and one PR, per `CLAUDE.md`. The owner merges each
before the next starts, except where noted.

| # | PR | Contents | Depends on | Size |
|---|---|---|---|---|
| 0 | **This plan** | `docs/documentation-plan.md` | | small |
| 1 | **Docs: move the developer docs** | `plan.md` → `docs/dev/spec.md`; `web-port-plan.md` split into `rules.md`, `architecture.md`, `history/web-port.md` and `areas/*.md` (technical content only, no rewriting); all path references in code updated; `docs/README.md`; `web/tests/docs.test.ts` (links and cited paths). `CLAUDE.md`'s "Read first" updated | 0 | large but mechanical |
| 2 | **Repo: CONTRIBUTING, templates, housekeeping** | `CONTRIBUTING.md` (process from `CLAUDE.md`, plus the docs rules), `CLAUDE.md` slimmed to point at it, `.github/` issue and PR templates, `detect_cli.py` → `scripts/`, optional requirements split | 1 | medium |
| 3 | **Fixtures: test images** | `test_images/` → `fixtures/images/` with a provenance README; paths in tests, scripts and code updated; images without a known source replaced or removed (per the owner's answer) | owner's answer on image sources; can run beside 2 | medium |
| 4 | **Docs: generated screenshots and tour** | `fixtures/demo/`, `e2e/docs-media.spec.ts`, `npm run docs:media`, the first set of media | 1, demo pattern from the owner | medium |
| 5 | **Docs: user guide and README** | all `docs/guide/*.md` pages, the new README, `CHANGELOG.md` seeded, the media check added to `docs.test.ts` | 4 | large (mostly writing) |
| 6 | **App: help links, About, description** | Help tile, **?** links, `help.ts` and its test, About with version, meta description, Open Graph tags, landing subtitle, `package.json` name and version | 5 | small–medium |
| 7 | **Docs: the guide on the website** | VitePress build into `dist/help/`, `_headers`, bundle checks, `help.ts` base URL switched | 6, owner's go-ahead | medium |
| — | **GitHub settings** | description, website, topics, social image, wiki off, labels | 5 (needs the screenshot) | owner, a few minutes |
| — | **Release 1.0.0** | changelog section, version, tag, GitHub Release | 6 (or 7) | owner |

Each PR runs the full definition of done from `CLAUDE.md` and reports its numbers. PR 1
also proves nothing was lost in the split: every line of `docs/web-port-plan.md`
appears in one of its new homes, checked by a script diffing the sorted lines, and the
PR reports any line that didn't make it and why.

## Decisions for the owner

Each has a recommendation; PRs that depend on one wait for it.

1. **Licence.** Recommended: **MIT** if you're happy for others to reuse and adapt the
   code, since that's the common choice for a small tool and the simplest for anyone
   who wants to help. If you'd rather others couldn't ship a closed copy, **GPL-3.0**
   (or AGPL-3.0 for a hosted app). Third-party licences are unaffected either way; the
   yarn data stays CC BY 4.0 with its credit.
2. **Where the test images came from.** The repo is public, and `test_images/` holds
   charts whose source isn't recorded (they look like screenshots from pattern sites).
   Recommended: for each image, either record the source and its permission in
   `fixtures/images/README.md`, or replace it with a chart you drew or one with a clear
   licence. The README and guide will use only the demo pattern, never these.
3. **The demo pattern.** Recommended: draw one in the app's Design stage (something
   small and recognisable, e.g. 30×30, four or five colours), export it as `.alpha` and
   as PNG, and take one phone photo of the PNG on a screen or on paper, so the import
   screenshot shows a realistic photo. Or tell me what to draw and I'll make it with the
   app.
4. **The web address, before promoting it.** Each address has its own browser storage,
   so if the app later moves from `….workers.dev` to a custom domain, every user's
   library stays behind at the old address and has to be exported and re-imported.
   Recommended: decide now whether you want a custom domain, and if so, set it up
   before the README and social links go out.
5. **The guide on the website (PR 7).** Recommended: yes, once the guide exists; it's
   where users are. Until then it lives on GitHub.
6. **Name.** Recommended: keep "Alpha Pattern Editor" everywhere users see a name;
   `alphareader` stays as the Python package's internal name.

## Couldn't verify

- How the app behaves in Safari and Firefox: nothing in the repo tests them.
- The size of the tour GIF: the figure above is a target, not a measurement.
- Whether VitePress's output fits `bundle.spec.ts`'s versioning rule as it is: to be
  checked in PR 7.
