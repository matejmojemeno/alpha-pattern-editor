"""Work-stage window (§6.3). Read-only, glanceable, row-by-row progress tracking.

No editing tool is present or reachable here (§13.7) — the window only ever calls the
progress operations in core.work, never a pattern mutation."""
from __future__ import annotations

import numpy as np
from PySide6.QtCore import Qt
from PySide6.QtGui import QAction, QFont, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QFileDialog, QHBoxLayout, QLabel, QMainWindow, QMessageBox, QProgressBar,
    QPushButton, QScrollArea, QVBoxLayout, QWidget,
)

from ...core import io, work
from ...core.model import Project
from ...core.readout import (
    encode_row, export_all_rows_text, format_row_text, row_direction, working_number,
)
from .chart_view import WorkChartView
from .chips import ChipsBar

_HC_STYLE = """
QMainWindow, QWidget { background:#111; color:#eee; }
QLabel { color:#eee; }
QPushButton { background:#2a2a2a; color:#fff; border:1px solid #555; padding:8px 14px; border-radius:8px; }
QPushButton:default { background:#0a7d33; border-color:#0a7d33; }
"""


class WorkWindow(QMainWindow):
    def __init__(self, project: Project, path: str | None = None,
                 source_img: np.ndarray | None = None):
        super().__init__()
        self.project = project
        self.source_img = source_img
        # Always have a save destination so saving is one click (§ user request).
        self.path = path or io.default_save_path(project.pattern)
        self.project.stage = "work"
        self._dirty = False
        self._focus_mode = False

        self.setWindowTitle(f"Working — {project.pattern.name}")
        self.resize(940, 860)
        self._build_ui()
        self._build_menu()
        # Arrow keys are otherwise eaten by Qt's widget focus-navigation before they reach
        # keyPressEvent, so bind them as window-level shortcuts instead.
        for keys, handler in ((("Right", "Down"), self._complete_row),
                              (("Left", "Up"), self._previous_row)):
            for k in keys:
                QShortcut(QKeySequence(k), self, activated=handler)
        self.project.progress = work.ensure_started(project.pattern, project.progress)
        self.refresh()

    # --- UI ------------------------------------------------------------------
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(20, 16, 20, 16)
        root.setSpacing(12)

        header = QHBoxLayout()
        self.row_label = QLabel()
        self.row_label.setFont(QFont("", 22, QFont.Bold))
        header.addWidget(self.row_label)
        header.addStretch(1)
        self.remaining_label = QLabel()
        self.remaining_label.setFont(QFont("", 13))
        header.addWidget(self.remaining_label)
        root.addLayout(header)

        self.progress_bar = QProgressBar()
        root.addWidget(self.progress_bar)

        # Body: chips in a fixed-width scrollable column on the left (so many colour
        # switches scroll instead of shrinking the chart), chart fills the rest.
        body = QHBoxLayout()
        root.addLayout(body, 1)

        left = QVBoxLayout()
        left.addWidget(QLabel("This row:"))
        self.chips = ChipsBar()
        self.chips.chipClicked.connect(self._on_chip_clicked)
        chips_scroll = QScrollArea()
        chips_scroll.setWidgetResizable(True)
        chips_scroll.setWidget(self.chips)
        chips_scroll.setFixedWidth(320)
        chips_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        left.addWidget(chips_scroll, 1)
        self.next_label = QLabel()
        self.next_label.setWordWrap(True)
        self.next_label.setStyleSheet("color:#888; font-size:12px;")
        left.addWidget(self.next_label)
        body.addLayout(left)

        # Fit-to-view chart (no scrolling; the whole image is always visible).
        self.chart = WorkChartView()
        body.addWidget(self.chart, 1)

        buttons = QHBoxLayout()
        self.back_btn = QPushButton("← Previous row")
        self.back_btn.clicked.connect(self._previous_row)
        buttons.addWidget(self.back_btn)
        self.save_btn = QPushButton("Save")
        self.save_btn.clicked.connect(self._save)
        buttons.addWidget(self.save_btn)
        buttons.addStretch(1)
        self.complete_btn = QPushButton("Row complete →")
        self.complete_btn.setDefault(True)
        self.complete_btn.setMinimumHeight(48)
        self.complete_btn.setFont(QFont("", 15, QFont.Bold))
        self.complete_btn.clicked.connect(self._complete_row)
        buttons.addWidget(self.complete_btn)
        root.addLayout(buttons)

    def _build_menu(self):
        bar = self.menuBar()
        m = bar.addMenu("Project")
        save = QAction("Save", self, shortcut=QKeySequence.Save)
        save.triggered.connect(self._save)
        m.addAction(save)
        export = QAction("Export readout…", self)
        export.triggered.connect(self._export_readout)
        m.addAction(export)
        to_design = QAction("Back to Design", self)
        to_design.triggered.connect(self._open_design)
        m.addAction(to_design)
        m.addSeparator()
        close = QAction("Close", self, shortcut=QKeySequence.Close)
        close.triggered.connect(self.close)
        m.addAction(close)

        v = bar.addMenu("View")
        focus = QAction("Focus mode", self, checkable=True)
        focus.toggled.connect(self._set_focus_mode)
        v.addAction(focus)
        hc = QAction("High contrast", self, checkable=True)
        hc.toggled.connect(self._set_high_contrast)
        v.addAction(hc)
        v.addSeparator()
        self.start_right_act = QAction("Start rows from the right", self, checkable=True)
        self.start_right_act.setChecked(self.project.pattern.start_direction == "RTL")
        self.start_right_act.toggled.connect(self._set_start_right)
        v.addAction(self.start_right_act)

    # --- refresh -------------------------------------------------------------
    def refresh(self):
        p, pr = self.project.pattern, self.project.progress
        completed_idx = {i for i, rid in enumerate(p.row_ids) if rid in pr.completed_row_ids}
        cur = work.row_index(p, pr.current_row_id)
        done = work.is_complete(p, pr)

        if cur is not None and not done:
            arrow = "→" if row_direction(p, cur) == "LTR" else "←"
            self.row_label.setText(f"Row {working_number(p, cur)} of {p.rows}   {arrow}")
            self.chips.set_runs(encode_row(p, cur), p.palette, pr.current_run_index)
            nxt_id = work._work_neighbour(p, pr.current_row_id, +1)
            nxt = work.row_index(p, nxt_id)
            if nxt is not None:
                self.next_label.setText(
                    f"Next — Row {working_number(p, nxt)}:  {format_row_text(p, nxt)}")
            else:
                self.next_label.setText("Next — (last row)")

        self.chart.set_state(p, completed_idx, cur)
        self.chart.set_focus((cur, 2) if (self._focus_mode and cur is not None) else None)

        self.progress_bar.setMaximum(max(1, p.rows))
        self.progress_bar.setValue(work.completed_count(p, pr))
        self.progress_bar.setFormat("Row %v of %m done")
        self.remaining_label.setText(f"{work.remaining_stitches(p, pr)} stitches left")

        if done:
            self.row_label.setText("Finished! 🎉")
            self.complete_btn.setEnabled(False)
            self.chips.set_runs([], p.palette, 0)
            self.next_label.setText("")
        else:
            self.complete_btn.setEnabled(True)

    # --- actions -------------------------------------------------------------
    def _complete_row(self):
        self.project.progress = work.complete_current_row(self.project.pattern,
                                                          self.project.progress)
        self._changed()

    def _previous_row(self):
        self.project.progress = work.go_previous_row(self.project.pattern,
                                                     self.project.progress)
        self._changed()

    def _on_chip_clicked(self, index: int):
        self.project.progress = work.set_run_index(self.project.pattern,
                                                    self.project.progress, index)
        self._changed()

    def _changed(self):
        self._dirty = True
        self.refresh()

    def _save(self):
        try:
            io.save_project(self.project, self.path, source_img=self.source_img)
            self._dirty = False
        except Exception as e:  # noqa: BLE001
            QMessageBox.critical(self, "Save failed", str(e))

    def _export_readout(self):
        path, _ = QFileDialog.getSaveFileName(self, "Export readout",
                                              f"{self.project.pattern.name}.txt", "Text (*.txt)")
        if path:
            with open(path, "w") as fh:
                fh.write(export_all_rows_text(self.project.pattern))

    def _open_design(self):
        # §6.4: cell edits and borders are safe (stable row_ids); only warn, don't block.
        if work.completed_count(self.project.pattern, self.project.progress) > 0:
            QMessageBox.information(
                self, "Heads up",
                f"You're {work.completed_count(self.project.pattern, self.project.progress)} "
                f"rows into this project. Cell edits and borders are safe, but inserting or "
                f"deleting rows may shift your place.")
        self._save()
        from ..design.design_window import DesignWindow
        self._design = DesignWindow(self.project, path=self.path, source_img=self.source_img)
        self._design.show()
        self.close()

    def _set_focus_mode(self, on: bool):
        self._focus_mode = on
        self.next_label.setVisible(not on)
        self.refresh()

    def _set_high_contrast(self, on: bool):
        self.setStyleSheet(_HC_STYLE if on else "")

    def _set_start_right(self, on: bool):
        """Choose which side row 1 starts from (conventions vary, §4.4). Completed rows
        keep their progress; only the read-out order flips."""
        self.project.pattern.start_direction = "RTL" if on else "LTR"
        self._dirty = True
        self.refresh()

    # --- keyboard / close ----------------------------------------------------
    def keyPressEvent(self, e):
        # Space / Enter complete the current row. Arrow keys are handled by window
        # shortcuts (installed in __init__) because Qt's focus navigation eats them
        # before they reach here.
        if e.key() in (Qt.Key_Space, Qt.Key_Return, Qt.Key_Enter):
            self._complete_row()
        else:
            super().keyPressEvent(e)

    def closeEvent(self, e):
        if not self._dirty:
            e.accept()
            return
        choice = QMessageBox.question(
            self, "Save your progress?",
            "Save your progress before closing?",
            QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel)
        if choice == QMessageBox.Save:
            self._save()
            e.accept()
        elif choice == QMessageBox.Discard:
            e.accept()
        else:
            e.ignore()


def open_project_work(path: str) -> WorkWindow:
    project = io.load_project(path)
    source = io.load_source_image(path)
    return WorkWindow(project, path=path, source_img=source)
