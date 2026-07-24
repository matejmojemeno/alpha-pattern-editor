"""Offscreen smoke tests for the Work stage window (§6.3)."""
from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("PySide6")
from PySide6.QtWidgets import QApplication      # noqa: E402

from ..core import io, work                      # noqa: E402
from ..core.confirm import ConfirmState, pattern_from_preview  # noqa: E402
from ..core.detect import detect_pattern         # noqa: E402
from ..core.model import Project                 # noqa: E402
from . import synth                              # noqa: E402


@pytest.fixture(scope="module")
def qapp():
    yield QApplication.instance() or QApplication([])


def _project():
    rng = np.random.default_rng(5)
    spec = synth.SynthSpec(rows=10, cols=16,
                           palette=[(255, 255, 255), (0, 0, 0), (230, 190, 40)],
                           cells=rng.integers(0, 3, size=(10, 16)).astype(np.uint16),
                           pitch=20, margin=12)
    img = synth.render(spec)
    res = detect_pattern(img)
    pat = pattern_from_preview(ConfirmState.from_detection(img, res).preview(), "wk")
    return Project(pattern=pat), img


def test_work_window_starts_on_first_row(qapp):
    from ..ui.work.work_window import WorkWindow
    proj, img = _project()
    win = WorkWindow(proj, source_img=img)
    assert proj.progress.started_at is not None
    assert "Row 1 of" in win.row_label.text()
    assert win.chips._layout.count() >= 1


def test_complete_and_previous_buttons(qapp):
    from ..ui.work.work_window import WorkWindow
    proj, img = _project()
    win = WorkWindow(proj, source_img=img)
    first = proj.progress.current_row_id
    win._complete_row()
    assert first in proj.progress.completed_row_ids   # whole row completed
    win._previous_row()
    assert first not in proj.progress.completed_row_ids  # reopened


def test_arrow_keys_advance_runs(qapp):
    from ..ui.work.work_window import WorkWindow
    proj, img = _project()
    win = WorkWindow(proj, source_img=img)
    win._advance_run()
    win._retreat_run()  # should not raise


def test_finishing_marks_complete(qapp):
    from ..ui.work.work_window import WorkWindow
    proj, img = _project()
    win = WorkWindow(proj, source_img=img)
    for _ in range(2000):
        if work.is_complete(proj.pattern, proj.progress):
            break
        win._complete_row()
    assert work.is_complete(proj.pattern, proj.progress)
    assert "Finished" in win.row_label.text()
    assert not win.complete_btn.isEnabled()


def test_focus_and_high_contrast_toggles(qapp):
    from ..ui.work.work_window import WorkWindow
    proj, img = _project()
    win = WorkWindow(proj, source_img=img)
    win._set_focus_mode(True)
    assert not win.next_label.isVisible()
    win._set_high_contrast(True)
    assert win.styleSheet() != ""
    win._set_focus_mode(False)
    win._set_high_contrast(False)


def test_save_roundtrip(qapp, tmp_path):
    from ..ui.work.work_window import WorkWindow, open_project_work
    proj, img = _project()
    path = str(tmp_path / "wk.alpha")
    io.save_project(proj, path, source_img=img)
    win = WorkWindow(proj, path=path, source_img=img)
    win._complete_row()
    win._save()
    reopened = open_project_work(path)
    assert reopened.project.progress.completed_row_ids == proj.progress.completed_row_ids
    assert reopened.project.stage == "work"


def test_default_save_path_used_when_none(qapp, tmp_path):
    from ..ui.work.work_window import WorkWindow
    proj, img = _project()
    win = WorkWindow(proj, path=None, source_img=img)
    assert win.path.endswith(".alpha") and "saved" in win.path


def test_no_edit_api_on_window(qapp):
    """§13.7: the Work window exposes no cell-mutation entry point."""
    from ..ui.work import work_window
    src = __import__("inspect").getsource(work_window)
    assert "set_cell" not in src and "flood_fill" not in src and "fill_rect" not in src
