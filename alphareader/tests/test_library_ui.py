"""Offscreen smoke tests for the project library (§8)."""
from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("PySide6")
from PySide6.QtWidgets import QApplication      # noqa: E402

from ..core import io                            # noqa: E402
from ..core.confirm import ConfirmState, pattern_from_preview  # noqa: E402
from ..core.detect import detect_pattern         # noqa: E402
from ..core.model import Progress, Project        # noqa: E402
from . import synth                              # noqa: E402


@pytest.fixture(scope="module")
def qapp():
    yield QApplication.instance() or QApplication([])


def _make_saved_project(directory):
    rng = np.random.default_rng(2)
    spec = synth.SynthSpec(rows=10, cols=14,
                           palette=[(255, 255, 255), (0, 0, 0), (230, 190, 40)],
                           cells=rng.integers(0, 3, size=(10, 14)).astype(np.uint16),
                           pitch=20, margin=12)
    img = synth.render(spec)
    res = detect_pattern(img)
    pat = pattern_from_preview(ConfirmState.from_detection(img, res).preview(), "lib-demo")
    proj = Project(pattern=pat, progress=Progress({pat.row_ids[0], pat.row_ids[1]}))
    io.save_project(proj, str(directory / "demo.alpha"), source_img=img)


def test_library_shows_saved_cards(qapp, tmp_path, monkeypatch):
    monkeypatch.setattr(io, "SAVED_DIR", str(tmp_path))
    _make_saved_project(tmp_path)
    from ..ui.library.library_window import LibraryWindow
    win = LibraryWindow()
    win.reload()
    assert win.grid.count() == 1
    assert win.empty_label.isHidden()


def test_card_delete_button_emits_path(qapp):
    from ..ui.library.library_window import ProjectCard
    summary = io.ProjectSummary(path="/x/y.alpha", name="n", rows=5, cols=5,
                                progress_pct=0.0, updated_at=0.0, thumbnail_png=None)
    card = ProjectCard(summary)
    got = []
    card.deleteRequested.connect(got.append)
    card.delete_btn.click()
    assert got == ["/x/y.alpha"]


def test_delete_project_removes_file_and_card(qapp, tmp_path, monkeypatch):
    import os
    from PySide6.QtWidgets import QMessageBox
    monkeypatch.setattr(io, "SAVED_DIR", str(tmp_path))
    _make_saved_project(tmp_path)
    from ..ui.library.library_window import LibraryWindow
    win = LibraryWindow()
    win.reload()
    assert win.grid.count() == 1
    path = win.grid.itemAt(0).widget().path
    # auto-confirm the "are you sure?" dialog
    monkeypatch.setattr(QMessageBox, "question", staticmethod(lambda *a, **k: QMessageBox.Yes))
    win._delete_project(path)
    assert not os.path.exists(path)
    assert win.grid.count() == 0


def test_delete_project_refuses_non_alpha():
    import pytest
    with pytest.raises(ValueError):
        io.delete_project("/tmp/not-a-project.txt")


def test_library_empty_state(qapp, tmp_path, monkeypatch):
    monkeypatch.setattr(io, "SAVED_DIR", str(tmp_path))
    from ..ui.library.library_window import LibraryWindow
    win = LibraryWindow()
    win.reload()
    assert win.grid.count() == 0
    assert not win.empty_label.isHidden()


def test_library_watches_and_refreshes(qapp, tmp_path, monkeypatch):
    monkeypatch.setattr(io, "SAVED_DIR", str(tmp_path))
    from ..ui.library.library_window import LibraryWindow
    win = LibraryWindow()
    win.reload()
    assert win.grid.count() == 0
    assert str(tmp_path) in win._watcher.directories()   # saved/ is watched

    _make_saved_project(tmp_path)                         # a project appears on disk
    win.reload()                                          # what the watcher triggers
    assert win.grid.count() == 1
    assert any("demo.alpha" in f for f in win._watcher.files())  # now watched too


def test_library_no_reload_after_close(qapp, tmp_path, monkeypatch):
    """Regression: a queued watcher/timer event must not reload a closing window
    (that raised 'Internal C++ object already deleted' on quit)."""
    monkeypatch.setattr(io, "SAVED_DIR", str(tmp_path))
    from ..ui.library.library_window import LibraryWindow
    win = LibraryWindow()
    win.close()
    assert win._closing
    assert not win._reload_timer.isActive()
    win._schedule_reload()          # a late filesystem event arriving during shutdown
    win.reload()                    # must be a no-op, not touch deleted children
    # changeEvent backstop must also stay quiet while closing
    from PySide6.QtCore import QEvent
    win.changeEvent(QEvent(QEvent.ActivationChange))


def test_project_card_opens(qapp):
    from ..ui.library.library_window import ProjectCard
    summary = io.ProjectSummary(path="/x/y.alpha", name="n", rows=5, cols=5,
                                progress_pct=40.0, updated_at=0.0, thumbnail_png=None)
    card = ProjectCard(summary)
    received = []
    card.opened.connect(received.append)
    card.mousePressEvent(None)                # emits opened(path) regardless of event
    assert received == ["/x/y.alpha"]
