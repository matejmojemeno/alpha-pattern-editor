"""Design stage (§6.2): edit cells, palette and structure with full undo/redo.

Dense, tool-oriented, desktop layout. No progress display anywhere (§6.1)."""
from __future__ import annotations

import numpy as np
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QAction, QColor, QFont, QKeySequence
from PySide6.QtWidgets import (
    QButtonGroup, QColorDialog, QFileDialog, QGroupBox, QHBoxLayout, QLabel, QListWidget,
    QListWidgetItem, QMainWindow, QMessageBox, QPushButton, QScrollArea, QSpinBox,
    QToolButton, QVBoxLayout, QWidget,
)

from ...core import edit, io
from ...core.detect.palette import hex_to_rgb
from ...core.model import Pattern, Project
from .design_canvas import DesignCanvas

UNDO_CAP = 50
_TOOLS = [("paint", "Paint"), ("fill", "Fill"), ("rect", "Rectangle"),
          ("eyedropper", "Pick colour"), ("row", "Fill row"), ("col", "Fill column")]


def _bold_font() -> QFont:
    f = QFont()
    f.setBold(True)
    f.setPointSize(f.pointSize() + 2)
    return f


class DesignWindow(QMainWindow):
    def __init__(self, project: Project, path: str | None = None,
                 source_img: np.ndarray | None = None):
        super().__init__()
        self.project = project
        self.pattern: Pattern = project.pattern
        self.source_img = source_img
        self.path = path or io.default_save_path(project.pattern)
        self.project.stage = "design"

        self.undo_stack: list[Pattern] = []
        self.redo_stack: list[Pattern] = []
        self.tool = "paint"
        self.color_index = 0
        self._dirty = False
        self._stroke = False
        self._stroke_recorded = False
        self._rect_start: tuple[int, int] | None = None
        self._fitted = False

        self.setWindowTitle(f"Design — {project.pattern.name}")
        self.resize(1180, 800)
        self._build_ui()
        self._build_menu()
        self._refresh()

    def showEvent(self, e):
        super().showEvent(e)
        # Fit the whole pattern into the viewport the first time the window is shown
        # (deferred so the layout — and thus the real viewport size — is settled).
        if not self._fitted:
            self._fitted = True
            QTimer.singleShot(0, self._fit_to_view)

    def _fit_to_view(self):
        from .design_canvas import MARGIN
        vp = self.scroll.viewport().size()
        avail_w, avail_h = vp.width() - MARGIN - 6, vp.height() - MARGIN - 6
        if self.pattern.cols < 1 or self.pattern.rows < 1 or avail_w < 1 or avail_h < 1:
            return
        cell = min(avail_w / self.pattern.cols, avail_h / self.pattern.rows)
        self.canvas.set_cell_size(int(max(4, min(48, cell))))

    # --- UI ------------------------------------------------------------------
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QHBoxLayout(central)

        # Left: tools + zoom
        tools = QVBoxLayout()
        tools.addWidget(QLabel("<b>Tools</b>"))
        self._tool_group = QButtonGroup(self)
        for key, label in _TOOLS:
            b = QToolButton(); b.setText(label); b.setCheckable(True)
            b.setToolButtonStyle(Qt.ToolButtonTextOnly); b.setMinimumWidth(120)
            b.clicked.connect(lambda _=False, k=key: self._set_tool(k))
            self._tool_group.addButton(b)
            tools.addWidget(b)
            if key == self.tool:
                b.setChecked(True)
        tools.addSpacing(12)
        tools.addWidget(QLabel("<b>Zoom</b>"))
        zoom = QHBoxLayout()
        for label, delta in (("−", -3), ("+", 3)):
            zb = QPushButton(label); zb.setFixedWidth(40)
            zb.clicked.connect(lambda _=False, d=delta: self._zoom(d))
            zoom.addWidget(zb)
        tools.addLayout(zoom)
        fit_btn = QPushButton("Fit")
        fit_btn.clicked.connect(self._fit_to_view)
        tools.addWidget(fit_btn)
        tools.addStretch(1)
        root.addLayout(tools)

        # Center: canvas
        self.canvas = DesignCanvas()
        self.canvas.pressed.connect(self._on_pressed)
        self.canvas.dragged.connect(self._on_dragged)
        self.canvas.released.connect(self._on_released)
        self.scroll = QScrollArea(); self.scroll.setWidget(self.canvas)
        self.scroll.setAlignment(Qt.AlignCenter)
        root.addWidget(self.scroll, 1)

        # Right: palette + structural
        right = QVBoxLayout()
        right.addWidget(QLabel("<b>Palette</b>"))
        self.palette_list = QListWidget()
        self.palette_list.currentRowChanged.connect(self._on_color_selected)
        self.palette_list.itemDoubleClicked.connect(lambda _i: self._recolor_selected())
        right.addWidget(self.palette_list, 1)
        pal_btns = QHBoxLayout()
        for label, fn in (("Add", self._add_color), ("Recolour", self._recolor_selected),
                          ("Delete", self._delete_color)):
            b = QPushButton(label); b.clicked.connect(fn); pal_btns.addWidget(b)
        right.addLayout(pal_btns)

        right.addWidget(self._structural_panel())
        self.status = QLabel(""); self.status.setWordWrap(True)
        right.addWidget(self.status)

        right.addSpacing(6)
        save_btn = QPushButton("Save")
        save_btn.clicked.connect(self._save)
        right.addWidget(save_btn)
        self.work_btn = QPushButton("Start working →")
        self.work_btn.setMinimumHeight(44)
        self.work_btn.setFont(_bold_font())
        self.work_btn.clicked.connect(self._open_work)
        right.addWidget(self.work_btn)
        root.addLayout(right)

    def _structural_panel(self) -> QGroupBox:
        box = QGroupBox("Structure")
        lay = QVBoxLayout(box)

        # Pad to a target size with the pattern's border colour (fills, never crops).
        size_row = QHBoxLayout()
        size_row.addWidget(QLabel("W"))
        self._pad_w = QSpinBox(); self._pad_w.setRange(1, 2000)
        self._pad_w.setValue(self.pattern.cols)
        size_row.addWidget(self._pad_w)
        size_row.addWidget(QLabel("H"))
        self._pad_h = QSpinBox(); self._pad_h.setRange(1, 2000)
        self._pad_h.setValue(self.pattern.rows)
        size_row.addWidget(self._pad_h)
        lay.addLayout(size_row)
        pad_b = QPushButton("Pad to size (border colour)")
        pad_b.clicked.connect(self._pad_to_size)
        lay.addWidget(pad_b)

        # Integer scale (pixel-exact, no interpolation).
        scale_row = QHBoxLayout()
        scale_row.addWidget(QLabel("Scale ×"))
        self._scale_factor = QSpinBox(); self._scale_factor.setRange(2, 12)
        scale_row.addWidget(self._scale_factor)
        scale_b = QPushButton("Apply scale")
        scale_b.clicked.connect(self._scale)
        scale_row.addWidget(scale_b)
        lay.addLayout(scale_row)

        for label, fn in (("Mirror ⇄", edit.mirror_h), ("Flip ⇅", edit.mirror_v),
                          ("Rotate 180°", edit.rotate_180)):
            b = QPushButton(label); b.clicked.connect(lambda _=False, f=fn: self._commit(f(self.pattern)))
            lay.addWidget(b)
        trim = QPushButton("Trim uniform edges")
        trim.clicked.connect(lambda: self._commit(edit.trim_uniform_edges(
            self.pattern, top=True, right=True, bottom=True, left=True)))
        lay.addWidget(trim)
        return box

    def _build_menu(self):
        m = self.menuBar().addMenu("Project")
        self.act_save = QAction("Save", self, shortcut=QKeySequence.Save); self.act_save.triggered.connect(self._save)
        m.addAction(self.act_save)
        exp = QAction("Export PNG…", self); exp.triggered.connect(self._export_png); m.addAction(exp)
        work = QAction("Work on this →", self); work.triggered.connect(self._open_work); m.addAction(work)
        m.addSeparator()
        close = QAction("Close", self, shortcut=QKeySequence.Close); close.triggered.connect(self.close); m.addAction(close)

        e = self.menuBar().addMenu("Edit")
        self.act_undo = QAction("Undo", self, shortcut=QKeySequence.Undo); self.act_undo.triggered.connect(self._undo); e.addAction(self.act_undo)
        self.act_redo = QAction("Redo", self, shortcut=QKeySequence.Redo); self.act_redo.triggered.connect(self._redo); e.addAction(self.act_redo)

    # --- edit application ----------------------------------------------------
    def _push_undo(self):
        self.undo_stack.append(self.pattern)
        if len(self.undo_stack) > UNDO_CAP:
            self.undo_stack.pop(0)
        self.redo_stack.clear()

    def _commit(self, new_pattern: Pattern):
        """Apply a discrete edit as one undo step."""
        if new_pattern is self.pattern:
            return
        self._push_undo()
        self.pattern = new_pattern
        self._after_edit()

    def _after_edit(self):
        self._dirty = True
        self.project.pattern = self.pattern
        # Keep the pad target valid (>= current) without clobbering a larger typed target.
        if hasattr(self, "_pad_w"):
            if self._pad_w.value() < self.pattern.cols:
                self._pad_w.setValue(self.pattern.cols)
            if self._pad_h.value() < self.pattern.rows:
                self._pad_h.setValue(self.pattern.rows)
        self._refresh()

    def _undo(self):
        if not self.undo_stack:
            return
        self.redo_stack.append(self.pattern)
        self.pattern = self.undo_stack.pop()
        self._after_edit()

    def _redo(self):
        if not self.redo_stack:
            return
        self.undo_stack.append(self.pattern)
        self.pattern = self.redo_stack.pop()
        self._after_edit()

    # --- tool handling -------------------------------------------------------
    def _set_tool(self, key: str):
        self.tool = key

    def _on_pressed(self, r: int, c: int):
        if self.tool == "paint":
            self._stroke = True
            self._stroke_recorded = False       # record undo lazily on first real change
            self._paint(r, c)
        elif self.tool == "fill":
            self._commit(edit.flood_fill(self.pattern, r, c, self.color_index))
        elif self.tool == "eyedropper":
            self.color_index = int(self.pattern.cells[r, c])
            self.palette_list.setCurrentRow(self.color_index)
        elif self.tool == "rect":
            self._rect_start = (r, c)
        elif self.tool == "row":
            self._commit(edit.fill_row(self.pattern, r, self.color_index))
        elif self.tool == "col":
            self._commit(edit.fill_column(self.pattern, c, self.color_index))

    def _on_dragged(self, r: int, c: int):
        if self.tool == "paint" and self._stroke:
            self._paint(r, c)
        elif self.tool == "rect" and self._rect_start is not None:
            self.canvas.set_preview_rect((*self._rect_start, r, c))

    def _on_released(self, r: int, c: int):
        if self.tool == "paint":
            self._stroke = False
        elif self.tool == "rect" and self._rect_start is not None:
            r0, c0 = self._rect_start
            self._rect_start = None
            self.canvas.set_preview_rect(None)
            self._commit(edit.fill_rect(self.pattern, r0, c0, r, c, self.color_index))

    def _paint(self, r: int, c: int):
        """Paint one cell mid-stroke. The whole stroke is a single undo step, recorded
        on the first cell that actually changes (so a no-op stroke records nothing)."""
        if int(self.pattern.cells[r, c]) == self.color_index:
            return
        if not self._stroke_recorded:
            self._push_undo()
            self._stroke_recorded = True
        self.pattern = edit.set_cell(self.pattern, r, c, self.color_index)
        self._after_edit()

    # --- palette -------------------------------------------------------------
    def _on_color_selected(self, row: int):
        if row >= 0:
            self.color_index = row

    def _add_color(self):
        col = QColorDialog.getColor(Qt.white, self, "New colour")
        if col.isValid():
            self._commit(edit.add_palette_entry(self.pattern, col.name(), "New colour"))
            self.palette_list.setCurrentRow(len(self.pattern.palette) - 1)

    def _recolor_selected(self):
        i = self.palette_list.currentRow()
        if i < 0:
            return
        entry = self.pattern.palette[i]
        col = QColorDialog.getColor(QColor(entry.hex), self, "Recolour")
        if col.isValid():
            self._commit(edit.recolor_palette_entry(self.pattern, entry.id, col.name()))

    def _delete_color(self):
        """Remove the selected colour; its cells fold into the nearest remaining one."""
        i = self.palette_list.currentRow()
        if i < 0 or len(self.pattern.palette) <= 1:
            return
        entry = self.pattern.palette[i]
        self._commit(edit.delete_palette_entry_nearest(self.pattern, entry.id))

    def _pad_to_size(self):
        tw, th = self._pad_w.value(), self._pad_h.value()
        if tw < self.pattern.cols or th < self.pattern.rows:
            QMessageBox.information(
                self, "Pad to size",
                "Target must be at least the current size — this adds a border, "
                "it doesn't crop.")
            return
        if tw == self.pattern.cols and th == self.pattern.rows:
            return
        self._commit(edit.pad_to_size(self.pattern, tw, th))
        self._sync_size_spins()

    def _scale(self):
        self._commit(edit.scale(self.pattern, self._scale_factor.value()))
        self._sync_size_spins()

    def _sync_size_spins(self):
        self._pad_w.setValue(self.pattern.cols)
        self._pad_h.setValue(self.pattern.rows)

    # --- refresh -------------------------------------------------------------
    def _refresh(self):
        p = self.pattern
        self.canvas.set_pattern(p)
        self.palette_list.blockSignals(True)
        self.palette_list.clear()
        for e in p.palette:
            item = QListWidgetItem(f"  {e.count:>5}  {e.name}")
            item.setBackground(QColor(e.hex))
            r, g, b = (int(v) for v in hex_to_rgb(e.hex))
            item.setForeground(Qt.black if (0.2126*r+0.7152*g+0.0722*b) > 140 else Qt.white)
            self.palette_list.addItem(item)
        self.color_index = min(self.color_index, len(p.palette) - 1)
        self.palette_list.setCurrentRow(self.color_index)
        self.palette_list.blockSignals(False)

        self.status.setText(
            f"{p.cols} × {p.rows}  ·  {p.rows*p.cols} stitches  ·  "
            f"{len(p.palette)} colours  ·  {p.cols + 1} strings")
        self.act_undo.setEnabled(bool(self.undo_stack))
        self.act_redo.setEnabled(bool(self.redo_stack))

    def _zoom(self, delta: int):
        self.canvas.set_cell_size(self.canvas.cell + delta)

    # --- save / export / switch ----------------------------------------------
    def _save(self):
        try:
            self.project = io.save_project(self.project, self.path,
                                           source_img=self.source_img)
            self._dirty = False
        except Exception as e:  # noqa: BLE001
            QMessageBox.critical(self, "Save failed", str(e))

    def _export_png(self):
        path, _ = QFileDialog.getSaveFileName(self, "Export PNG",
                                              f"{self.pattern.name}.png", "PNG (*.png)")
        if path:
            io.export_pattern_png(self.pattern, path)

    def _open_work(self):
        self._save()
        from ..work.work_window import WorkWindow
        self._work = WorkWindow(self.project, path=self.path, source_img=self.source_img)
        self._work._save()          # persist the design->work transition (stage, started_at)
        self._dirty = False         # already saved; don't prompt on close
        self._work.show()
        self.close()

    def closeEvent(self, e):
        if not self._dirty:
            e.accept(); return
        choice = QMessageBox.question(self, "Save your work?",
                                      "Save your changes before closing?",
                                      QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel)
        if choice == QMessageBox.Save:
            self._save(); e.accept()
        elif choice == QMessageBox.Discard:
            e.accept()
        else:
            e.ignore()


def open_project_design(path: str) -> DesignWindow:
    project = io.load_project(path)
    source = io.load_source_image(path)
    return DesignWindow(project, path=path, source_img=source)
