# Alpha Pattern Editor: web app

The browser version of the desktop app. The plan, and the rules for working on it, are
in [`docs/web-port-plan.md`](../docs/web-port-plan.md).

```bash
npm install
npm test            # Vitest: golden-fixture replay, storage, import boundary
npx tsc --noEmit    # strict type check of src/, tests/ and scripts/
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

Nothing in `src/logic/` or `src/storage/` may reach Pyodide, and `tests/boundary.test.ts`
enforces it. The React entry point is still the Vite template; the UI comes next.
