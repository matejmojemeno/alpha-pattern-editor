"""Offscreen smoke tests for the Work stage window (§6.3)."""
from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("PySide6")
from PySide6.QtWidgets import QApplication      # noqa: E402

from ..core import io, work                      # noqa: E402
from ..core.confirm import ConfirmState, pattern_from_preview  # noqa: E402
from ..core.detect import detect_pattern         # noqa: E402
from ..core.model import PaletteEntry, Pattern, Project  # noqa: E402
from ..core.readout import encode_row            # noqa: E402
from . import synth                              # noqa: E402


def _segmented_project():
    """A project whose current row has several distinct colour segments."""
    cells = np.array([[0, 0, 0, 1, 1, 0, 0, 2, 2, 2, 0, 0]] * 4, dtype=np.uint16)
    palette = [PaletteEntry("a", "#ffffff", "White"), PaletteEntry("b", "#000000", "Black"),
               PaletteEntry("c", "#e6be28", "Gold")]
    pat = Pattern(id="x", name="seg", created_at=0, updated_at=0, cols=12, rows=4,
                  row_ids=[f"r{i}" for i in range(4)], cells=cells, palette=palette)
    return Project(pattern=pat)


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


def test_segment_dialog_actions(qapp):
    from ..ui.work.work_window import SegmentDialog
    from ..core.model import PaletteEntry
    dlg = SegmentDialog(None, PaletteEntry("a", "#ffffff", "White"), count=5, done=2)
    assert dlg.stitches() == 2 and dlg.mark_complete is False
    dlg._complete()
    assert dlg.mark_complete is True


def test_chip_click_marks_segment_and_previous(qapp, monkeypatch):
    from ..ui.work import work_window as ww
    proj = _segmented_project()
    win = ww.WorkWindow(proj)

    class FakeDlg:                                   # "Mark segment complete"
        def __init__(self, *a): self.mark_complete = True
        def exec(self): from PySide6.QtWidgets import QDialog; return QDialog.Accepted
        def stitches(self): return 0
    monkeypatch.setattr(ww, "SegmentDialog", FakeDlg)

    win._on_chip_clicked(1)                          # complete the 2nd segment
    # segments 0 and 1 are now done -> cursor sits on segment 2
    assert proj.progress.current_run_index == 2
    assert proj.progress.current_run_stitches == 0
    assert win._dirty


def test_chip_click_records_partial_stitches(qapp, monkeypatch):
    from ..ui.work import work_window as ww
    proj = _segmented_project()
    win = ww.WorkWindow(proj)
    runs = encode_row(proj.pattern, work.row_index(proj.pattern, proj.progress.current_row_id))

    class FakeDlg:                                   # "2 stitches of segment 1"
        def __init__(self, *a): self.mark_complete = False
        def exec(self): from PySide6.QtWidgets import QDialog; return QDialog.Accepted
        def stitches(self): return 2
    monkeypatch.setattr(ww, "SegmentDialog", FakeDlg)

    win._on_chip_clicked(1)
    assert proj.progress.current_run_index == 1 and proj.progress.current_run_stitches == 2


def test_start_side_toggle(qapp):
    from ..ui.work.work_window import WorkWindow
    proj, img = _project()
    win = WorkWindow(proj, source_img=img)
    assert proj.pattern.start_direction == "RTL"          # app default: right-to-left
    assert win.start_right_act.isChecked()
    assert "←" in win.row_label.text()                     # row 1 arrow points left
    win._set_start_right(False)
    assert proj.pattern.start_direction == "LTR"
    assert "→" in win.row_label.text() and win._dirty


def test_complete_and_previous_buttons(qapp):
    from ..ui.work.work_window import WorkWindow
    proj, img = _project()
    win = WorkWindow(proj, source_img=img)
    first = proj.progress.current_row_id
    win._complete_row()
    assert first in proj.progress.completed_row_ids   # whole row completed
    win._previous_row()
    assert first not in proj.progress.completed_row_ids  # reopened


def test_keys_navigate_rows(qapp):
    """Space completes the row (keyPressEvent); Right/Left navigate rows (shortcuts)."""
    from PySide6.QtCore import Qt
    from PySide6.QtGui import QKeyEvent, QShortcut
    from ..ui.work.work_window import WorkWindow
    proj, img = _project()
    win = WorkWindow(proj, source_img=img)
    shortcuts = {s.key().toString(): s for s in win.findChildren(QShortcut)}
    assert {"Left", "Right", "Up", "Down"} <= set(shortcuts)

    first = proj.progress.current_row_id
    win.keyPressEvent(QKeyEvent(QKeyEvent.KeyPress, Qt.Key_Space, Qt.NoModifier))
    assert first in proj.progress.completed_row_ids          # space completed the row
    second = proj.progress.current_row_id
    shortcuts["Right"].activated.emit()
    assert second in proj.progress.completed_row_ids          # right completed the next row
    shortcuts["Left"].activated.emit()
    assert second not in proj.progress.completed_row_ids       # left reopened it


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
