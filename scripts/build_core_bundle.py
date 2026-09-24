"""Package alphareader/core/ for the browser (docs/web-port-plan.md, "Repo layout").

Writes `alphareader-core.<hash>.zip` holding `alphareader/__init__.py` and everything
under `alphareader/core/` except `io.py`, which the browser replaces with
web/src/storage/, and `__pycache__`. The web worker fetches the zip and unpacks it into
Pyodide's virtual filesystem, then imports `alphareader.core.bridge`.

The zip is deterministic (sorted entries, fixed timestamps and permissions), so the hash
in its name changes exactly when the shipped source does, and a browser can cache the
file forever.

    python scripts/build_core_bundle.py --out web/public/py

Prints a JSON line describing the file. Older bundles in the output directory are
removed. Standard library only, so any Python 3 can run it at build time.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "alphareader"
PREFIX = "alphareader-core."
EXCLUDE_NAMES = {"io.py"}
EXCLUDE_DIRS = {"__pycache__"}
# The browser has neither: io.py isn't shipped and Pillow isn't loaded.
_FORBIDDEN_IMPORT = re.compile(
    r"^\s*(?:from\s+(?:PIL|\.+io|alphareader\.core\.io)\b|import\s+(?:PIL|alphareader\.core\.io)\b)",
    re.MULTILINE,
)


def bundle_files() -> list[Path]:
    """The files to ship, sorted by their path inside the zip."""
    files = [PACKAGE / "__init__.py"]
    for path in sorted((PACKAGE / "core").rglob("*")):
        rel = path.relative_to(PACKAGE / "core")
        if not path.is_file() or (len(rel.parts) == 1 and path.name in EXCLUDE_NAMES):
            continue
        if any(part in EXCLUDE_DIRS for part in rel.parts) or path.suffix == ".pyc":
            continue
        files.append(path)
    return sorted(files, key=lambda p: p.relative_to(ROOT).as_posix())


def check_imports(files: list[Path]) -> None:
    for path in files:
        if path.suffix == ".py" and _FORBIDDEN_IMPORT.search(path.read_text("utf-8")):
            raise SystemExit(f"{path.relative_to(ROOT)} imports io.py or Pillow, which the "
                             f"browser doesn't have.")


def build_zip(files: list[Path]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(ROOT).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, path.read_bytes(), compresslevel=9)
    return buf.getvalue()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, required=True, help="output directory")
    args = ap.parse_args(argv)

    files = bundle_files()
    check_imports(files)
    data = build_zip(files)
    digest = hashlib.sha256(data).hexdigest()
    name = f"{PREFIX}{digest[:12]}.zip"

    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob(f"{PREFIX}*.zip"):
        if old.name != name:
            old.unlink()
    target = args.out / name
    if not target.exists() or target.read_bytes() != data:
        target.write_bytes(data)
    print(json.dumps({"file": name, "bytes": len(data), "sha256": digest,
                      "entries": [p.relative_to(ROOT).as_posix() for p in files]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
