# The docs: what lives where

Alpha Pattern Editor turns a photo of a crochet alpha chart into a pattern you can design
and follow row by row. Its documentation is written for three audiences, and each keeps
to its own place:

| Audience | Question | Where | Tense |
|---|---|---|---|
| People using the app | "How do I…?" | [`guide/`](guide/index.md), and the [README](../README.md) | the present: how it works now |
| People developing it | "Why is it like this, and what mustn't I break?" | [`dev/`](dev/), [`CLAUDE.md`](../CLAUDE.md) | the present, with reasons |
| Everyone | "What changed?" | [`CHANGELOG.md`](../CHANGELOG.md), git history and pull requests | the past |

## For people using the app: `docs/guide/`

One page per screen, organised by task, so a change to a screen touches one page:
[Getting started](guide/index.md), [Importing a chart](guide/import.md),
[Designing](guide/design.md), [Following a pattern](guide/work.md),
[Yarn & size](guide/yarn-and-size.md), [Visualize](guide/visualize.md),
[Library](guide/library.md), [Settings](guide/settings.md), [Your data](guide/your-data.md)
and [Troubleshooting](guide/troubleshooting.md).

How the guide is written:

- **Second person, present tense, short sentences, British spelling** as the app uses it.
  No history ("used to", "now"), no pull request numbers, nothing about how the app is
  built.
- **The crocheter's words:** row, stitch, colour; never "palette index" or "extent".
- **Names exactly as on screen, in bold** (**Save & edit pattern**, **Border & size**);
  keys in code, as `Shift+H`.
- **Headings are tasks** ("Fix a grid that's a row or column short"), and they're stable:
  other pages, and later the app, link to them.
- **Only what the app does.** Every claim is checked against the code; a behaviour that
  can't be found there is left out.
- **Screenshots are generated, never taken by hand** (`npm run docs:media`, see
  [`guide/media/README.md`](guide/media/README.md)), each with alt text, and only where
  one saves words. `npm test` fails if an image in `guide/media/` is used by no page, or a
  page uses an image the screenshot script doesn't write.
- A change users will notice adds a line to [`CHANGELOG.md`](../CHANGELOG.md).

## For developers: `docs/dev/`

| File | What it holds |
|---|---|
| [`dev/architecture.md`](dev/architecture.md) | How the web app is built: Tier A (TypeScript) and Tier B (Pyodide, detection only), the repo layout, the stack, hosting. |
| [`dev/rules.md`](dev/rules.md) | The non-obvious rules nobody may break. Each has an anchor that code cites, such as [`rules.md#nd-py`](dev/rules.md#nd-py). |
| [`dev/spec.md`](dev/spec.md) | The product spec, written for the desktop app. Code cites it as §N; the numbers never change. |
| [`dev/areas/`](dev/areas/) | One note per area of the app: what was built, the invariants, the measured sizes, the fixtures, and why. |
| [`dev/crafts.md`](dev/crafts.md) | Other colourwork crafts (knitting, intarsia, bracelets, beads, C2C…): which fit the Work stage, what each takes, and what's built. |
| [`dev/history/web-port.md`](dev/history/web-port.md) | How the desktop app was ported to the web, Phases 0–3: a frozen record. |

The area notes: [Import](dev/areas/import.md), [Detection](dev/areas/detection.md),
[Design](dev/areas/design.md), [Work](dev/areas/work.md), [Yarn](dev/areas/yarn.md),
[Visualize](dev/areas/visualize.md), [Home screen, Library and
Settings](dev/areas/library.md), [Storage](dev/areas/storage.md).

How a change is made, and the checks every change runs, are in
[`CLAUDE.md`](../CLAUDE.md). The plan this layout comes from, and the pull requests still
to come, is [`documentation-plan.md`](documentation-plan.md); it is deleted once done.

## Beside the code

Some folders document themselves, in a README next to what it describes:

| README | What it documents |
|---|---|
| [`web/README.md`](../web/README.md) | The web app's commands, the layout of `web/src/`, and deploying. |
| [`fixtures/README.md`](../fixtures/README.md) | The golden fixtures the TypeScript replays: their schemas and porting notes. |
| [`fixtures/alpha/README.md`](../fixtures/alpha/README.md) | The `.alpha` files each side writes for the other to read. |
| [`scripts/parity/README.md`](../scripts/parity/README.md) | The check that detection gives bit-identical results in Pyodide and on the desktop. |
| [`web/src/yarn/data/README.md`](../web/src/yarn/data/README.md) | Where each yarn colour table comes from, and its licence. |
| [`web/src/importer/README.md`](../web/src/importer/README.md) | Where the everyday colour names come from. |
| [`web/src/stitch/README.md`](../web/src/stitch/README.md) | The sources for Visualize's stitch proportions. |
| [`web/src/craft/README.md`](../web/src/craft/README.md) | The sources for each craft's reading order in the Work stage. |
| [`test_images/README.md`](../test_images/README.md) | The chart images the tests detect. |

## Keeping the docs true

- A change updates the area note it affects, in the same pull request. A new rule goes
  into [`dev/rules.md`](dev/rules.md), with an anchor.
- `npm test` (in `web/`) runs `web/tests/docs.test.ts`, which fails when a relative link
  or image in these docs points at a file or heading that doesn't exist, or when a code
  comment cites a `docs/` path or anchor that doesn't exist.
- The spec's § numbers are frozen: new sections are appended, never inserted.
