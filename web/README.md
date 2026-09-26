# Alpha Pattern Editor: web app

The browser version of the desktop app. The plan, and the rules for working on it, are
in [`docs/web-port-plan.md`](../docs/web-port-plan.md).

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
BENCH=1 npx playwright test e2e/large-photo.bench.spec.ts   # detection time and memory, phone-sized photos
```

`npm run dev` and `npm run build` also assemble what photo import downloads
(`scripts/detectAssets.ts`): the Pyodide runtime from the pinned `pyodide` package,
numpy's wheel (fetched once from Pyodide's release and checked against its sha256, then
cached in `.cache/`), and `alphareader-core.<hash>.zip` from
`../scripts/build_core_bundle.py`. That needs Python 3 on the path, or `../.venv`, or
`$PYTHON`. The e2e tests also use that Python, with numpy and Pillow, as the desktop
reference.

## Layout so far

- `src/model/`: TypeScript mirrors of `alphareader/core/model.py` (and readout's `Run`),
  plus the JSON documents inside a `.alpha` archive. Fields stay snake_case, to match the
  Python and the files on disk.
- `src/logic/`: `readout.ts`, `work.ts` and `edit.ts`, ports of `readout.py`, `work.py`
  and `edit.py`. The Python is the spec. `tests/golden.test.ts` replays
  `../fixtures/logic_golden.json`, and `tests/edit.golden.test.ts`
  `../fixtures/edit_golden.json`. `progress.ts` (not in the Python) keeps Work-stage
  progress sound across structural edits.
- `src/design/`: the Design stage's editing state as pure functions: the tools' pointer
  logic and the current colour (`editor.ts`), undo (`history.ts`), and the structural
  panel's previews and form (`structure.ts`, `structureForm.ts`).
- `src/render/`: Canvas 2D drawing and its geometry: the Work chart (`layout.ts`,
  `chart.ts`), the Design canvas (`design.ts`), and Export PNG (`png.ts`), which is
  checked pixel for pixel against the desktop's export in `../fixtures/png/`.
- `src/storage/`: `.alpha` archives (`alpha.ts`, `npy.ts`, `pyjson.ts`), IndexedDB
  (`db.ts`) and the repository the UI will use (`repo.ts`). Compatibility with the
  desktop format is tested in both directions; see `../fixtures/alpha/README.md`.

- `src/yarn/`: colour libraries (DMC and yarn ranges) and the yarn estimate. `data/`
  holds one JSON table per library, written by `../scripts/import_yarn_libraries.py`,
  with every source, licence and retrieval date in `data/README.md`; each is loaded by
  its own `import()`, never in the main chunk. `match.ts` finds the nearest shade as
  detection does (`../fixtures/yarn_nearest.json` proves it), `usage.ts` does the
  estimate's arithmetic. Their UI is in `src/ui/yarn/` and `src/ui/design/YarnPanel.tsx`.
- `src/app/`: hash router, app-wide context (repository, settings), persistence request.
- `src/settings/`: app-wide preferences in `localStorage` (display, the colour library,
  the yarn estimate's inputs), typed and fail-safe.
- `src/theme/`: `tokens.css` (the port of `theme.py`) and `contrastOn()`.
- `src/ui/`: the screens (landing, Library, Settings, Work, and the lazily loaded
  import screen and Design stage) and shared components. `gestures.ts` is the two-finger
  pinch and pan both charts use.
- `src/detect/`: the Pyodide boundary. `worker.ts` runs `alphareader/core/bridge.py` in
  a module worker; `client.ts` is the app's side of it; `protocol.ts` the messages.
- `src/importer/`: the import screen's logic: decoding images, the failure hints, the
  letterboxed crop mapping (`letterbox.ts`) and the controls' ranges (`controls.ts`).
  Its components are in `src/ui/import/`.

Routing uses the URL hash (`#/library`, `#/work/<id>`, `#/design/<id>`): the part after
`#` never reaches the server, so deep links survive a refresh on any static host with no
fallback rule. Library cards link to `#/open/<id>`, which replaces itself with the stage
the project opens in (§6.4: Work if there is progress, otherwise the stage it was last in).

Nothing in `src/logic/` or `src/storage/`, nor anything `src/main.tsx` loads statically,
may reach Pyodide or `src/detect/`: the app shell gets there only by `import()`, through
`src/app/detection.ts`. `tests/boundary.test.ts` and `e2e/bundle.spec.ts` enforce it.
