"""Tests for the confirmation re-derivation (§7.2) and .alpha persistence (§8)."""
from __future__ import annotations

import numpy as np
import pytest

from ..core import io
from ..core.confirm import ConfirmState, Extent, pattern_from_preview, resample
from ..core.detect import detect_pattern
from ..core.model import Progress, Project
from . import synth


def _sample_project():
    rng = np.random.default_rng(7)
    palette = [(255, 255, 255), (0, 0, 0), (230, 190, 40)]
    cells = rng.integers(0, 3, size=(12, 18)).astype(np.uint16)
    spec = synth.SynthSpec(rows=12, cols=18, palette=palette, cells=cells, pitch=20, margin=15)
    img = synth.render(spec)
    result = detect_pattern(img)
    state = ConfirmState.from_detection(img, result)
    pattern = pattern_from_preview(state.preview(), "test")
    return img, pattern


def test_confirm_matches_detection():
    """Re-deriving with the detected extent/dims reproduces the detection result."""
    rng = np.random.default_rng(11)
    spec = synth.SynthSpec(rows=15, cols=22,
                           palette=[(255, 255, 255), (40, 120, 200), (0, 0, 0)],
                           cells=rng.integers(0, 3, size=(15, 22)).astype(np.uint16),
                           pitch=18, margin=12)
    img = synth.render(spec)
    result = detect_pattern(img)
    state = ConfirmState.from_detection(img, result)
    prev = state.preview()
    assert (prev.rows, prev.cols) == (result.rows, result.cols)
    assert np.array_equal(prev.cells, result.cells)


def test_spinner_changes_dims():
    """Changing rows/cols re-derives the lattice from the same extent."""
    img, _ = _sample_project()
    result = detect_pattern(img)
    state = ConfirmState.from_detection(img, result)
    r0, c0 = state.rows, state.cols
    state.set_dims(rows=r0 + 3, cols=c0 + 2)
    prev = state.preview()
    assert prev.rows == r0 + 3 and prev.cols == c0 + 2
    assert prev.cells.shape == (r0 + 3, c0 + 2)


def test_delta_e_slider_changes_palette_count():
    """A larger ΔE merges colors; a tiny ΔE splits them."""
    rng = np.random.default_rng(3)
    palette = [(255, 255, 255), (200, 40, 40), (210, 55, 55)]   # two near reds
    cells = rng.integers(0, 3, size=(14, 20)).astype(np.uint16)
    spec = synth.SynthSpec(rows=14, cols=20, palette=palette, cells=cells, pitch=18, margin=10)
    img = synth.render(spec)
    result = detect_pattern(img)
    state = ConfirmState.from_detection(img, result)
    state.set_delta_e(2.0)
    n_tight = len(state.preview().palette)
    state.set_delta_e(15.0)
    n_loose = len(state.preview().palette)
    assert n_loose <= n_tight


def test_crop_resample():
    """resample honors a sub-region extent."""
    img, _ = _sample_project()
    h, w = img.shape[:2]
    prev = resample(img, Extent(w * 0.2, h * 0.2, w * 0.8, h * 0.8), 8, 10, 6.0)
    assert prev.cells.shape == (8, 10)


def test_pattern_has_stable_row_ids():
    _, pattern = _sample_project()
    assert len(pattern.row_ids) == pattern.rows
    assert len(set(pattern.row_ids)) == pattern.rows       # all unique


def test_alpha_roundtrip(tmp_path):
    img, pattern = _sample_project()
    project = Project(pattern=pattern, progress=Progress(), stage="design")
    path = str(tmp_path / "p.alpha")
    io.save_project(project, path, source_img=img)

    loaded = io.load_project(path)
    assert loaded.pattern.rows == pattern.rows
    assert loaded.pattern.cols == pattern.cols
    assert loaded.pattern.row_ids == pattern.row_ids
    assert np.array_equal(loaded.pattern.cells, pattern.cells)
    assert [e.hex for e in loaded.pattern.palette] == [e.hex for e in pattern.palette]
    assert loaded.stage == "design"

    src = io.load_source_image(path)
    assert src is not None and src.shape == img.shape


def test_save_project_does_not_mutate_its_argument(tmp_path):
    """Saving stamps a new `updated_at` on a copy, never on the caller's object.

    Everything else in core/ returns new objects; save_project used to be the one
    exception, rewriting `project.pattern.updated_at` in place. That is invisible to a
    caller rendering from the object it passed in."""
    img, pattern = _sample_project()
    project = Project(pattern=pattern, progress=Progress(), stage="design")
    before = pattern.updated_at

    saved = io.save_project(project, str(tmp_path / "p.alpha"), source_img=img,
                            now=before + 1000.0)

    assert pattern.updated_at == before, "caller's Pattern was mutated"
    assert project.pattern is pattern, "caller's Project was rebound"
    assert saved.pattern.updated_at == before + 1000.0
    assert saved.pattern is not pattern
    # The copy must still share the unchanged payload rather than duplicating it.
    assert saved.pattern.cells is pattern.cells
    assert saved.stage == project.stage
    assert saved.progress is project.progress


def test_saved_updated_at_is_what_lands_on_disk(tmp_path):
    img, pattern = _sample_project()
    path = str(tmp_path / "p.alpha")
    saved = io.save_project(Project(pattern=pattern), path, source_img=img)
    assert io.load_project(path).pattern.updated_at == saved.pattern.updated_at


def test_alpha_rejects_newer_major(tmp_path):
    import json, zipfile
    path = str(tmp_path / "future.alpha")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("meta.json", json.dumps({"format_version": 999}))
        z.writestr("pattern.json", "{}")
        z.writestr("progress.json", "{}")
        z.writestr("cells.npy", b"")
    with pytest.raises(ValueError):
        io.load_project(path)


def test_default_save_path_in_saved_dir():
    _, pattern = _sample_project()
    path = io.default_save_path(pattern)
    assert path.endswith(".alpha")
    assert io.SAVED_DIR in path


def test_list_saved_projects(tmp_path):
    img, pattern = _sample_project()
    proj = Project(pattern=pattern, progress=Progress({pattern.row_ids[0]}), stage="work")
    p1 = str(tmp_path / "a.alpha")
    io.save_project(proj, p1, source_img=img)
    summaries = io.list_saved_projects(str(tmp_path))
    assert len(summaries) == 1
    s = summaries[0]
    assert s.name == pattern.name
    assert (s.rows, s.cols) == (pattern.rows, pattern.cols)
    assert 0 < s.progress_pct <= 100
    assert s.thumbnail_png is not None


def test_bottom_up_persists(tmp_path):
    img, pattern = _sample_project()
    pattern.bottom_up = False
    path = str(tmp_path / "b.alpha")
    io.save_project(Project(pattern=pattern), path, source_img=img)
    assert io.load_project(path).pattern.bottom_up is False


def test_progress_roundtrip(tmp_path):
    img, pattern = _sample_project()
    prog = Progress(completed_row_ids={pattern.row_ids[0], pattern.row_ids[1]},
                    current_row_id=pattern.row_ids[2], current_run_index=3,
                    started_at=123.0)
    project = Project(pattern=pattern, progress=prog, stage="work")
    path = str(tmp_path / "p.alpha")
    io.save_project(project, path, source_img=img)
    loaded = io.load_project(path)
    assert loaded.progress.completed_row_ids == prog.completed_row_ids
    assert loaded.progress.current_row_id == prog.current_row_id
    assert loaded.progress.current_run_index == 3
    assert loaded.stage == "work"
