# Alpha Pattern Editor: web app

The app itself: everything a user sees. How it is built is in
[`docs/dev/architecture.md`](../docs/dev/architecture.md), and the rules for working on it
in [`docs/dev/rules.md`](../docs/dev/rules.md).

```bash
npm install
npm run dev         # http://localhost:5173
npm test            # Vitest: golden fixtures, storage, UI components (jsdom), import boundary
npm run typecheck   # strict type check of src/, tests/, scripts/ and e2e/
npm run lint
npm run build       # production build in dist/
npx playwright install chromium   # once
npm run test:e2e    # Playwright in real Chromium, against the production build
npm run gen:alpha   # rewrite ../fixtures/alpha/from-ts/ after changing src/storage
npm run docs:media  # the user guide's screenshots, into ../docs/guide/media/ (only those that changed)
DOCS_TOUR=1 npm run docs:media   # also re-record tour.gif and tour.mp4 (needs ffmpeg)
BENCH=1 npx playwright test e2e/large-photo.bench.spec.ts   # detection time and memory, phone-sized photos
```

`npm run dev` and `npm run build` also assemble what photo import downloads
(`scripts/detectAssets.ts`): the Pyodide runtime from the pinned `pyodide` package,
numpy's wheel (fetched once from Pyodide's release and checked against its sha256, then
cached in `.cache/`), and `alphareader-core.<hash>.zip` from
`../scripts/build_core_bundle.py`. That needs Python 3 on the path, or `../.venv`, or
`$PYTHON`. The e2e tests also use that Python, with numpy and Pillow, as the Python
reference (`alphareader/core/`).

`npm run docs:media` runs `e2e/docs-media.spec.ts` with its own config
(`playwright.docs.config.ts`, on port 4187, or `$DOCS_PORT`); `npm run test:e2e` skips that spec, because
it rewrites committed images. It drives the app through the demo pattern in
`../fixtures/demo/`, writes one image per test, and compares each with the committed one
pixel for pixel, rewriting only those that differ. `DOCS_TOUR=1` also records the tour
and encodes it with `ffmpeg` (on the `PATH`, or `$FFMPEG`); it's off by default because
the encoding changes on every run. See `../docs/guide/media/README.md`.

## Deploying (Cloudflare)

