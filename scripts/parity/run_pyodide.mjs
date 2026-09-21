// Run scripts/parity/digest.py inside Pyodide over a directory of raw-RGB .npy files.
//
// The repo is mounted into Pyodide's virtual filesystem rather than copied, so the
// *same* alphareader/core source runs under both runtimes — there is no build step to
// drift out of date.
//
//   node run_pyodide.mjs <repo-root> <npy-dir> <out.json>
import { loadPyodide } from "pyodide";
import fs from "node:fs";
import path from "node:path";

const [repoRoot, npyDir, outPath] = process.argv.slice(2);
if (!repoRoot || !npyDir || !outPath) {
  console.error("usage: node run_pyodide.mjs <repo-root> <npy-dir> <out.json>");
  process.exit(2);
}

const timing = {};
let t0 = performance.now();
const py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
timing.boot_ms = +(performance.now() - t0).toFixed(1);

t0 = performance.now();
// Load scipy only if the tree still imports it, so the harness keeps working either way
// (and so a stray re-import shows up as a load failure rather than passing silently).
const detectDir = path.join(repoRoot, "alphareader/core/detect");
const needsScipy = fs
  .readdirSync(detectDir)
  .filter((f) => f.endsWith(".py"))
  .some((f) =>
    /^\s*(import scipy|from scipy)/m.test(
      fs.readFileSync(path.join(detectDir, f), "utf8"),
    ),
  );
await py.loadPackage(needsScipy ? ["numpy", "scipy"] : ["numpy"]);
timing.load_pkgs_ms = +(performance.now() - t0).toFixed(1);
timing.scipy_loaded = needsScipy;

py.mountNodeFS("/repo", repoRoot);
py.mountNodeFS("/npy", npyDir);

t0 = performance.now();
// Import digest.py as a module rather than splicing its source into this block: inlining
// puts its `from __future__` line after our imports, which is a SyntaxError.
const out = py.runPython(`
import sys, json, glob
sys.path.insert(0, "/repo")
sys.path.insert(0, "/repo/scripts/parity")
import digest
json.dumps(digest.main(sorted(glob.glob("/npy/*.npy"))))
`);
timing.detect_all_ms = +(performance.now() - t0).toFixed(1);

const parsed = JSON.parse(out);
parsed.timing = timing;
fs.writeFileSync(outPath, JSON.stringify(parsed));
console.log(JSON.stringify(timing));
