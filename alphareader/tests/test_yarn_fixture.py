"""fixtures/yarn_nearest.json must match what the Python's colour matching does today.

It is what web/tests/yarn/match.test.ts proves the TypeScript nearest-shade match against.
If palette.py's Lab conversion, or a library in web/src/yarn/data/, changes and the file
isn't regenerated, the two could drift apart unnoticed.
"""
from __future__ import annotations

import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _generator():
    spec = importlib.util.spec_from_file_location(
        "gen_yarn_fixture", os.path.join(ROOT, "scripts", "gen_yarn_fixture.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_committed_yarn_fixture_matches_the_python():
    for path, text in _generator().outputs():
        with open(path, encoding="utf-8") as fh:
            assert fh.read() == text, (
                f"{os.path.relpath(path, ROOT)} is stale: run `python scripts/gen_yarn_fixture.py`")
