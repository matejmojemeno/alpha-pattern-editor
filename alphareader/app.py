"""Application entry point.

    python -m alphareader.app                 # project library (landing screen)
    python -m alphareader.app chart.png        # import wizard, image preloaded
    python -m alphareader.app project.alpha     # open straight into the Work stage
"""
from __future__ import annotations

import sys

from PySide6.QtWidgets import QApplication


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    app = QApplication(argv)

    arg = argv[1] if len(argv) > 1 else None
    if arg and arg.lower().endswith(".alpha"):
        from .core import io
        project = io.load_project(arg)
        source = io.load_source_image(arg)
        started = project.stage == "work" or bool(project.progress.completed_row_ids)
        if started:
            from .ui.work.work_window import WorkWindow
            win = WorkWindow(project, path=arg, source_img=source)
        else:
            from .ui.design.design_window import DesignWindow
            win = DesignWindow(project, path=arg, source_img=source)
    elif arg:
        from .ui.importer.confirm_window import ConfirmWindow
        win = ConfirmWindow()
        win.load_path(arg)
    else:
        from .ui.library.library_window import LibraryWindow
        win = LibraryWindow()
    win.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
