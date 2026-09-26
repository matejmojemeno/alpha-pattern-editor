"""fixtures/logic_golden.json and fixtures/edit_golden.json must match what readout.py,
work.py and edit.py do today.

Those files are the contract the TypeScript ports of the readout, progress and editing
logic are tested against. If the Python changes and the file isn't regenerated, the TS suite keeps
passing against the old behaviour, and the two implementations drift apart without
anyone noticing. Failing here stops that at the source.
"""
from __future__ import annotations

import importlib.util
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _generator():
    spec = importlib.util.spec_from_file_location(
        "gen_fixtures", os.path.join(ROOT, "scripts", "gen_fixtures.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_committed_fixtures_match_the_python():
    for path, text in _generator().outputs():
        with open(path, encoding="utf-8") as fh:
            committed = fh.read()
        assert committed == text, (
            f"{os.path.relpath(path, ROOT)} is stale: run `python scripts/gen_fixtures.py` "
            "and commit it, then update the TypeScript port to match")


def test_generation_is_deterministic():
    """Two builds in one process must agree, or the staleness check above is noise.
    For edit.py that means the uuid4 ids it makes up are recorded as a marker."""
    gen = _generator()
    assert gen.outputs() == gen.outputs()


def test_edit_fixtures_cover_every_public_function():
    """Every public function in edit.py is recorded, and every ValueError it can raise."""
    import inspect

    from alphareader.core import edit
    gen = _generator()
    with open(gen.EDIT_OUT, encoding="utf-8") as fh:
        data = json.load(fh)
    public = {n for n, f in inspect.getmembers(edit, inspect.isfunction)
              if not n.startswith("_") and f.__module__ == edit.__name__}
    assert {c["fn"] for c in data["cases"]} == public
    messages = {c.get("message") for c in data["cases"] if c.get("raises") == "ValueError"}
    source = inspect.getsource(edit)
    for msg in ("Border removal would leave an empty pattern.", "Cannot delete the last row.",
                "Cannot delete the last column.", "Cannot remove the only colour.",
                "Replacement colour must differ from the deleted one.",
                "Scale factor must be a positive integer.",
                "Target size must be at least the current size (this only pads)."):
        assert msg in source and msg in messages, msg
    assert source.count("raise ValueError") == 9, "a new ValueError path needs a fixture"
    assert any(c.get("raises") == "KeyError" for c in data["cases"])
    news = [c for c in data["cases"] if data["new_id"] in c.get("result", {}).get("row_ids", [])]
    assert news, "fresh row ids are recorded"


def test_fixtures_cover_the_awkward_states():
    """Guard the corpus itself, so trimming it can't quietly drop what makes it useful."""
    with open(_generator().OUT, encoding="utf-8") as fh:
        data = json.load(fh)
    patterns = [c["pattern"] for c in data["cases"]]
    combos = {(p["bottom_up"], p["start_direction"], p["alternate_direction"])
              for p in patterns}
    assert len(combos) == 8, "every bottom_up x start x alternate combination"
    assert any(p["rows"] % 2 == 0 for p in patterns) and \
           any(p["rows"] % 2 == 1 for p in patterns)
    assert any(p["rows"] == 1 and p["cols"] == 1 for p in patterns)
    assert any(data["skip_index"] in sum(p["cells"], []) for p in patterns)

    steps = [st for c in data["cases"] for s in c["work"]["scenarios"] for st in s["steps"]]
    assert any(st["is_complete"] for st in steps)
    assert any(st["progress"]["current_run_stitches"] > 0 for st in steps)
    assert any(st["args"] and st["args"][0] < 0 for st in steps), "out-of-range indices"
    assert {st["op"] for st in steps} >= {
        "advance", "retreat", "complete_current_row", "go_previous_row",
        "set_run_index", "mark_segment_complete", "set_run_stitches", "ensure_started"}
