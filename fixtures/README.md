# Golden fixtures

`logic_golden.json` records what `alphareader/core/readout.py` and
`alphareader/core/work.py` do. The TypeScript ports of that logic, which let the
Work stage run without Pyodide, replay this file and must reproduce every value.
**The Python is the spec.** If the two disagree, the TS is wrong.

Regenerate after any change to `readout.py` or `work.py`:

```bash
python scripts/gen_fixtures.py          # rewrite
python scripts/gen_fixtures.py --check  # verify only; exit 1 if stale
```

`alphareader/tests/test_golden_fixtures.py` runs the check, so a stale file fails
the Python suite.

## Schema

```text
{
  format: 1,
  clock: 1700000000.0,     # fixed time.time() used for Progress.started_at
  skip_index: 65535,       # SKIP_INDEX; cells with this value read as "skip"
  cases: [{
    pattern: { id, name, rows, cols, row_ids[], cells[rows][cols], palette[{id,hex,name,dmc,count}],
               start_direction: "LTR"|"RTL", alternate_direction, bottom_up },
    readout: {
      rows: [{ row, working_position, working_number, row_direction,
               runs: [{palette_index, count, start_col}], text, compact }],
      export_all_rows_text, format_stats
    },
    work: {
      work_sequence: [row indices in working order],
      num_runs: [runs per image row],
      scenarios: [{
        name,
        initial: Progress,
        steps: [{ op, args[], progress: Progress,
                  remaining_stitches, completed_count, is_complete, first_incomplete_row }]
      }]
    }
  }]
}

Progress = { completed_row_ids: sorted[], current_row_id, current_run_index,
             current_run_stitches, started_at }
```

Each step applies `work.<op>(pattern, previous_progress, ...args)`, starting from
`initial`. `args` follow the Python signatures: `set_run_index(index)`,
`mark_segment_complete(run_index)`, `set_run_stitches(run_index, stitches)`; the
other ops take none.

## Porting notes

- **Clamping, not throwing.** Scenarios pass out-of-range and negative indices on
  purpose. The Python clamps them, and the port must clamp the same way.
- **`completed_row_ids` is a set** in Python and is sorted here only so the file is
  stable. Compare it as a set.
- **`started_at`** comes from the fixed `clock` whenever `ensure_started` stamps a
  fresh start, and must otherwise be carried through unchanged (see the
  `stale-cursor` scenario, which starts from `123.0`).
- **Labels:** an index past the end of the palette reads as `#N`, and a colour with
  an empty name gives `?` in the compact form (see the `labels` pattern).

# Edit fixtures

`edit_golden.json` records what `alphareader/core/edit.py` does: every public function
(the §9 operations, insert/delete of rows and columns, `scale`, `pad_to_size` with and
without offsets, `trim_uniform_edges`, the palette functions, `nearest_entry_id` and
`major_border_index`), over small patterns chosen for their edge cases, including every
`ValueError` path. `logic/edit.ts`, the Design stage's port, replays it. The same
`gen_fixtures.py` writes it, and the same Python test fails when it's stale.

## Schema

```text
{
  format: 1,
  new_id: "new",           # the marker for an id the edit made up (see below)
  skip_index: 65535,
  patterns: { <name>: Pattern },          # the inputs, with counts already correct
  cases: [{
    pattern: <name>,                      # the input, from `patterns`
    fn: "pad_to_size",                    # the edit.py function
    args: [...], kwargs: {...},           # as passed: fn(pattern, *args, **kwargs)
    # exactly one of:
    result: Pattern,                      # it returned a new Pattern
    value: 2 | "pal4",                    # it returned something else
    raises: "ValueError" | "KeyError",    # it raised; ValueErrors also have
    message: "Cannot delete the last row."  # their message
  }]
}

Pattern = { id, name, created_at, rows, cols, row_ids[], cells[rows][cols],
            palette[{id, hex, name, dmc, count}],
            start_direction, alternate_direction, bottom_up }
```

## Porting notes

- **Made-up ids.** New rows (`add_border`, `insert_row`, `scale`, `pad_to_size`) and
  new palette entries (`add_palette_entry`) get `uuid4().hex` ids, which can't be
  recorded literally. So ids are recorded *structurally*: an id the input had stays its
  literal value, and one it didn't becomes `"new"`. The port must produce an id that is
  **fresh** (not among the input's ids) and **unique** (no two alike) wherever the
  fixture says `"new"`, and exactly the recorded id everywhere else. Keeping existing
  `row_ids` exactly is what keeps Work-stage progress valid (§4.5).
- **Counts** are recomputed after every edit, as `_recount` does: cells whose index is
  `SKIP_INDEX` or past the end of the palette count towards no entry.
- **Deleting or merging an entry** shifts the palette indices above it down by one, and
  **only those**: an index that names no entry is left exactly as it was (the
  `odd-indices` pattern). So a `SKIP_INDEX` cell stays a skip cell. (Until Phase 3,
  part 2, `edit.py` shifted every index above the deleted one, which turned skip cells
  into 65534.) The same rule covers the other indices past the palette, which a file
  can hold but the editor never paints: they keep their value, and since the palette
  shrinks by one while they don't move, an index past the palette stays past it and
  never turns into a real colour. Shifting them instead would also have kept them out of
  range, but would change which "#N" the readout shows for them, for no reason.
- **Row and column indices are always in range** here. `edit.py` doesn't clamp them
  (numpy wraps negative ones and raises `IndexError` past the end), and the Design stage
  never passes anything else, so the port is free to throw on them.
- **`updated_at` isn't recorded:** every edit stamps `time.time()` into it. The port may
  leave it alone; saving stamps it anyway.
- **Ties:** `major_border_index` takes the lowest index among the most common border
  colours (`border-tie`), and `nearest_entry_id` the first of equally near entries
  (`nearest`, whose last two entries share a hex).

# `png/`: the desktop's Export PNG

What `io.export_pattern_png` makes of four projects in `alpha/desktop/`. The web
app's Export PNG (`web/src/render/png.ts`) must match it pixel for pixel
(`web/tests/render/png.test.ts`). Regenerate with `python scripts/gen_png_golden.py`;
`alphareader/tests/test_png_golden.py` fails if the files drift from the desktop's
output. Projects with skip cells or indices past the palette aren't included: the
desktop can't export them.
