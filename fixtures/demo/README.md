# The demo pattern

The pattern every screenshot and the tour in the user guide show
(`docs/guide/media/`, made by `web/e2e/docs-media.spec.ts`). It exists so the docs
never show a chart whose rights are in question.

| File | What it is |
|---|---|
| `demo.alpha` | **Toadstool**: a red-capped toadstool with white spots on a pale blue sky, over green grass, inside a one-stitch red border. 30 × 30 stitches, 5 colours (Blue `#bcdcef` 304, Red `#c8312f` 329, White `#fbf7ee` 129, Beige `#d6a878` 40, Green `#4f9a3a` 98), in the Design stage, no progress. |
| `demo-chart.png` | The same pattern as the app's **Export PNG** writes it (16 px per stitch, gridlines, 481 × 481). The import screenshots and the tour import it, as a user would import a chart. |

## Where they came from

Both were made for this repository by Claude (Anthropic's AI model, working as a coding
agent for the owner) in September 2026, as an original drawing: no existing chart was
copied or traced.

- `demo.alpha` is written by `scripts/gen_demo_pattern.py`, which holds the drawing as
  text, one character per stitch, and saves it with the Python core
  (`alphareader.core.io.save_project`), the desktop app's own writer. Its ids and
  timestamps are fixed, so a re-run writes the same content; `--check` confirms it.
  The desktop opens it: `.venv/bin/python scripts/desktop_import.py load
  fixtures/demo/demo.alpha` reads back 30 × 30 and the five colours above.
- `demo-chart.png` was exported from the web app: `DOCS_DEMO_CHART=1 npx playwright test
  --config playwright.docs.config.ts -g demo-chart` (from `web/`) imports `demo.alpha`,
  opens it in the Design stage and clicks **Export PNG**. It is pixel for pixel the
  desktop's export: `.venv/bin/python scripts/desktop_import.py png
  fixtures/demo/demo.alpha fixtures/demo/demo-chart.png` prints `"same": true`.

## Replacing them

The owner may replace both with a design of their own, and `demo-chart.png` with a
phone photo of it (on paper or a screen), so the import screenshots show a real photo.
The script takes them by path and reads the name, size and colours from `demo.alpha`,
so replacing them is a file swap and a re-run:

1. Save your pattern as `fixtures/demo/demo.alpha` (Library, **Export**) and your
   chart image or photo as `fixtures/demo/demo-chart.png`. The photo must be detected
   as the same number of rows and columns as the pattern; the import shots check that.
2. From `web/`: `npm run docs:media`, then `DOCS_TOUR=1 npm run docs:media` for the tour.
3. Update this README's description and provenance.
