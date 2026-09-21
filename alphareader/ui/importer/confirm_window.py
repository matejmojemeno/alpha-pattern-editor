"""Import + confirmation window (§7). Load an image (file / drag-drop / paste), review
the detected grid with editable dims, ΔE and crop, then commit to a stored .alpha."""
from __future__ import annotations

import os

import numpy as np
from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QGuiApplication, QKeySequence, QPixmap, QShortcut
from PySide6.QtWidgets import (
    QCheckBox, QFileDialog, QHBoxLayout, QLabel, QListWidget, QListWidgetItem,
    QMainWindow, QMessageBox, QPushButton, QSlider,
    QSpinBox, QSplitter, QVBoxLayout, QWidget,
)

from ...core import io
from ...core.confirm import ConfirmState, pattern_from_preview
from ...core.detect import detect_pattern
from ...core.model import DetectionError, Project
from ..canvas import PixmapView, reconstruction_pixmap, source_pixmap_with_overlay
from .source_view import SourceView

_FAILURE_HINTS = {
    "NO_GRIDLINES": "Couldn't find gridlines. Crop tightly to just the grid and retry.",
    "LOW_RESOLUTION": "Image resolution is too low (need ~6+ px per square).",
    "ROTATED": "The image looks rotated. Straighten it and re-import.",
    "TOO_SMALL": "The image is too small to contain a grid.",
}


class ConfirmWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Alpha Pattern — Import")
        self.resize(1180, 760)
        self.setAcceptDrops(True)

        self.img: np.ndarray | None = None
        self.source_name = "pattern"
        self.state: ConfirmState | None = None
        self._refreshing = False
        self._saved = False               # committed to the library since last change?

        self._build_ui()
        self._show_placeholder()

    # --- UI construction -----------------------------------------------------
    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)

        # Top controls
        controls = QHBoxLayout()
        self.open_btn = QPushButton("Open image…")
        self.open_btn.clicked.connect(self._open_dialog)
        controls.addWidget(self.open_btn)

        controls.addSpacing(16)
        controls.addWidget(QLabel("Rows"))
        self.rows_spin = QSpinBox(); self.rows_spin.setRange(1, 999)
        self.rows_spin.valueChanged.connect(self._on_dims_changed)
        controls.addWidget(self.rows_spin)
        controls.addWidget(QLabel("Cols"))
        self.cols_spin = QSpinBox(); self.cols_spin.setRange(1, 999)
        self.cols_spin.valueChanged.connect(self._on_dims_changed)
        controls.addWidget(self.cols_spin)

        controls.addSpacing(16)
        controls.addWidget(QLabel("Colour ΔE"))
        self.dE_slider = QSlider(Qt.Horizontal)
        self.dE_slider.setRange(2, 15); self.dE_slider.setFixedWidth(140)
        self.dE_slider.valueChanged.connect(self._on_delta_e_changed)
        controls.addWidget(self.dE_slider)
        self.dE_label = QLabel("6")
        controls.addWidget(self.dE_label)

        controls.addSpacing(16)
        self.crop_btn = QPushButton("Crop"); self.crop_btn.setCheckable(True)
        self.crop_btn.toggled.connect(self._on_crop_toggled)
        controls.addWidget(self.crop_btn)
        self.reset_btn = QPushButton("Re-detect")
        self.reset_btn.clicked.connect(lambda: self._run_detection())
        controls.addWidget(self.reset_btn)
        self.lowconf_check = QCheckBox("Flag low-confidence"); self.lowconf_check.setChecked(True)
        self.lowconf_check.toggled.connect(self._refresh_views)
        controls.addWidget(self.lowconf_check)
        controls.addStretch(1)
        root.addLayout(controls)

        # Middle: source | reconstruction | palette
        splitter = QSplitter(Qt.Horizontal)
        self.source_view = SourceView()
        self.source_view.cropRequested.connect(self._on_crop_requested)
        splitter.addWidget(self.source_view)

        recon_container = QWidget(); recon_layout = QVBoxLayout(recon_container)
        recon_layout.setContentsMargins(0, 0, 0, 0)
        self.recon_view = PixmapView()                 # fit-to-view: whole image visible
        recon_layout.addWidget(self.recon_view, 1)
        self.recon_message = QLabel(alignment=Qt.AlignCenter)
        self.recon_message.setWordWrap(True)
        self.recon_message.hide()
        recon_layout.addWidget(self.recon_message)
        splitter.addWidget(recon_container)

        pal_container = QWidget(); pal_layout = QVBoxLayout(pal_container)
        pal_layout.addWidget(QLabel("Palette"))
        self.palette_list = QListWidget()
        pal_layout.addWidget(self.palette_list)
        splitter.addWidget(pal_container)
        splitter.setSizes([500, 460, 220])
        root.addWidget(splitter, 1)

        # Bottom: status, warnings, commit
        self.status_label = QLabel("")
        root.addWidget(self.status_label)
        self.warn_label = QLabel("")
        self.warn_label.setWordWrap(True)
        self.warn_label.setStyleSheet("color: #b26a00;")
        root.addWidget(self.warn_label)

        bottom = QHBoxLayout(); bottom.addStretch(1)
        self.cancel_btn = QPushButton("Close"); self.cancel_btn.clicked.connect(self.close)
        bottom.addWidget(self.cancel_btn)
        self.commit_btn = QPushButton("Save to library →")
        self.commit_btn.setDefault(True)
        self.commit_btn.clicked.connect(self._commit)
        bottom.addWidget(self.commit_btn)
        root.addLayout(bottom)

        QShortcut(QKeySequence.Paste, self, activated=self._paste)

    # --- loading -------------------------------------------------------------
    def _show_placeholder(self) -> None:
        pm = QPixmap(640, 420); pm.fill(Qt.darkGray)
        self.source_view.set_pixmap(pm)
        self.recon_view.set_pixmap(QPixmap())
        self.recon_view.hide()
        self.recon_message.setText("Open an image, drop one here, or paste (Ctrl+V).")
        self.recon_message.show()
        self._set_controls_enabled(False)

    def _set_controls_enabled(self, on: bool) -> None:
        for w in (self.rows_spin, self.cols_spin, self.dE_slider, self.crop_btn,
                  self.reset_btn, self.lowconf_check, self.commit_btn):
            w.setEnabled(on)

    def _open_dialog(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Open chart image", "", "Images (*.png *.jpg *.jpeg *.webp *.bmp)")
        if path:
            self.load_path(path)

    def load_path(self, path: str) -> None:
        from PIL import Image
        try:
            with Image.open(path) as im:
                img = np.array(im.convert("RGB"), dtype=np.uint8)   # owned copy
        except Exception as e:  # noqa: BLE001
            QMessageBox.warning(self, "Couldn't open image", str(e))
            return
        self.source_name = os.path.splitext(os.path.basename(path))[0]
        self.load_array(img)

    def load_array(self, img: np.ndarray) -> None:
        self.img = img
        self.dE_slider.blockSignals(True)
        self.dE_slider.setValue(6); self.dE_label.setText("6")
        self.dE_slider.blockSignals(False)
        self.crop_btn.setChecked(False)
        self._run_detection()

    # --- detection / refresh -------------------------------------------------
    def _run_detection(self, crop=None) -> None:
        if self.img is None:
            return
        self.crop_btn.setChecked(False)          # leave crop mode before re-detecting
        try:
            result = detect_pattern(self.img, delta_e_threshold=float(self.dE_slider.value()),
                                    crop=crop)
        except DetectionError as e:
            self.state = None
            self._show_failure(e, crop)
            return
        except Exception as e:  # noqa: BLE001 — don't leave the UI half-updated
            self.state = None
            QMessageBox.critical(self, "Detection error", str(e))
            return
        # If cropped, translate the extent back into full-image coordinates so the
        # overlay lines up with the source shown on the left.
        state = ConfirmState.from_detection(self.img, result,
                                            delta_e=float(self.dE_slider.value()))
        if crop is not None:
            ox, oy = crop[0], crop[1]
            e = state.extent
            from ...core.confirm import Extent
            state.set_extent(Extent(e.x0 + ox, e.y0 + oy, e.x1 + ox, e.y1 + oy))
        self.state = state
        self._saved = False
        self._set_controls_enabled(True)
        self._refresh_all()

    def _refresh_all(self) -> None:
        if self.state is None:
            return
        self._refreshing = True
        self.rows_spin.setValue(self.state.rows)
        self.cols_spin.setValue(self.state.cols)
        self._refreshing = False
        self._refresh_views()

    def _refresh_views(self) -> None:
        if self.state is None:
            return
        preview = self.state.preview()
        self.source_view.set_pixmap(
            source_pixmap_with_overlay(self.img, preview, show_grid=True))
        self.recon_message.hide()
        self.recon_view.show()
        self.recon_view.set_pixmap(
            reconstruction_pixmap(preview, flag_low_conf=self.lowconf_check.isChecked()))

        self.palette_list.clear()
        for entry in preview.palette:
            item = QListWidgetItem(f"  {entry.count:>5}  {entry.name}  ({entry.hex})")
            item.setForeground(QColor(Qt.black) if _is_light(entry.hex) else QColor(Qt.white))
            item.setBackground(QColor(entry.hex))
            self.palette_list.addItem(item)

        strings = preview.cols + 1
        self.status_label.setText(
            f"{preview.cols} cols × {preview.rows} rows   ·   "
            f"{preview.rows * preview.cols} stitches   ·   {len(preview.palette)} colours   ·   "
            f"{strings} strings needed")
        frac = preview.low_confidence_fraction
        self.warn_label.setText(
            f"⚠ {frac*100:.1f}% of cells are low-confidence — check the crossed cells before committing."
            if frac > 0.02 else "")

    def _on_dims_changed(self) -> None:
        if self._refreshing or self.state is None:
            return
        self._saved = False
        self.state.set_dims(rows=self.rows_spin.value(), cols=self.cols_spin.value())
        self._refresh_views()

    def _on_delta_e_changed(self, value: int) -> None:
        self.dE_label.setText(str(value))
        if self.state is None:
            return
        self._saved = False
        self.state.set_delta_e(float(value))
        self._refresh_views()

    def _on_crop_toggled(self, on: bool) -> None:
        self.source_view.set_crop_mode(on)

    def _on_crop_requested(self, x0: int, y0: int, x1: int, y1: int) -> None:
        self._run_detection(crop=(x0, y0, x1, y1))

    # --- failure state -------------------------------------------------------
    def _show_failure(self, err: DetectionError, crop) -> None:
        hint = _FAILURE_HINTS.get(err.code, str(err))
        self.recon_view.set_pixmap(QPixmap())
        self.recon_view.hide()
        self.recon_message.setText(f"Detection failed: {err.code}\n\n{hint}")
        self.recon_message.show()
        self.status_label.setText("")
        self.warn_label.setText("Tip: toggle Crop, drag a box tightly around just the grid, and release.")
        # Keep the source image visible so the user can crop and retry.
        if self.img is not None:
            self.source_view.set_pixmap(QPixmap.fromImage(_qimage(self.img)))
        self.crop_btn.setEnabled(True)
        self.reset_btn.setEnabled(True)
        self.commit_btn.setEnabled(False)

    # --- commit / save -------------------------------------------------------
    def _save_to_library(self) -> tuple[Project, str] | None:
        """Build and auto-save the project to the saved/ folder (no dialog)."""
        if self.state is None:
            return None
        pattern = pattern_from_preview(self.state.preview(), self.source_name)
        project = Project(pattern=pattern, stage="design")
        path = io.default_save_path(pattern)
        try:
            project = io.save_project(project, path, source_img=self.img)
        except Exception as e:  # noqa: BLE001
            QMessageBox.critical(self, "Save failed", str(e))
            return None
        self._saved = True
        return project, path

    def _commit(self) -> None:
        result = self._save_to_library()
        if result is None:
            return
        project, path = result
        box = QMessageBox(self)
        box.setWindowTitle("Saved")
        box.setText(f"Saved {project.pattern.cols}×{project.pattern.rows} pattern with "
                    f"{len(project.pattern.palette)} colours to your library.\n\n"
                    f"Open it now?")
        design = box.addButton("Edit in Design", QMessageBox.AcceptRole)
        work = box.addButton("Start working →", QMessageBox.AcceptRole)
        box.addButton("Not yet", QMessageBox.RejectRole)
        box.exec()
        clicked = box.clickedButton()
        if clicked is design:
            self._open_design(project, path)
        elif clicked is work:
            self._open_work(project, path)

    def _open_work(self, project: Project, path: str) -> None:
        from ..work.work_window import WorkWindow
        self._work = WorkWindow(project, path=path, source_img=self.img)
        self._work._save()          # persist stage=work so it reopens in the Work stage
        self._work.show()
        self.close()

    def _open_design(self, project: Project, path: str) -> None:
        from ..design.design_window import DesignWindow
        self._design = DesignWindow(project, path=path, source_img=self.img)
        self._design.show()
        self.close()

    def closeEvent(self, e) -> None:
        if self.state is None or self._saved:
            e.accept()
            return
        choice = QMessageBox.question(
            self, "Save your work?", "Save this pattern to your library before closing?",
            QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel)
        if choice == QMessageBox.Save:
            if self._save_to_library() is None:
                e.ignore(); return
            e.accept()
        elif choice == QMessageBox.Discard:
            e.accept()
        else:
            e.ignore()

    # --- drag & drop / paste -------------------------------------------------
    def dragEnterEvent(self, e) -> None:
        if e.mimeData().hasUrls() or e.mimeData().hasImage():
            e.acceptProposedAction()

    def dropEvent(self, e) -> None:
        md = e.mimeData()
        if md.hasUrls():
            self.load_path(md.urls()[0].toLocalFile())
        elif md.hasImage():
            self._load_qimage(md.imageData())

    def _paste(self) -> None:
        image = QGuiApplication.clipboard().image()
        if not image.isNull():
            self._load_qimage(image)

    def _load_qimage(self, image) -> None:
        from PySide6.QtGui import QImage
        image = QImage(image).convertToFormat(QImage.Format_RGB888)
        w, h = image.width(), image.height()
        if w == 0 or h == 0:
            return
        bpl = image.bytesPerLine()
        # Copy out of Qt's buffer immediately into an OWNED array. constBits() is only
        # valid while `image` lives; the previous code could return a view aliasing it,
        # which dangled after this method returned (garbled image / crash on macOS).
        buf = bytes(image.constBits())[: h * bpl]
        arr = np.frombuffer(buf, np.uint8).reshape(h, bpl)[:, : w * 3].reshape(h, w, 3)
        self.source_name = "pasted"
        self.load_array(np.array(arr, dtype=np.uint8))     # np.array => guaranteed copy


def _is_light(hex_str: str) -> bool:
    r, g, b = int(hex_str[1:3], 16), int(hex_str[3:5], 16), int(hex_str[5:7], 16)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 140


def _qimage(img: np.ndarray):
    from ..canvas import ndarray_to_qimage
    return ndarray_to_qimage(img)
