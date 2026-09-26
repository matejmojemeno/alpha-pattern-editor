# Alpha Pattern Editor: how we work

Turns a photo of a crochet alpha chart into a pattern you can design and follow row by
row. The product is the **web app in `web/`**, hosted on Cloudflare. The Python in
`alphareader/core/` is the reference implementation, and runs in the browser through
Pyodide for photo detection only. The PySide6 desktop app (`alphareader/ui/`, `app.py`)
is legacy: keep it working, don't extend it. Retiring it is the owner's decision, so ask
before you do.

## Read first

| File | What it holds |
|---|---|
| `docs/web-port-plan.md` | Status of every piece of work, and **"Rules for anyone working on this"**: the technical invariants. Follow them. |
| `plan.md` | The product spec. Code and docs cite it as §N. |
| `web/README.md` | Commands, the layout of `web/src/`, deploying. |
| `fixtures/README.md` | The golden fixtures: schemas and porting notes. |

## Architecture in one breath

- **Tier A (TypeScript, always loaded):** UI (React), storage (IndexedDB; `.alpha` zip read
  and write), readout, work, edit, yarn, rendering (Canvas 2D).
- **Tier B (Pyodide, lazy, in a Web Worker):** only `core/detect` and `confirm.py`, through
  `core/bridge.py`, which passes plain data only.
- The Work and Design stages make **zero** Pyodide requests. The main chunk stays under
  250 KB gzipped (about 103 KB today).
- There is no backend: everything is stored locally, per browser origin.

## The Python is the spec

Readout, progress and editing exist twice, in Python and TypeScript, kept identical by
golden fixtures:

1. Change the Python first (`alphareader/core/…`), with pytest tests.
2. Regenerate: `python scripts/gen_fixtures.py` (also `gen_png_golden.py` and
   `gen_yarn_fixture.py` for their areas). The Python suite fails while a fixture is
   stale.
3. Change the TypeScript until `web/tests/*golden*` replays the fixtures.

After touching `core/detect`, run `python scripts/parity/check.py`: 89/89 bit-identical
between desktop CPython and Pyodide. Don't "simplify" `_nd.py`; the plan's Rules say why.

## How a change is made

- **One task, one git worktree, one branch.** Never commit or push to `main`. Never
  force-push. Never merge: **the owner merges every PR**, after reviewing it.
- **Commits:** one per logical step. The subject is `Area: what changed` (for example
  `Design: Rotate ↻ 90° and Rotate ↺ 90° in place of Rotate 180°`), and the body says why.
  End every commit with `Co-Authored-By: Claude <noreply@anthropic.com>`, or the attribution
  line your harness gives.
- **PRs (not drafts):**
  - The description covers, in plain English: what was built, the choices made and why,
    behaviour that differs from the desktop and why, every check with its result, and
    **"Couldn't verify"**.
  - End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - Cloudflare's bot comments the PR's preview link on every PR by itself (see Hosting).
    Point the owner to it when there's something to try.
- **Keep the docs true:** update the status in `docs/web-port-plan.md` and any README the
  change affects, in the same PR. When you learn a non-obvious invariant, add it to the
  plan's Rules.
- **After the owner merges:**
  1. Pull `main`.
  2. Remove the worktree and delete the branch, locally and on GitHub. Before removing
     anything, check that it has no uncommitted work and that its content is on `main`
     (`git diff <branch-head> main` is empty). Leave a worktree alone while an agent
     session still holds it.
  3. Tell the owner what they can now try, and how.

## Definition of done: run all of it and report the numbers

From `web/`:

```bash
npm test && npm run typecheck && npm run lint
npm run build                    # report the main and Design chunk sizes (gzipped)
CI=1 npm run test:e2e            # real Chromium, and real Pyodide for imports
```

From the repo root:

```bash
.venv/bin/python -m pytest alphareader/tests -q
```

- **e2e:**
  - Without `CI=1`, Playwright reuses any server already on port 4174, possibly a stale
    one. Check that the port is free.
  - The import specs compare against the desktop through `scripts/desktop_import.py`,
    which needs `<repo>/.venv`. In a worktree, symlink it or put `.venv/bin` on `PATH`.
