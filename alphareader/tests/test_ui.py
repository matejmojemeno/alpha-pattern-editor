"""Offscreen smoke tests for the import/confirmation window (§7). No display needed."""
from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("PySide6")
from PySide6.QtWidgets import QApplication      # noqa: E402

from ..core import io                            # noqa: E402
from ..core.confirm import pattern_from_preview  # noqa: E402
from ..core.model import Project                 # noqa: E402
from . import synth                              # noqa: E402


@pytest.fixture(scope="module")
def qapp():
    app = QApplication.instance() or QApplication([])
    yield app


def _chart():
    rng = np.random.default_rng(9)
    spec = synth.SynthSpec(rows=14, cols=20,
                           palette=[(255, 255, 255), (0, 0, 0), (230, 190, 40)],
                           cells=rng.integers(0, 3, size=(14, 20)).astype(np.uint16),
                           pitch=20, margin=14)
    return synth.render(spec)


def test_window_loads_and_confirms(qapp):
    from ..ui.importer.confirm_window import ConfirmWindow
    win = ConfirmWindow()
    win.load_array(_chart())
    assert win.state is not None
    prev = win.state.preview()
    assert (prev.rows, prev.cols) == (14, 20)
    assert win.palette_list.count() == len(prev.palette)
    assert "20 cols × 14 rows" in win.status_label.text()


def test_spinner_and_slider_update_preview(qapp):
    from ..ui.importer.confirm_window import ConfirmWindow
    win = ConfirmWindow()
    win.load_array(_chart())
    win.rows_spin.setValue(16)
    assert win.state.rows == 16
    assert win.state.preview().cells.shape[0] == 16
    win.dE_slider.setValue(12)
    assert win.state.delta_e == 12.0


def test_crop_redetects(qapp):
    from ..ui.importer.confirm_window import ConfirmWindow
    win = ConfirmWindow()
    img = _chart()
    win.load_array(img)
    h, w = img.shape[:2]
    win._on_crop_requested(0, 0, w, h)
    assert win.state is not None
    assert (win.state.rows, win.state.cols) == (14, 20)


def test_failure_state_keeps_source(qapp):
    from ..ui.importer.confirm_window import ConfirmWindow
    win = ConfirmWindow()
    win.load_array(np.full((40, 40, 3), 255, np.uint8))   # blank: no gridlines
    assert win.state is None                               # detection refused
    assert win.crop_btn.isEnabled()                        # crop escape hatch offered
    assert not win.commit_btn.isEnabled()


def test_paste_path_produces_owned_image(qapp):
    """Regression: the pasted image must own its buffer, not alias Qt's (which dangles
    and garbles/crashes on re-detect). Use a width with no row padding to hit the
    previously-buggy no-copy branch."""
    import gc
    from PySide6.QtGui import QImage
    w, h = 8, 6                              # w*3 == 24, 4-aligned => bytesPerLine == w*3
    qi = QImage(w, h, QImage.Format_RGB888)
    qi.fill(0x3366CC)
    from ..ui.importer.confirm_window import ConfirmWindow
    win = ConfirmWindow()
    win._load_qimage(qi)
    got = win.img.copy()
    del qi
    gc.collect()
    assert win.img.shape == (h, w, 3)
    assert win.img.base is None or not isinstance(win.img.base, (bytes, bytearray, memoryview))
    assert np.array_equal(win.img, got)      # unchanged after source freed + GC
    assert tuple(win.img[0, 0]) == (0x33, 0x66, 0xCC)


def test_commit_writes_alpha(qapp, tmp_path):
    from ..ui.importer.confirm_window import ConfirmWindow
    win = ConfirmWindow()
    win.load_array(_chart())
    pattern = pattern_from_preview(win.state.preview(), "smoke")
    path = str(tmp_path / "smoke.alpha")
    io.save_project(Project(pattern=pattern, stage="design"), path, source_img=win.img)
    loaded = io.load_project(path)
    assert (loaded.pattern.rows, loaded.pattern.cols) == (14, 20)
