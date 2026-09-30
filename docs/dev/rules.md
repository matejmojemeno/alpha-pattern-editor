# Rules for anyone working on this

Each rule has a short anchor, so code can cite it (for example
`docs/dev/rules.md#nd-py`). Keep the anchors when a rule is reworded; add one to every
new rule.

These are the non-obvious constraints. Each one was learned the hard way or is easy to
break without noticing.

- <a id="border-size-sides"></a>**In "Border & size" the four sides are the only truth; Width and Height are worked out
  from them.** While a size is being typed, the text is kept with the sides typing began
  from (`structureForm.ts`, `border.size`), and each keystroke sets the sides afresh from
  those. Resizing from the current sides instead makes typing "70" pass through a
  7-wide pattern and leaves the pattern off-centre. Blurring the field, or the pattern
  changing shape, drops the typed text.
- <a id="import-stage-shape"></a>**The import screen's two stages both take the source image's shape** (`--source-ratio`
  on `.confirm`), never the pattern's: that is what makes them the same size and line
  up, whatever a crop or a border does to the pattern's own shape. The pattern is fitted
  inside its stage instead. A stage holding words (`.stage--message`) keeps the size
  from an invisible stand-in, so it grows rather than clips. `e2e/corrections.spec.ts`
  measures both at three widths.
- <a id="import-grid-container"></a>**On a wide screen the import grid is a size container** (`container-type: size` on
  `.confirm__grid`), and the stage width (`--stage-w`, from `cqw`/`cqh` and the numeric
  `--source-aspect`) is applied to the *columns*, never to the grid's own
  `grid-template-columns`: a container's own properties can't use its container units
  (they resolve against an ancestor, here the window), and the grid then ran off the
  right edge. If the column header or the row under a stage changes height, change
  `--col-chrome` with it, or the stages overflow the window.

- <a id="import-overlay"></a>**The import overlay is drawn from the extent, rows and cols** (`outline.gridLines`),
  not from the preview's `rowLines`/`colLines`, so a dragged outline shows its lines
  before the resample answers. That's the same picture only because `confirm.resample`
  divides the extent evenly (`np.linspace`). If resampling ever follows an uneven
  lattice, draw the preview's lines again.

- <a id="carried-yarn-directions"></a>**"Yarn & size" counts carried yarn with the pattern's own row directions, and
  "Visualize" with `PATTERN_DEFAULTS`'.** How much is carried depends on which way each
  row runs. "Yarn & size" (`ui/design/YarnEstimate.tsx`) is given the saved pattern, so it
  counts as the Work stage's carry hints show. "Visualize" draws the first row worked as
  the bottom one, facing the right side (`stitch/faces.ts`), so it lays its defaults
  (`bottom_up`, `start_direction`) over the pattern's before `carryPlan`, or the carried
  strands would lie where the stitches aren't drawn. To show a pattern worked top down or
  from the left, teach `faces.ts` first, then drop that override.
- <a id="lucide-flip-names"></a>**Name Lucide's flip icons by their axis, never `FlipHorizontal2`/`FlipVertical2`.**
  In lucide-react 1.x those are aliases the wrong way round for this app: `FlipHorizontal2`
  is `TrianglesCenterlineDashedHorizontal`, a horizontal centre line, which is a flip top
  to bottom. Mirror (left to right) is `TrianglesCenterlineDashedVertical`. Look at an icon
  on screen before trusting its name. Icons the Design stage alone uses belong in
  `ui/design/icons.tsx`, so they load with its chunk rather than the entry chunk.
- <a id="no-nested-lazy-chunks"></a>**Don't lazily import a chunk from inside a lazily loaded chunk.** Visualize, first
  loaded by `import()` from the (lazy) import screen, made Rollup split whatever it
  shared with the entry chunk (the Work stage's logic, then the shared components) into
  new chunks that `index.html` preloads: the entry chunk measured about 20 KB smaller while the
  page loaded 2 KB more, in two requests. Code only a lazy screen uses belongs in that
  screen's chunk, imported statically. `e2e/bundle.spec.ts` fails if `index.html`
  preloads anything.
- <a id="merge-by-hex"></a>**A colour merged on the import screen is remembered by its hex, never its id.**
  Every resample builds a fresh palette with fresh `uuid4` ids
  (`palette.build_palette`), so each preview is kept as detection answered it and the
  removals are replayed on it in order, each taking the entry nearest its hex within half
  the merge threshold (`importer/removals.ts`). Saving replays them on the committed
  pattern, built from the same cached preview (`bridge.commit`), so what is saved is
  what was shown.
- <a id="merge-threshold"></a>**The colour-merge threshold is set in one place,** `palette.DEFAULT_DELTA_E`. The web
  sends no ΔE, so the worker must leave `delta_e` out and let the bridge's default apply;
  don't hard-code a number in `worker.ts` again. Before moving it, rerun the real-chart
  test in `test_palette.py`: real colour pairs sit only ~18 apart in CIE76, and phantom
  shades up to ~17.
- <a id="colour-names-palette"></a>**Colour names depend on the whole palette.** "Dark blue" means "the darker of this
  palette's blues", so whenever the set of colours changes before saving (a removal on
  the import screen, here and in `scripts/desktop_import.py`), every colour is named
  again. After saving, names are the user's (Rename), so Design never renames. After
  changing `names.py` or the table, rerun `python scripts/import_colour_names.py` (for
  the table) and `python scripts/gen_names_fixture.py`; `test_names_fixture.py` fails
  until you do.
