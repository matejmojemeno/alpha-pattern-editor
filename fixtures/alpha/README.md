# `.alpha` compatibility fixtures

The web app reads and writes `.alpha` projects in TypeScript (`web/src/storage/`), and a
project has to move freely between it and the desktop app in both directions. These two
directories prove that it does.

| Directory | Written by | Read by |
|---|---|---|
| `desktop/` | `alphareader.core.io.save_project` via `scripts/gen_alpha_fixtures.py` | the TS suite, `web/tests/storage/fixtures.test.ts` |
| `from-ts/` | the TS storage layer via `web/scripts/gen-alpha-fixtures.ts` | `io.load_project` in `alphareader/tests/test_alpha_compat.py` |

Each directory has an `expected.json`, recording for every archive what should be read
back from it: cells, palette, row_ids, direction flags, progress, stage and a sha256 of
`source.png`, or `rejected` with the error message for a file that must be refused.

## What they cover

`desktop/`:
- `basic`: a pattern with the dataclass defaults, no source image.
- `with-source`: an embedded `source.png`, Work stage, with rows done.
- `partial-row`: two segments done and 2 stitches into the third. Uses LTR,
  non-alternating and top-down reading.
- `skip-cells`: `SKIP_INDEX` (0xFFFF) cells.
- `old-progress`: `progress.json` without `current_run_stitches`, as older builds wrote it.
- `legacy-pattern`: no `start_direction`, `alternate_direction`, `bottom_up` or `stage`,
  and palette entries without `dmc` or `count`. `start_direction` must load as `"LTR"`,
  not the dataclass default `"RTL"` (see Rules in `docs/web-port-plan.md`).
- `unicode`: non-ASCII, astral and control characters in names.
- `large`: 120×150, so the `.npy` header has 3-digit dimensions.
- `newer-format`: `format_version: 999`. Both sides must refuse it.

`expected.json` marks each file `pristine` if it came straight out of `save_project`.
The others were edited afterwards to look like other builds. For pristine files, the TS
suite also checks that saving them again produces **byte-identical** `meta.json`,
`pattern.json`, `progress.json` and `cells.npy`.

`from-ts/`:
- `roundtrip-*`: every loadable desktop file, opened and saved again by TS. The pytest
  test checks that each one reads back exactly as its desktop original.
- `built-edge`: built in TS from scratch, with integral timestamps (Python must still
  read them back as floats), awkward strings and 0xFFFF cells.
- `built-empty`: a 0×0 pattern.
- `newer-format`: a TS-written archive with `format_version: 999`.

## Regenerating

```bash
.venv/bin/python scripts/gen_alpha_fixtures.py   # after changing io.py or model.py
cd web && npm run gen:alpha                      # after that, or after changing web/src/storage
```

Both suites fail while the committed files are stale. Zip entries carry timestamps, so
the staleness checks compare archive *contents*, not zip bytes.
