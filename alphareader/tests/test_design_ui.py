"""Offscreen smoke tests for the Design stage window (§6.2)."""
from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("PySide6")
from PySide6.QtWidgets import QApplication      # noqa: E402

from ..core import edit, io                      # noqa: E402
from ..core.confirm import ConfirmState, pattern_from_preview  # noqa: E402
from ..core.detect import detect_pattern         # noqa: E402
from ..core.model import Project                 # noqa: E402
from . import synth                              # noqa: E402


@pytest.fixture(scope="module")
def qapp():
    yield QApplication.instance() or QApplication([])


def _project():
    rng = np.random.default_rng(4)
    spec = synth.SynthSpec(rows=10, cols=14,
                           palette=[(255, 255, 255), (0, 0, 0), (230, 190, 40)],
                           cells=rng.integers(0, 3, size=(10, 14)).astype(np.uint16),
                           pitch=20, margin=12)
    img = synth.render(spec)
    res = detect_pattern(img)
    pat = pattern_from_preview(ConfirmState.from_detection(img, res).preview(), "dz")
    return Project(pattern=pat), img


def test_paint_stroke_is_one_undo_step(qapp):
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    win = DesignWindow(proj, source_img=img)
    # pick a colour different from the target cells and paint a stroke
    win.color_index = 1
    win._on_pressed(0, 0)
    win._on_dragged(0, 1)
    win._on_released(0, 2)
    assert win._dirty
    assert len(win.undo_stack) == 1               # whole stroke = one step
    win._undo()
    assert not win.undo_stack and len(win.redo_stack) == 1


def test_noop_stroke_records_nothing(qapp):
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    proj.pattern = edit.fill_rect(proj.pattern, 0, 0, 0, 3, 0)   # make row 0 all colour 0
    win = DesignWindow(proj, source_img=img)
    win.color_index = 0
    win._on_pressed(0, 0); win._on_released(0, 1)
    assert not win.undo_stack                      # nothing changed => no undo entry


def test_fill_and_eyedropper(qapp):
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    win = DesignWindow(proj, source_img=img)
    win.tool = "fill"; win.color_index = 2
    win._on_pressed(0, 0)
    assert win.pattern.cells[0, 0] == 2
    win.tool = "eyedropper"
    win._on_pressed(0, 0)
    assert win.color_index == 2


def test_rect_tool(qapp):
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    win = DesignWindow(proj, source_img=img)
    win.tool = "rect"; win.color_index = 1
    win._on_pressed(1, 1); win._on_dragged(3, 4); win._on_released(3, 4)
    assert np.all(win.pattern.cells[1:4, 1:5] == 1)


def test_structural_and_undo_redo(qapp):
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    win = DesignWindow(proj, source_img=img)
    r0, c0 = win.pattern.rows, win.pattern.cols
    win._commit(edit.add_border(win.pattern, top=2, palette_index=0))
    assert win.pattern.rows == r0 + 2
    win._undo()
    assert win.pattern.rows == r0
    win._redo()
    assert win.pattern.rows == r0 + 2


def test_undo_cap(qapp):
    from ..ui.design.design_window import DesignWindow, UNDO_CAP
    proj, img = _project()
    win = DesignWindow(proj, source_img=img)
    for i in range(UNDO_CAP + 10):
        win._commit(edit.set_cell(win.pattern, 0, 0, i % 2))
    assert len(win.undo_stack) == UNDO_CAP


def test_palette_recolor(qapp):
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    win = DesignWindow(proj, source_img=img)
    win._commit(edit.recolor_palette_entry(win.pattern, win.pattern.palette[0].id, "#123456"))
    assert win.pattern.palette[0].hex == "#123456"


def test_delete_color_folds_to_nearest(qapp):
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    win = DesignWindow(proj, source_img=img)
    n = len(win.pattern.palette)
    win.palette_list.setCurrentRow(2)
    win._delete_color()
    assert len(win.pattern.palette) == n - 1
    assert win.pattern.cells.max() < len(win.pattern.palette)   # no dangling index


def test_scale_button(qapp):
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    win = DesignWindow(proj, source_img=img)
    r0, c0 = win.pattern.rows, win.pattern.cols
    win._scale_factor.setValue(3)
    win._scale()
    assert (win.pattern.rows, win.pattern.cols) == (r0 * 3, c0 * 3)
    assert (win._pad_w.value(), win._pad_h.value()) == (c0 * 3, r0 * 3)


def test_pad_to_size_button(qapp):
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    win = DesignWindow(proj, source_img=img)
    r0, c0 = win.pattern.rows, win.pattern.cols
    win._pad_w.setValue(c0 + 4)
    win._pad_h.setValue(r0 + 2)
    win._pad_to_size()
    assert (win.pattern.rows, win.pattern.cols) == (r0 + 2, c0 + 4)


def test_pad_target_clamped_after_undo(qapp):
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    win = DesignWindow(proj, source_img=img)
    c0 = win.pattern.cols
    win._scale_factor.setValue(2); win._scale()      # dims double, target follows
    assert win._pad_w.value() == c0 * 2
    win._undo()                                       # back to original dims
    assert win._pad_w.value() >= win.pattern.cols     # target stays valid


def test_save_and_export(qapp, tmp_path):
    from ..ui.design.design_window import DesignWindow, open_project_design
    proj, img = _project()
    path = str(tmp_path / "d.alpha")
    win = DesignWindow(proj, path=path, source_img=img)
    win._commit(edit.set_cell(win.pattern, 0, 0, 1))
    win._save()
    reopened = open_project_design(path)
    assert reopened.pattern.cells[0, 0] == 1
    png = str(tmp_path / "d.png")
    io.export_pattern_png(win.pattern, png)
    import os
    assert os.path.getsize(png) > 0


def test_start_working_persists_work_stage(qapp, tmp_path):
    """Clicking 'Start working' must persist stage=work so the project reopens in Work."""
    from ..ui.design.design_window import DesignWindow
    proj, img = _project()
    path = str(tmp_path / "d.alpha")
    io.save_project(proj, path, source_img=img)
    win = DesignWindow(proj, path=path, source_img=img)
    win._open_work()
    reloaded = io.load_project(path)
    assert reloaded.stage == "work"


def test_no_progress_ui(qapp):
    """§6.1: the Design window shows no progress state."""
    import inspect
    from ..ui.design import design_window
    src = inspect.getsource(design_window)
    assert "completed_row_ids" not in src and "ProgressBar" not in src