- <a id="old-dmc-setting"></a>**Settings saved before the yarn libraries went off by default still say `"dmc"`.**
  The store writes every field whenever one changes, so an old `"dmc"` can't be told
  from a choice. Such a browser keeps showing DMC shades until "Nothing" is picked.
- <a id="parity-check"></a>**After any change to `alphareader/core/detect`, run `python scripts/parity/check.py`.**
  It must report 89/89 bit-identical. It exits non-zero otherwise. Run `npm install` in
  `scripts/parity/` once first.
- <a id="python-is-spec"></a>**The Python is the spec for readout, progress and editing.** If `readout.ts`/`work.ts`
  disagree with `fixtures/logic_golden.json`, or `edit.ts` with `fixtures/edit_golden.json`,
  the TypeScript is wrong. If you change `readout.py`, `work.py` or `edit.py`, run
  `python scripts/gen_fixtures.py` and commit the result; `test_golden_fixtures.py` fails
  until you do.
- <a id="yarn-data-sourced"></a>**Colour library data is sourced, never typed in.** Every table in
  `web/src/yarn/data/` comes from `scripts/import_yarn_libraries.py` and a source named
  in its README, with its licence. After changing one, or `palette.srgb_to_lab`, run
  `python scripts/gen_yarn_fixture.py`.
- <a id="row-ids"></a>**Edits never renumber rows.** `edit.ts` keeps every existing `row_id` exactly and gives
  only new rows fresh ids; progress is a set of row ids, so that is what keeps the Work
  stage's place across a trip to Design.
- <a id="clamp-indices"></a>**Out-of-range indices clamp, they don't throw.** The fixtures pass negative and
  too-large indices on purpose.
- <a id="start-direction"></a>**Do not "fix" the `start_direction` default asymmetry.** `io.py` defaults it to `"LTR"`
  when loading a file, while the `model.py` dataclass defaults to `"RTL"`. This is
  deliberate: it keeps files written before right-to-left became the default reading
  correctly. Unifying the two would silently mirror every old project.
- <a id="debug-layers"></a>**`DebugLayers` never crosses the worker boundary.** It holds full-resolution masks,
  megabytes per message.
- <a id="nd-py"></a>**Don't "simplify" `_nd.py`.** `find_peaks` applies `distance` *before* `prominence`,
  exactly as SciPy does. Complete linkage uses a nearest-neighbour cache because the
  obvious version is O(n³) (23 s against SciPy's 1 s on a noisy chart), and fills its
  one n×n matrix in bands because the obvious broadcast peaks at ~2.2 GB on a JPEG with
  ~6,300 colours, which kills a phone tab. All three are load-bearing.
- <a id="per-row-heights"></a>**The Work chart lays out rows with per-row heights, never a single cell size.**
  Scrolling long charts and the taller current row both depend on it (see [Phase 1](history/web-port.md#chart-layout)), and
  retrofitting it later means redoing the layout.
- <a id="floating-selection"></a>**A floating selection must be put down before any other edit.** While the Select
  tool's block floats (`editor.ts` `Selection.floating`), the pattern is its `under` with
  the block written over it, and both hold palette *indices*. An edit that renumbers the
  palette (deleting a colour) or reshapes the pattern would leave them stale, and the
  next move would write the wrong colours. `commit` (so every edit through it) puts the
  selection down first, and undo and redo drop it. A new edit that sets `pattern`
  without `commit` must do the same.
- <a id="design-carries-progress"></a>**The Design stage carries progress from what it opened with.** It saves
  `carryProgress(openedPattern, openedProgress, pattern)`, never progress updated edit by
  edit: that is what lets undo bring back the rows a structural edit dropped. The Work
  stage runs `repairProgress` on load, for files edited anywhere else.
- <a id="zero-pyodide"></a>**The Work and Design stages make zero Pyodide requests.** Keeping Pyodide out of the
  Work stage is what makes the app usable on a phone, and Design has no use for it
  either since `edit.py` moved to TypeScript. Treat any regression here as a bug.
- <a id="known-failure"></a>**The Python suite has one known failure,** `test_edge_numbers_all_sides`: a 44×5 chart
  whose dimensions come out one column short. It's documented in `test_images/README.md`.
  Any other failure is new.