- **Python:** one known failure, `test_edge_numbers_all_sides`. Any other failure is new.
- **Tests must fail without the fix.** For a bug fix, run the new test against the old
  code and say that you did.

## Reviewing work, including a subagent's: verify, don't trust

When the owner pastes an agent's report, or a subagent finishes, check the PR yourself
before saying it's ready:

- **Reproduce every check it claims** (the commands above). Say plainly where a number
  differs.
- **Test the substance independently:**
  - For logic ports, run random chained operations on real patterns through the Python,
    record them in the golden-fixture format, and replay them through the TypeScript.
  - Plant a wrong expectation, and confirm the replay catches it.
  - For output formats, compare pixel for pixel with the desktop.
  - For data, check every entry against its cited source.
- **Read the risky code,** not just the tests.
- **Report in plain language:**
  - a verdict (ready or not);
  - what you verified yourself;
  - what the owner will notice;
  - what nobody verified;
  - anything the report got wrong.
- **Correct your own earlier claims** when a check disproves them.

**Subagents:** spawn them only when the owner asks. Give them a self-contained prompt:
- the repo and the docs to read;
- exact scope, and what not to touch;
- the process rules above;
- the full check list;
- what to report back.

## Data, privacy, safety

- **Never invent data.** Colour tables, measurements and file-format facts need a real,
  cited source, with its provenance written down (see `web/src/yarn/data/README.md`). If
  there's no trustworthy source, leave it out and say so.
- **Untracked personal files in the repo root** (listed in `.git/info/exclude`, such as the
  owner's notes) are private. Never commit, quote or name them in anything pushed: the
  repo is **public**.
- `saved/` holds the owner's real projects. Read them for testing; never modify or commit
  them.
- **`.alpha` compatibility with the desktop is a hard requirement,** in both directions.
  Round-trip through `scripts/desktop_import.py load` when storage or editing changes.
  Keep the `start_direction` load-default asymmetry; the Rules explain why.
- **Undo restores exactly.** Structural edits that lose Work progress ask first.

## Hosting and deploys (Cloudflare Workers static assets)

- **Production:** every merge to `main` deploys automatically to
  https://alpha-pattern-editor.8b2mbys5sy.workers.dev (config: `web/wrangler.jsonc`,
  `web/public/_headers`, setup in `web/README.md`).
- **Previews:** every PR gets its own preview build. Cloudflare's bot
  (`cloudflare-workers-and-pages`) comments on the PR with a "Preview URL" for the latest
  commit, and a "View logs" link when a build fails.
- **Each address has its own browser storage:** a preview starts with an empty library.
- **Caching:** `/assets`, `/pyodide` and `/py` are cached as immutable, so any file there
  must carry a hash or version in its name (`e2e/bundle.spec.ts` enforces it).
- **When a Cloudflare build fails,** read its log rather than guessing:
  1. Get the build id from the PR's check run: `gh api
     repos/<owner>/<repo>/commits/<sha>/check-runs`, field `details_url`.
  2. Fetch the log from
     `GET https://api.cloudflare.com/client/v4/accounts/<account>/builds/builds/<id>/logs`.
     The owner may have a read-only token (Workers Builds Configuration: Read) in
     `~/.config/cf-alpha-builds-token`. Use it inline in `curl`, and never print it.

## Environment notes

- In a worktree, the isolation guard rejects compound shell commands (`cd … && …`,
  heredocs with `npx`, `git -C`, runtime-computed `gh` arguments). Use absolute paths,
  `npm --prefix web …`, and scripts written to a scratch directory.
- In a worktree, run `npm ci --prefix web`. Don't symlink `node_modules` from the main
  checkout if you'll install anything.
- zsh expands unquoted globs such as `--include=*.ts`, so quote them.

## Talking to the owner

- **Plain language first:** what happened, what it means for them, and what to do next.
  Use exact commands and the names of the buttons they'll see.
- Give results as numbers you measured, not adjectives, and separate what you verified
  from what you're assuming.
- Recommend one option, rather than listing every option equally.
- **Ask before anything irreversible or outward-facing:**
  - merging;
  - deleting a remote branch that isn't merged yet;
  - publishing private material;
  - retiring the desktop app.
