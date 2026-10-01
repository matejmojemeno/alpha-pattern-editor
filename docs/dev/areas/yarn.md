# Yarn

Yarn: matching colours to real yarn ranges, and the "Yarn & size" dialog (finished size
and how much yarn to buy). Code: [`web/src/yarn/`](../../../web/src/yarn/),
[`web/src/ui/yarn/`](../../../web/src/ui/yarn/) and
[`web/src/ui/design/YarnEstimate.tsx`](../../../web/src/ui/design/YarnEstimate.tsx); where
the colour tables come from is in
[`web/src/yarn/data/README.md`](../../../web/src/yarn/data/README.md).

## After the port

Newest last, as they were built.

- <a id="yarn-libraries"></a>**Yarn colour libraries** (`web/src/yarn/`, Tier A, no Pyodide). Alpha crochet is
  worked in acrylic yarn ranges, not DMC floss, so each palette colour can be matched
  to Stylecraft Special DK (125 shades), Paintbox Yarns Simply DK (63) or Scheepjes Colour
  Crafter (90), besides DMC (119, the table detection takes the `dmc` code from). Off by
  default since everyday colour names ([detection](detection.md#colour-names)): chosen under "Advanced: match to yarn". Hex values and names come
  from temperature-blanket.com's yarn colorway data (CC BY 4.0, credited in the UI);
  Scheepjes shade numbers from scheepjes.com; three contradictory Scheepjes entries are
  left out. Provenance: `web/src/yarn/data/README.md`. Each table is its own lazily
  loaded chunk (`e2e/bundle.spec.ts`). The nearest shade is the Python's
  (`fixtures/yarn_nearest.json`). Shown in the "Yarn & size" dialog only, in the Design
  stage (since ["A focused import screen"](import.md#focused-import); before, in the import screen's colour
  list): the Design stage's shade chips and "Use shade" went with "Yarn and size"
  (below). The choice is app-wide (the settings store): it describes the crocheter's
  yarn, not the chart, and nothing new goes into `.alpha` files.
- <a id="yarn-estimate"></a>**Yarn estimate:** first a panel in the Design stage (stitches × yarn per stitch ×
  (1 + extra %)); since "Yarn and size" (below), a dialog, on the import screen and now
  in the Design stage's header.
- Tier A: the main entry chunk is 102.9 KB gzipped (Vite's figure); the Design chunk
  16.7 KB (+2.5 KB CSS); the Import chunk 11.7 KB, with the colour name table; each
  library 1.1–2.1 KB, fetched on first use.
- **Rule:** after changing a library or `palette.srgb_to_lab`, run
  `python scripts/gen_yarn_fixture.py`; `test_yarn_fixture.py` fails until you do.
- <a id="yarn-and-size"></a>**Yarn and size** (`yarn/usage.ts`, `ui/design/YarnEstimate.tsx`): the Design stage's
  "Advanced: match to yarn", its shade chips, "Use shade" and the yarn estimate panel
  are gone. **"Yarn & size"** opens a dialog: first beside "Save & edit pattern" on the
  import screen, for the pattern as it would be saved; since ["A focused import screen"](import.md#focused-import),
  in the Design stage's header, for the pattern as it is, with "Advanced: match
  to yarn" and each colour's nearest shade inside it. The method follows how crocheters
  estimate, from one swatch in their own yarn, hook and stitch:
  - **Swatch:** stitches × rows (10 × 10 to start, the swatch Magic Yarn Pixels'
    calculators ask for, <https://magicyarnpixels.com/finished-size-yarn-quantity-calculators/>),
    its width and height, and optionally its weight.
  - **Finished size** = columns × (width ÷ stitches) by rows × (height ÷ rows), before
    any border. No default gauge: the Craft Yarn Council publishes stitch ranges per yarn
    weight (DK 12–17 sc to 4 in, <https://www.craftyarncouncil.com/standards/yarn-weight-system>)
    but nothing for rows, and a range isn't a size.
  - **Yarn by weight** when the swatch is weighed: grams per stitch = swatch grams ÷
    (stitches × rows), the method yardage guides recommend over generic charts
    (<https://www.petalstopicots.com/yardage-calculator/>; weighing a swatch and scaling
    by area, then 10% extra). Otherwise **by length**: yarn per stitch (2.5 cm, the old
    round figure; the dialog says how to measure your own: work 10, unravel, divide).
    Metres and grams convert through the ball (its length and weight, the library's own
    by default); balls are counted by the estimate's own measure, else the other.
  - **Carried yarn** (tapestry crochet, off by default): `carry.carriedStitches` counts,
    per colour, the stitches it is carried inside when worked as the Work stage's carry
    hints say (between its runs in a row, and to or from the next row), with the
    pattern's own row directions (on the import screen, before saving, the ones a new
    pattern gets, `PATTERN_DEFAULTS`). Each takes one stitch's width of
    yarn (a strand runs straight through): geometry, not a published figure, as none was
    found. By weight it needs the ball's grams per metre, and says so when missing.
  - Inputs are app-wide settings (`swatch*`, `ballGrams`, `countCarried` beside the
    old ones). "Export yarn list" is in the dialog, named after the pattern.
  - Tier A: main entry chunk 104.3 KB gzipped (Vite's figure; `bundle.spec.ts` counts
    100.7 KB), Design 14.6 KB (from 16.7), Import 17.1 KB.
