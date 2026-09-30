# The docs: what lives where

Alpha Pattern Editor turns a photo of a crochet alpha chart into a pattern you can design
and follow row by row. Its documentation is written for three audiences, and each keeps
to its own place:

| Audience | Question | Where | Tense |
|---|---|---|---|
| People using the app | "How do I…?" | `docs/guide/` (not written yet) | the present: how it works now |
| People developing it | "Why is it like this, and what mustn't I break?" | [`dev/`](dev/), [`CLAUDE.md`](../CLAUDE.md) | the present, with reasons |
| Everyone | "What changed?" | git history and pull requests | the past |

## For developers: `docs/dev/`

| File | What it holds |
|---|---|
| [`dev/architecture.md`](dev/architecture.md) | How the web app is built: Tier A (TypeScript) and Tier B (Pyodide, detection only), the repo layout, the stack, hosting. |
| [`dev/rules.md`](dev/rules.md) | The non-obvious rules nobody may break. Each has an anchor that code cites, such as [`rules.md#nd-py`](dev/rules.md#nd-py). |
| [`dev/spec.md`](dev/spec.md) | The product spec, written for the desktop app. Code cites it as §N; the numbers never change. |
| [`dev/areas/`](dev/areas/) | One note per area of the app: what was built, the invariants, the measured sizes, the fixtures, and why. |
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
| [`test_images/README.md`](../test_images/README.md) | The chart images the tests detect. |

## Keeping the docs true

- A change updates the area note it affects, in the same pull request. A new rule goes
  into [`dev/rules.md`](dev/rules.md), with an anchor.
- `npm test` (in `web/`) runs `web/tests/docs.test.ts`, which fails when a relative link
  or image in these docs points at a file or heading that doesn't exist, or when a code
  comment cites a `docs/` path or anchor that doesn't exist.
- The spec's § numbers are frozen: new sections are appended, never inserted.
