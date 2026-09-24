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
```

## Layout so far

- `src/model/`: TypeScript mirrors of `alphareader/core/model.py` (and readout's `Run`),
  plus the JSON documents inside a `.alpha` archive. Fields stay snake_case, to match the
  Python and the files on disk.
- `src/logic/`: `readout.ts` and `work.ts`, ports of `readout.py` and `work.py`.
  The Python is the spec. `tests/golden.test.ts` replays `../fixtures/logic_golden.json`.
- `src/storage/`: `.alpha` archives (`alpha.ts`, `npy.ts`, `pyjson.ts`), IndexedDB
  (`db.ts`) and the repository the UI will use (`repo.ts`). Compatibility with the
  desktop format is tested in both directions; see `../fixtures/alpha/README.md`.

- `src/app/`: hash router, app-wide context (repository, settings), persistence request.
- `src/settings/`: display preferences in `localStorage`, typed and fail-safe.
- `src/theme/`: `tokens.css` (the port of `theme.py`) and `contrastOn()`.
- `src/ui/`: the screens (landing, Library, Settings, the `/work/:id` placeholder) and
  shared components.

Routing uses the URL hash (`#/library`, `#/work/<id>`): the part after `#` never reaches
the server, so deep links survive a refresh on any static host with no fallback rule.

Nothing in `src/logic/` or `src/storage/`, nor anything `src/main.tsx` loads, may reach
Pyodide; `tests/boundary.test.ts` enforces it.