The app is static files with no backend, hosted on Cloudflare Workers static assets
(Cloudflare's recommended successor to Pages) at the free `*.workers.dev` address. Serving
static assets is free and unlimited.

- `wrangler.jsonc` points Cloudflare at `dist/`. There is no Worker script and no
  redirect rule; routes are hash-based, so every URL is `/`.
- `public/_headers` caches `/assets/*`, `/pyodide/*` and `/py/*` for a year as
  immutable (their file names change with their content) and leaves `index.html` to
  revalidate, so a deploy reaches returning visitors at once. `e2e/bundle.spec.ts` fails
  if a file in those folders isn't versioned, or if the site outgrows the free plan's
  limits (25 MiB per file, 20,000 files).

**Automatic deploys (set up once, in the Cloudflare dashboard).** Go to Workers & Pages,
then Create, then Import a repository, and pick this GitHub repo. Settings:

| Setting | Value |
|---|---|
| Worker name | `alpha-pattern-editor` (must equal `name` in `wrangler.jsonc`) |
| Production branch | `main` |
| Root directory (the "Path" field under Advanced settings) | `/web` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Preview command | `npx wrangler preview` (the default) |

Every push to `main` then deploys, and other branches get a preview URL, posted on the
pull request. `wrangler preview` needs the `"previews": {}` block in `wrangler.jsonc`;
without it the build succeeds and the preview step fails. Cloudflare's
build image has Node and Python 3 preinstalled (the build's Python step uses only the
standard library), and the build needs network access to jsDelivr once, for numpy's
wheel.

**By hand:** `npx wrangler login` once, then `npm run deploy` (build, then
`wrangler deploy`). `npx wrangler deploy --dry-run` checks the config without an account.

**Browser storage is per address.** The library lives in IndexedDB, which belongs to one
origin: `localhost`, the `workers.dev` address, every preview URL and any later custom
domain each start empty. Move projects between them with Export and import of `.alpha`
files.

## Layout so far

- `src/model/`: TypeScript mirrors of `alphareader/core/model.py` (and readout's `Run`),
  plus the JSON documents inside a `.alpha` archive. Fields stay snake_case, to match the
  Python and the files on disk.
- `src/logic/`: `readout.ts`, `work.ts` and `edit.ts`, ports of `readout.py`, `work.py`
  and `edit.py`. The Python is the spec. `tests/golden.test.ts` replays
  `../fixtures/logic_golden.json`, and `tests/edit.golden.test.ts`
  `../fixtures/edit_golden.json`. `progress.ts` (not in the Python) keeps Work-stage
  progress sound across structural edits, and `carry.ts` (not in the Python either)
  works out where to carry each colour on to the next row, for the Work stage's "Show
  where to carry yarn".
- `src/design/`: the Design stage's editing state as pure functions: the tools' pointer
  logic, the current colour and the Select tool's selection (`editor.ts`), undo
  (`history.ts`), blocks of cells and the clipboard (`selection.ts`), and the structural
  panel's previews and form (`structure.ts`, `structureForm.ts`).
- `src/render/`: Canvas 2D drawing and its geometry: the Work chart (`layout.ts`,
  `chart.ts`), the Design canvas (`design.ts`), and Export PNG (`png.ts`), which is
  checked pixel for pixel against the Python reference's export in `../fixtures/png/`.
- `src/storage/`: `.alpha` archives (`alpha.ts`, `npy.ts`, `pyjson.ts`), IndexedDB
  (`db.ts`) and the repository the UI will use (`repo.ts`). Every `.alpha` file the
  old desktop app saved must open; see `../fixtures/alpha/README.md`.

- `src/yarn/`: colour libraries (DMC and yarn ranges) and the yarn estimate. `data/`
  holds one JSON table per library, written by `../scripts/import_yarn_libraries.py`,
  with every source, licence and retrieval date in `data/README.md`; each is loaded by
  its own `import()`, never in the main chunk. `match.ts` finds the nearest shade as
  detection does (`../fixtures/yarn_nearest.json` proves it), `usage.ts` does the
  estimate's arithmetic (swatch, finished size, yarn by weight or length). Their UI is in
  `src/ui/yarn/` and `src/ui/design/YarnEstimate.tsx` ("Yarn & size" in the Design stage).
- `src/stitch/`: "Visualize" in the Design stage, the pattern drawn as crocheted
  fabric: the stitches and their proportions from published gauges (`catalogue.ts`, with
  every source in `README.md`), which side of each stitch shows (`faces.ts`), each stitch
  as strands of yarn (`geometry.ts`), the strands rasterised as shaded tubes
  (`raster.ts`), and the fabric drawn on a canvas (`fabric.ts`). Its dialog is
  `src/ui/design/Visualize.tsx`, part of the Design stage's chunk.
- `src/app/`: hash router, app-wide context (repository, settings), persistence request,
  every link to the user guide (`help.ts`), and the build's version and commit
  (`build.ts`, written in by `vite.config.ts`).
- `src/settings/`: app-wide preferences in `localStorage` (display, the colour library,
  the yarn estimate's inputs), typed and fail-safe.
- `src/theme/`: `tokens.css` (the port of `theme.py`) and `contrastOn()`.
- `src/ui/`: the screens (landing, Library, Settings, Work, and the lazily loaded
  import screen and Design stage) and shared components. `gestures.ts` is the two-finger
  pinch and pan both charts use. `icons.tsx` holds the icons (Lucide) and the logo;
  the Design stage's own are in `design/icons.tsx`, in its chunk.
- `src/detect/`: the Pyodide boundary. `worker.ts` runs `alphareader/core/bridge.py` in
  a module worker; `client.ts` is the app's side of it; `protocol.ts` the messages.
- `src/importer/`: the import screen's logic: decoding images, the failure hints, the
  letterboxed crop mapping (`letterbox.ts`), moving the grid's outline in whole cells
  (`outline.ts`), the controls' ranges (`controls.ts`), the colours removed before
  saving (`removals.ts`) and naming the colours left (`names.ts`, from
  `colour-names.json`; provenance in its `README.md`; the Design stage names a colour
  being added with it too), and what the screen says and allows for a chart or a picture
  (`picture.ts`; the deciding and converting are `core/kind.py` and `core/convert.py`).
  Its components are in `src/ui/import/`.

Routing uses the URL hash (`#/library`, `#/work/<id>`, `#/design/<id>`): the part after
`#` never reaches the server, so deep links survive a refresh on any static host with no
fallback rule. Library cards link to `#/open/<id>`, which replaces itself with the stage
the project opens in (§6.4: Work if there is progress, otherwise the stage it was last in).

Nothing in `src/logic/` or `src/storage/`, nor anything `src/main.tsx` loads statically,
may reach Pyodide or `src/detect/`: the app shell gets there only by `import()`, through
`src/app/detection.ts`. `tests/boundary.test.ts` and `e2e/bundle.spec.ts` enforce it.
