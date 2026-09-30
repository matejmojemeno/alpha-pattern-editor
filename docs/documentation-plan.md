# Documentation plan: what's left

The aim: documentation for the people who **use** the app, not a record of how it was
built. Someone who lands on the repo should understand the product in ten seconds and
find the link to open it; someone using the app should find out how to do something
without reading code.

When this plan is done, delete this file; `docs/README.md` (and `CONTRIBUTING.md`, if it
is written) carry its rules from then on.

## Done

| PR | What |
|---|---|
| #37 | This plan. |
| #40 | The developer docs moved to `docs/dev/` (spec, rules, architecture, area notes, history), and `npm test` checks every docs link and every docs path the code cites. |
| #41 | Generated screenshots and the tour: `npm run docs:media` writes `docs/guide/media/` from the demo pattern in `fixtures/demo/`. How it works is in [`guide/media/README.md`](guide/media/README.md). |
| #43 | The README is the app's front page: the link, the tour, Import, Design and Work with a screenshot each, where projects are stored, credits. |
| (this PR) | The desktop app is removed. Nothing user-facing describes it; the one thing kept is that the web app opens the `.alpha` files it saved. |

## Principles

- **Users first, and in their words.** Docs for users say "row", "stitch", "colour",
  never "palette index" or "extent", and never mention how the app was built.
- **Three audiences, three places, never mixed.**

  | Audience | Question | Where | Tense |
  |---|---|---|---|
  | People using the app | "How do I…?" | `README.md`, `docs/guide/` | the present: how it works *now* |
  | People developing it | "Why is it like this, and what mustn't I break?" | `docs/dev/`, `web/README.md` | the present, with reasons |
  | Everyone | "What changed?" | `CHANGELOG.md`, git history, PRs | the past |

- **One guide page per screen, so a change touches one page.** A PR that changes the
  Design stage updates `docs/guide/design.md` and nothing else in the guide.
- **Screenshots and recordings are generated, never taken by hand** (`npm run
  docs:media`). If a button the docs show was renamed, the script fails.
- **Names match the UI exactly,** in bold (**Save & edit pattern**, **Border & size**).
- **Stable anchors.** Guide headings are tasks ("Fix a grid that's one row short"), and
  the app's help links point at them; a test checks every anchor the app links to exists.

## Next: the user guide

`docs/guide/`, Markdown in the repo, so a PR changes the code and its page together and
GitHub renders it as it is. Each page opens with one paragraph saying what the screen is
for, then is organised by task. First drafts come from the in-app text, the area notes'
entries (rewritten in the present tense, for users), `test_images/README.md`, and the
e2e specs, which describe every behaviour step by step.

- **Getting started** (`index.md`): what an alpha chart is and what the app does with
  one; the three stages and when you're in each; the tour; "Import your first chart" as
  numbered steps.
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
- **Visualize** (`visualize.md`): the stitches it can show, what the preview assumes,
  and why it isn't exact.
- **Library** (`library.md`): opening, renaming, exporting and deleting projects; what a
  `.alpha` file is; backing up; moving projects to another device or browser.
- **Settings** (`settings.md`): each setting and what it changes.
- **Your data** (`your-data.md`): projects live in this browser only; nothing is
  uploaded, including photos; the one download (about 9 MB, only the first time you
  import a photo); clearing browser data deletes your projects, so export them; each web
  address has its own library.
- **Troubleshooting** (`troubleshooting.md`): each problem as a heading, with its fix.
  Seeded from the failure messages the import screen shows, the storage-unavailable
  notice, and the issues people file.

Style: second person, present tense, short sentences, British spelling as the app uses.
UI names in bold, keys as `Shift+H`. A screenshot only where it saves words, each with
alt text. No history ("used to", "since", "now"), no PR numbers, no internals.

The same PR seeds `CHANGELOG.md` ("Keep a Changelog": `## Unreleased`, then one section
per release; one plain line per user-visible change), links the guide from the README,
and extends `web/tests/docs.test.ts`: every image in `docs/guide/media/` is used by some
page, and every image a page uses is one `docs-media.spec.ts` writes.

## Then: the app links to the guide

- A **Help** tile on the home screen, and a small **?** in each stage's header that opens
  that stage's guide page. `web/src/app/help.ts` holds every link; a unit test checks
  each anchor exists in `docs/guide/`. The links point at GitHub until the guide is on
  the website (below).
- **About** at the bottom of Settings: the version from `package.json` and the commit it
  was built from, with a link to "What's new", so bug reports say which build they're
  about.
- **The description is out of date.** `index.html`'s `<meta name="description">` and the
  home screen's subtitle say "Follow a crochet alpha chart row by row, and keep your
  place.", which leaves out import and design. Use the README's sentence: "Turn a photo
  of a crochet alpha chart into a pattern you can edit and follow row by row."
- **Link previews:** Open Graph and Twitter card tags (`og:image` a generated
  screenshot), so a link shared in a chat or forum shows a picture.
- **The Settings tile** says "Display preferences: row emphasis, high contrast, focus
  mode." It also holds **Show where to carry yarn**; the tile should say so.
- `web/package.json`: `"name": "web"`, `"version": "0.0.0"` become
  `"alpha-pattern-editor"` and `"1.0.0"`.

## Then: the guide on the website

Build `docs/guide/` into static pages with **VitePress** in the same Cloudflare build,
into `web/dist/help/`, so someone crocheting on a phone never has to go to GitHub.
`help.ts` changes its base URL; nothing else does. Constraints: it's a separate build, so
the app's chunks don't change; `/help/assets/*` is hashed and marked immutable in
`public/_headers`, and `e2e/bundle.spec.ts` checks it; the app routes by `#`, so `/help/`
never collides; every PR preview includes the guide.

## Smaller things, any time

- **GitHub settings** (owner, a few minutes): description (the README's sentence),
  website (the app's address), topics (`crochet`, `alpha-pattern`, `tapestry-crochet`,
  `pattern-editor`), a social preview image from `docs/guide/media/`, the unused wiki
  turned off.
- **Issue templates** (`.github/ISSUE_TEMPLATE/`): a bug report that asks for the browser
  and device and, optionally, the chart or an exported `.alpha` (with a note that
  attaching it makes it public); an idea template. The app's **Feedback** tile opens
  `issues/new`, which will then offer these.
- **Browser support.** The e2e suite runs Chromium only, so the README says "tested in
  Chrome". Crocheters follow patterns on iPhones and iPads, which means Safari: adding
  Playwright's WebKit project (at least for Work and Library) would let the README say
  more.
- **Release 1.0.0** once the guide and help links are in: the changelog section, the
  version, a tag, a GitHub Release.

## Decisions for the owner

1. **Licence.** There is none, so the public code is "all rights reserved". Recommended:
   **MIT** if others may reuse it; **AGPL-3.0** if nobody should host a closed copy. The
   yarn data stays CC BY 4.0 with its credit either way.
2. **Where the test images came from.** `test_images/` holds charts whose source isn't
   recorded, in a public repo. Recommended: record each one's source and permission, or
   replace it. The README and guide use only the demo pattern, never these.
3. **The demo pattern.** The toadstool in `fixtures/demo/` was drawn for the repo, so its
   rights are clear. Replace it with your own design, or a phone photo of it, whenever
   you like; `fixtures/demo/README.md` says how.
4. **The web address, before promoting it.** Each address has its own browser storage, so
   moving from `….workers.dev` to a custom domain later strands every user's library.
   Decide on a custom domain before the README and social links go out widely.
