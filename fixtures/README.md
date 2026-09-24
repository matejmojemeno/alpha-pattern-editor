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
