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
- <a id="parity-check"></a>**After any change to `alphareader/core/detect`, `kind.py`, `pixels.py`, `outlines.py` or `convert.py`, run
  `python scripts/parity/check.py`.** It must report 122/122 bit-identical (89 charts, 25
  pictures and 8 pixel images, each also read by `kind.py` and converted three times, once with outlines). It exits non-zero
  otherwise. Run `npm install` in `scripts/parity/` once first.
- <a id="failure-not-picture"></a>**A detection failure is not a picture, and a detected grid is not a chart.** Most
  photos fail as LOW_RESOLUTION, as real charts with small squares do; pictures can fit a
  nonsense grid. `kind.py` decides from what the grid looks like, and `test_kind.py`
  names every corpus image with its kind. Add an image there before moving a threshold.
- <a id="converter-deterministic"></a>**The converter must stay deterministic to the last bit.** No random seeds (the
  colours are seeded by splits and power iteration, not LAPACK), and Lab values and
  stitch costs are rounded to 6 decimals: without the rounding, 5 of 114 images put a
  few stitches differently in Pyodide, stitches halfway between two colours.
- <a id="picture-extent"></a>**A picture's extent is its edges; a chart's is its outer gridlines.** A chart's
  extent is clamped to W − 1 and scaled as pixel centres (`to_image`); a picture's runs
  0 to W and is scaled by the shrink factor alone (`edge_to_image`, `convert.clamp_edges`),
  so its outline reaches the image's own edges.
- <a id="picture-controls"></a>**A picture's controls live above the colour list, never under a stage.** The column
  chrome under the stages is a measured constant (`--col-chrome`); anything added there
  must change it too, or the stages overflow the window.
- <a id="refused-chart"></a>**A chart the detector refuses is never converted unasked.** LOW_RESOLUTION and ROTATED
  on an image with a grid's structure stay failures with their advice, and the picture
  reading is a button ("Turn it into a pattern anyway"): a converted chart looks
  plausible and is wrong.
- <a id="picture-colour-weight"></a>**A picture's colours are weighted towards detail, capped at 4×.** Uncapped (squared,
  as first tried), a white background filling half a picture weighed 1/156 of the rest
  and lost its colour. Small distinct areas are protected by the "unexplained samples"
  step instead, which compares worst errors, not squared error (an area measure).
- <a id="pixel-art-last"></a>**Pixel art is read as pixels only when it can't be a chart.** A crisp chart is
  itself an exact enlargement (2 px lines: 2×; any chart at 1:1), so an enlargement loses
  to a chart, read or refused, whose squares aren't its blocks, and 1:1 wins only where
  detection finds no chart. Enlargements under 2× are 1:1 (`pixels._MIN_SCALE`).
- <a id="outlines-switch"></a>**"Keep outlines" stays the user's switch.** Two measures of "has drawn outlines"
  failed on the corpus (photos scored as high as drawings); don't turn it on by itself
  without a measure that separates the pictures in `test_images/pictures/`.
- <a id="ink-ridge"></a>**Ink is a ridge that goes on.** Lightness alone takes the edges of dark areas (a red
  shield); a ridge alone takes their corners. Both tests are in `test_outlines.py`.
  "Goes on" must allow a pixel's drift and darker ink, or thin anti-aliased lines break.
- <a id="drawing-colour"></a>**A drawing's colour is its most common shade; a photo's is its mean.** The mean of
  two flat colours sharing a slot is neither (an olive from yellow and orange); the most
  common shade of a photo's spread of shades can be the wrong one (a parrot's red beak,
  sharing a colour with brown ground, went brown). `convert.flat_share` decides, and is
  not "is it a drawing?" for anything else: it counts snowy photos as flat, where the
  most common shade and the mean are the same. Check `test_images/pictures/` with
  outlines off before moving `_FLAT_SHARE`: every photo there must convert as before.
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
- <a id="turn-rect"></a>**A quarter turn's shift must be undone by the next one.** When a
  selection's height and width differ by an odd number, its centre can't stay exactly put,
  and `turnRect` (`design/selection.ts`) has to round half a cell. The shift of a tall→wide
  turn must be the exact negative of the wide→tall one, and the same both ways round, or
  four turns (or a turn and its reverse) move the block: rounding both axes down made it
  creep up and left a cell every two turns. So "always up and left" is impossible. Today
  a wide block turned grows upward and keeps its left edge, and a tall one keeps its
  bottom row and grows right. `selection.test.ts` checks every size up to 7 × 7.
- <a id="design-carries-progress"></a>**The Design stage carries progress from what it opened with.** It saves
  `carryProgress(openedPattern, openedProgress, pattern)`, never progress updated edit by
  edit: that is what lets undo bring back the rows a structural edit dropped. The Work
  stage runs `repairProgress` on load, for files edited anywhere else.
- <a id="zero-pyodide"></a>**The Work and Design stages make zero Pyodide requests.** Keeping Pyodide out of the
  Work stage is what makes the app usable on a phone, and Design has no use for it
  either since `edit.py` moved to TypeScript. Treat any regression here as a bug.
- <a id="help-links"></a>**Link to the guide only through `src/app/help.ts`.** Renaming or moving a guide page,
  or a heading the app links to, breaks a link nobody sees until a user taps it;
  `tests/docs.test.ts` checks every entry in `HELP`, and only entries there.
- <a id="known-failure"></a>**The Python suite has one known failure,** `test_edge_numbers_all_sides`: a 44×5 chart
  whose dimensions come out one column short. It's documented in `test_images/README.md`.
  Any other failure is new.
