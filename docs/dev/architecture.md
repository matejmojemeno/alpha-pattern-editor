# Architecture

How the web app is built, and why. The product spec is [`spec.md`](spec.md); the rules
that keep this architecture intact are in [`rules.md`](rules.md); what each area does
and why is in [`areas/`](areas/). The port that produced it is recorded in
[`history/web-port.md`](history/web-port.md).

## Context

Alpha Pattern Editor began as a ~6,500 LOC PySide6 desktop app that turned a photo of a
crochet alpha chart into an editable, trackable pattern (Library → Import → Work →
Design). It only ran on a Mac with the repo checked out and a venv set up. That made it
impossible to share, and unusable where the Work stage matters most: propped up on a
table, or on a phone, while crocheting. The web app replaced it, and the desktop app has
been removed.

The goal is a hosted web app with no backend and no accounts. What makes this feasible
is that `alphareader/core/` (~2,400 LOC) is already strictly UI-free, and it touches the
filesystem in only two places. So this is a frontend rewrite plus a storage swap, not a
ground-up rebuild.

**Decisions taken** at the start of the port. They still hold, except that Design has
shipped:
- Pyodide (Python compiled to WASM), no backend, static hosting.
- The desktop Qt app is retired once the web app reaches parity, so `core/` may be
  restructured freely. (Done: see [The desktop app](#desktop-app) below.)
- Storage is local-only: IndexedDB plus `.alpha` import/export.
- The first release is Import + Work + Library. Design comes later.
- Import and Work must work on phones and tablets. Design is desktop-first.

<a id="central-decision"></a>

## Central decision: Pyodide handles detection only

The obvious reading of "Pyodide rewrite" is to run all of `core/` in the browser behind a
JavaScript UI. That would be a mistake:

- `work.py` and `readout.py` together are ~300 lines of list indexing, set membership and
  string formatting. The **only** numpy in either is `np.diff`/`np.flatnonzero` for
  run-length encoding, which is a five-line loop in TypeScript.
- Neither returns a numpy array. Every public function returns `Progress`, `int`, `bool`,
  `str`, or `list[Run]` of plain ints.
- `edit.py` (Phase 3) is likewise pure copy-on-write over a small integer grid.

There's no reason to make a phone download a WASM runtime just to show a row of
stitch counts.

<a id="tiers"></a>

**So the app is split into two tiers:**

| Tier | Contents | Cost | When it loads |
|---|---|---|---|
| **A — TypeScript** | all UI, model types, `readout`, `work`, storage, `.alpha` read/write, `edit` | ~105 KB gzipped, the main chunk (budget 250 KB) | always; the Import and Design stages' own chunks when opened |
| **B — Pyodide** | `detect/` + `confirm.py` only | ~8.9 MB (measured) | lazily, only when importing a *new image* |

The Work stage, the Library, and opening or saving `.alpha` files never touch Python. They
load instantly, work offline, and work on a phone. Pyodide sits behind a single call:
image in, detected pattern out. Detection is also the only code where a rewrite would be
reckless, because it's the part that took the most work to get right.

## Repo layout

Monorepo. The Python package stays where it is and keeps its pytest suite.

```
alpha-pattern-editor/
  README.md
  CLAUDE.md                 # how work is done here (for agents, and the process for everyone)
  detect_cli.py             # runs detection on one image from the command line
  requirements.txt          # the Python dependencies (the reference, tests and scripts)
  docs/
    README.md               # map of the docs
    dev/                    # spec.md (the § numbers cited in code), architecture.md (this
                            #   file), rules.md, areas/, history/
  alphareader/
    core/                   # the reference implementation; the Python is the spec
      detect/               # the detection pipeline (Tier B, runs in Pyodide)
      bridge.py             # the only Python the browser calls
      confirm.py            # the import screen's session state (Tier B)
      model.py, readout.py, work.py, edit.py, io.py   # ported to TypeScript (Tier A)
    tests/                  # pytest
  fixtures/                 # golden fixtures the TypeScript replays (see its README)
    logic_golden.json, edit_golden.json, colour_names.json, yarn_nearest.json
    alpha/                  # .alpha files written by each side, read by the other
    png/                    # the Python reference's PNG exports
  scripts/
    parity/                 # desktop-vs-Pyodide detection parity
    gen_*.py                # regenerate the fixtures
    build_core_bundle.py    # packages alphareader/core/ for the browser
    desktop_import.py       # the Python reference's import, driven by the e2e specs
    import_*.py             # build the colour-name and yarn tables from their sources
  test_images/              # charts the tests and the parity check detect
  web/
    src/
      app/                  # routing, autosave, stage switching, the lazy detection client
      model/                # TS mirrors of the model.py dataclasses + .alpha JSON schema
      logic/                # readout.ts, work.ts, edit.ts, progress.ts, carry.ts, lab.ts
      storage/              # npy.ts, alpha.ts (zip), db.ts (IndexedDB), repo.ts
      detect/               # worker.ts, client.ts, protocol.ts: the Pyodide boundary
      importer/             # the import screen's logic: outline, merges, colour names
      design/               # the Design stage's editor, undo history, structural panel
      render/               # chart.ts, layout.ts, design.ts, png.ts (Canvas 2D)
      stitch/               # Visualize's stitch renderer
      yarn/                 # yarn libraries, shade matching, yarn and size estimates
      settings/             # app-wide preferences (localStorage)
      theme/                # tokens.css (port of theme.py), contrast.ts
      ui/                   # screens and components
    tests/                  # Vitest
    e2e/                    # Playwright, real Chromium and real Pyodide
    scripts/                # build plugins and benchmarks
```

`alphareader/core/` is shipped to the browser as a **zip fetched at runtime and unpacked
into Pyodide's virtual filesystem**. It's pure Python with nothing to compile, so a wheel
would add packaging work for no benefit. `scripts/build_core_bundle.py` copies `core/`
without `io.py` (which the browser replaces) and puts a content hash in the filename for
cache-busting. `dmc.json` is loaded through `importlib.resources`, so it resolves from
the zip.

## Stack

- React, Vite and TypeScript.
- `fflate` for zip files and `idb` for IndexedDB.
- `lucide-react` for icons (ISC licence; only the icons imported are bundled).
- Canvas 2D for all chart rendering.
- Vitest and Playwright for tests.
- Hosted on Cloudflare Workers static assets at the free `*.workers.dev` address. This
  replaced Cloudflare Pages, which Cloudflare no longer develops; for static files the two
  are equivalent. Setup and the caching rules are in `web/README.md` ("Deploying").

React is justified by how much state the UI holds (four stages, tool state, undo, live
preview). Canvas 2D is enough, and WebGL isn't needed: drawing every cell is already fast
at these chart sizes once the result is cached and copied rather than redrawn per frame.

Pyodide threading needs the `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` headers. Nothing requires threading today.
`web/public/_headers` can set them if that changes.

## Hosting

- **Hosting** (`web/wrangler.jsonc`, `web/public/_headers`): Cloudflare Workers static
  assets at the free `*.workers.dev` address, deployed by Cloudflare's Git integration on
  every push to `main` (setup in `web/README.md`, "Deploying"). `/assets/*`, `/pyodide/*`
  and `/py/*` are cached immutably. `e2e/bundle.spec.ts` checks that every file there has
  a versioned name, and that the site stays within the free plan's limits (25 MiB a file,
  20,000 files; today 16 MB in all). Verified with `wrangler dev`: the import, Design and
  persistence e2e specs pass against it, and `.wasm` is served as `application/wasm`.
  **Rule:** a new file under those three folders must carry a version or content hash in
  its name, or returning visitors never see it change.

<a id="desktop-app"></a>

## The desktop app

The PySide6 desktop app (`alphareader/ui/`, `alphareader/app.py`, and its tests) was
removed once the web app had replaced it. Two things remain from it on purpose:

- **Its `.alpha` files.** The web app must open every `.alpha` file the desktop app
  saved; `fixtures/alpha/desktop/` proves it (see
  [`fixtures/alpha/README.md`](../../fixtures/alpha/README.md)).
- **Its logic, as the reference.** `alphareader/core/` was always UI-free and stays: it
  runs detection in the browser, and it is the spec the TypeScript replays. Scripts
  named after the desktop, such as `scripts/desktop_import.py`, drive this Python
  reference and need no desktop UI.

Code comments that say what they port, such as "a port of `design_window.py`" or
`chart_view.py:69`, name files from the desktop app. They are in git history: the last
commit that has them is `f33316e` (`git show f33316e:alphareader/ui/work/chart_view.py`).
