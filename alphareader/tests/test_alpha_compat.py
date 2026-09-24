"""`.alpha` files written by the web app's TypeScript storage layer must open here.

The web app replaces io.py with web/src/storage/, and a project has to move freely
between the two: exported from a browser and opened on the desktop, or the other way
round. fixtures/alpha/from-ts/ holds archives the TS layer wrote (regenerate with
`npm run gen:alpha` in web/), and each one must load through io.load_project with the
cells, palette, row_ids, direction flags and progress the TS side recorded.

The other direction, desktop-written files read by TS, is tested in web/tests/storage/
against fixtures/alpha/desktop/. The check at the bottom keeps those files honest: they
must still be what io.py writes today.
"""
from __future__ import annotations

import importlib.util
import json
import os

import numpy as np
import pytest

from alphareader.core import io

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FROM_TS = os.path.join(ROOT, "fixtures", "alpha", "from-ts")
DESKTOP = os.path.join(ROOT, "fixtures", "alpha", "desktop")


def _expected(directory: str) -> dict:
    with open(os.path.join(directory, "expected.json"), encoding="utf-8") as fh:
        return json.load(fh)["files"]


FROM_TS_FILES = _expected(FROM_TS)
LOADABLE = sorted(n for n, rec in FROM_TS_FILES.items() if "rejected" not in rec)
REJECTED = sorted(n for n, rec in FROM_TS_FILES.items() if "rejected" in rec)


def test_every_archive_is_listed():
    on_disk = {n for n in os.listdir(FROM_TS) if n.endswith(".alpha")}
    assert on_disk == set(FROM_TS_FILES)
    assert REJECTED, "a format_version 999 archive written by TS"
    assert any(FROM_TS_FILES[n].get("roundtrip_of") for n in LOADABLE)


def _assert_matches(proj, want: dict, path: str) -> None:
    p, pr = proj.pattern, proj.progress
    wp, wpr = want["pattern"], want["progress"]

    assert p.cells.dtype == np.uint16
    assert p.cells.shape == (wp["rows"], wp["cols"])
    assert np.array_equal(p.cells, np.asarray(wp["cells"], dtype=np.uint16).reshape(
        wp["rows"], wp["cols"]))
    assert [vars(e) for e in p.palette] == wp["palette"]
    assert p.row_ids == wp["row_ids"]
    assert (p.id, p.name, p.rows, p.cols) == (wp["id"], wp["name"], wp["rows"], wp["cols"])
    assert (p.start_direction, p.alternate_direction, p.bottom_up) == (
        wp["start_direction"], wp["alternate_direction"], wp["bottom_up"])
    assert proj.stage == want["stage"]

    assert pr.completed_row_ids == set(wpr["completed_row_ids"])
    assert pr.current_row_id == wpr["current_row_id"]
    assert pr.current_run_index == wpr["current_run_index"]
    assert pr.current_run_stitches == wpr["current_run_stitches"]
    assert pr.started_at == wpr["started_at"]

    # Timestamps must come back as floats, as if the desktop had written them.
    assert (p.created_at, p.updated_at) == (wp["created_at"], wp["updated_at"])
    assert type(p.created_at) is float and type(p.updated_at) is float
    assert pr.started_at is None or type(pr.started_at) is float
    assert isinstance(pr.current_run_index, int) and isinstance(pr.current_run_stitches, int)

    has_source = io.load_source_image(path) is not None
    assert has_source == (want["source_png_sha256"] is not None)


@pytest.mark.parametrize("name", LOADABLE)
def test_ts_written_archive_loads(name):
    path = os.path.join(FROM_TS, name)
    _assert_matches(io.load_project(path), FROM_TS_FILES[name], path)


@pytest.mark.parametrize("name", [n for n in LOADABLE if FROM_TS_FILES[n].get("roundtrip_of")])
def test_ts_roundtrip_matches_the_desktop_original(name):
    """A desktop file, opened and saved again by TS, reads back exactly as the original."""
    original = os.path.join(DESKTOP, FROM_TS_FILES[name]["roundtrip_of"])
    a, b = io.load_project(original), io.load_project(os.path.join(FROM_TS, name))
    # Pattern == would compare the cells ndarray elementwise, so compare field by field.
    assert np.array_equal(a.pattern.cells, b.pattern.cells)
    assert a.pattern.cells.dtype == b.pattern.cells.dtype == np.uint16
    for field in ("id", "name", "created_at", "updated_at", "rows", "cols", "row_ids",
                  "palette", "start_direction", "alternate_direction", "bottom_up"):
        assert getattr(a.pattern, field) == getattr(b.pattern, field), field
    assert a.progress == b.progress
    assert a.stage == b.stage

    src_a = io.load_source_image(original)
    src_b = io.load_source_image(os.path.join(FROM_TS, name))
    assert (src_a is None) == (src_b is None)
    if src_a is not None:
        assert np.array_equal(src_a, src_b)


@pytest.mark.parametrize("directory, name", [(FROM_TS, n) for n in REJECTED]
                         + [(DESKTOP, "newer-format.alpha")])
def test_newer_format_is_rejected(directory, name):
    with pytest.raises(ValueError, match="newer version"):
        io.load_project(os.path.join(directory, name))


def test_desktop_reference_files_are_current():
    """fixtures/alpha/desktop/ must still be exactly what io.py writes and reads."""
    spec = importlib.util.spec_from_file_location(
        "gen_alpha_fixtures", os.path.join(ROOT, "scripts", "gen_alpha_fixtures.py"))
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    assert gen.check() == [], (
        "fixtures/alpha/desktop/ is stale: run `python scripts/gen_alpha_fixtures.py`, "
        "then `npm run gen:alpha` in web/, and commit both")
