"""Project library (§8 project library). Browse saved projects as preview cards."""
from __future__ import annotations

import os

from PySide6.QtCore import QEvent, QFileSystemWatcher, Qt, QTimer, Signal
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QFrame, QGridLayout, QHBoxLayout, QLabel, QMainWindow, QMessageBox, QProgressBar,
    QPushButton, QScrollArea, QVBoxLayout, QWidget,
)

from ...core import io
from ...core.io import ProjectSummary


class ProjectCard(QFrame):
    """A single saved project: source-image thumbnail, name, dims, progress."""

    opened = Signal(str)         # emits the .alpha path
    deleteRequested = Signal(str)

    def __init__(self, summary: ProjectSummary):
        super().__init__()
        self.path = summary.path
        self.setObjectName("card")
        self.setStyleSheet(
            "#card { border:1px solid #bbb; border-radius:10px; background:palette(base); }"
            "#card:hover { border-color:#f0a800; }")
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedSize(240, 240)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(10, 10, 10, 10)

        thumb = QLabel(alignment=Qt.AlignCenter)
        thumb.setFixedHeight(150)
        if summary.thumbnail_png:
            pm = QPixmap()
            pm.loadFromData(summary.thumbnail_png)
            thumb.setPixmap(pm.scaled(218, 150, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        else:
            thumb.setText("(no preview)")
        lay.addWidget(thumb)

        name = QLabel(summary.name)
        name.setStyleSheet("font-weight:600; font-size:14px;")
        name.setWordWrap(True)
        lay.addWidget(name)

        meta = QLabel(f"{summary.cols}×{summary.rows}")
        meta.setStyleSheet("color:#888; font-size:12px;")
        lay.addWidget(meta)

        bar = QProgressBar()
        bar.setMaximum(100)
        bar.setValue(int(round(summary.progress_pct)))
        bar.setFormat("%p% done")
        bar.setFixedHeight(16)
        lay.addWidget(bar)

        # Corner "remove" button (overlaid, so it doesn't disturb the layout). A child
        # button consumes its own click, so pressing it never opens the project.
        self.delete_btn = QPushButton("✕", self)
        self.delete_btn.setFixedSize(24, 24)
        self.delete_btn.setToolTip("Remove from library")
        self.delete_btn.setCursor(Qt.ArrowCursor)
        self.delete_btn.move(self.width() - 30, 6)
        self.delete_btn.setStyleSheet(
            "QPushButton { border:none; border-radius:12px; background:rgba(0,0,0,0.35);"
            " color:white; font-weight:bold; }"
            " QPushButton:hover { background:#d33; }")
        self.delete_btn.clicked.connect(lambda: self.deleteRequested.emit(self.path))

    def mousePressEvent(self, _e):
        self.opened.emit(self.path)


class LibraryWindow(QMainWindow):
    """Landing screen: a grid of saved projects plus a way to import a new chart."""

    COLUMNS = 3

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Alpha Pattern — Library")
        self.resize(820, 640)
        self._children: list = []            # keep opened windows alive
        self._closing = False
        self._build_ui()

        # Auto-refresh: watch the saved/ folder (and each project file) so the grid
        # updates itself when a project is saved elsewhere. A short debounce coalesces
        # the burst of events a single save emits.
        self._watcher = QFileSystemWatcher(self)
        self._watcher.directoryChanged.connect(self._schedule_reload)
        self._watcher.fileChanged.connect(self._schedule_reload)
        self._reload_timer = QTimer(self)
        self._reload_timer.setSingleShot(True)
        self._reload_timer.setInterval(300)
        self._reload_timer.timeout.connect(self.reload)

        self.reload()

    def _schedule_reload(self, *_):
        self._reload_timer.start()

    def _sync_watch_paths(self):
        watched = set(self._watcher.directories()) | set(self._watcher.files())
        want = {io.saved_dir()}
        want |= {s.path for s in io.list_saved_projects()}
        stale = watched - want
        if stale:
            self._watcher.removePaths(list(stale))
        add = [p for p in want if p not in watched and os.path.exists(p)]
        if add:
            self._watcher.addPaths(add)

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)

        top = QHBoxLayout()
        title = QLabel("Your projects")
        title.setStyleSheet("font-size:20px; font-weight:700;")
        top.addWidget(title)
        top.addStretch(1)
        new_btn = QPushButton("Import new chart…")
        new_btn.clicked.connect(self._import_new)
        top.addWidget(new_btn)
        refresh = QPushButton("Refresh")
        refresh.clicked.connect(self.reload)
        top.addWidget(refresh)
        root.addLayout(top)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.grid_host = QWidget()
        self.grid = QGridLayout(self.grid_host)
        self.grid.setAlignment(Qt.AlignTop | Qt.AlignLeft)
        self.scroll.setWidget(self.grid_host)
        root.addWidget(self.scroll, 1)

        self.empty_label = QLabel(
            "No saved projects yet. Click “Import new chart…” to create one.")
        self.empty_label.setAlignment(Qt.AlignCenter)
        self.empty_label.setStyleSheet("color:#888;")
        root.addWidget(self.empty_label)

    def reload(self):
        if self._closing:
            return
        while self.grid.count():
            item = self.grid.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        summaries = io.list_saved_projects()
        self.empty_label.setVisible(not summaries)
        for i, s in enumerate(summaries):
            card = ProjectCard(s)
            card.opened.connect(self._open_project)
            card.deleteRequested.connect(self._delete_project)
            self.grid.addWidget(card, i // self.COLUMNS, i % self.COLUMNS)
        self._sync_watch_paths()

    def _delete_project(self, path: str):
        name = os.path.splitext(os.path.basename(path))[0]
        if QMessageBox.question(
                self, "Remove project",
                f"Remove “{name}” from your library?\n\nThis deletes the saved file and "
                f"can't be undone.") != QMessageBox.Yes:
            return
        try:
            io.delete_project(path)
        except Exception as e:  # noqa: BLE001
            QMessageBox.critical(self, "Couldn't remove", str(e))
        self.reload()

    def changeEvent(self, e):
        # Refresh whenever the library regains focus — a reliable backstop for any
        # filesystem event the watcher might miss (e.g. an atomic save-and-replace).
        if e.type() == QEvent.ActivationChange and self.isActiveWindow() and not self._closing:
            self.reload()
        super().changeEvent(e)

    def closeEvent(self, e):
        # Tear down auto-refresh before the window is destroyed so no queued timer or
        # filesystem event fires reload() on a half-destroyed window during shutdown.
        self._closing = True
        self._reload_timer.stop()
        self._watcher.blockSignals(True)
        super().closeEvent(e)

    def _open_project(self, path: str):
        # §6.4: default to Work if there is progress, else Design.
        project = io.load_project(path)
        source = io.load_source_image(path)
        started = project.stage == "work" or bool(project.progress.completed_row_ids)
        if started:
            from ..work.work_window import WorkWindow
            win = WorkWindow(project, path=path, source_img=source)
        else:
            from ..design.design_window import DesignWindow
            win = DesignWindow(project, path=path, source_img=source)
        self._children.append(win)
        win.show()          # progress refresh happens via the file watcher / activation

    def _import_new(self):
        from ..importer.confirm_window import ConfirmWindow
        win = ConfirmWindow()
        self._children.append(win)
        win.show()
