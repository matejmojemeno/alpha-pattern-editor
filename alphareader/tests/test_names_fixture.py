"""fixtures/colour_names.json must match what the Python names colours today.

It is what web/tests/importer/names.test.ts proves the TypeScript colour names against.
If names.py, colour_names.json or palette.py's Lab conversion changes and the file isn't
regenerated, the two could drift apart unnoticed.
"""
from __future__ import annotations

import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _generator():
    spec = importlib.util.spec_from_file_location(
        "gen_names_fixture", os.path.join(ROOT, "scripts", "gen_names_fixture.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_committed_names_fixture_matches_the_python():
    for path, text in _generator().outputs():
        with open(path, encoding="utf-8") as fh:
            assert fh.read() == text, (
                f"{os.path.relpath(path, ROOT)} is stale: run `python scripts/gen_names_fixture.py`")
