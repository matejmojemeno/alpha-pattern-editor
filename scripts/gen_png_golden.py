"""Write fixtures/png/: what the desktop's Export PNG makes of fixture projects, the
reference web/tests/render/png.test.ts compares the browser's export with, pixel for
pixel.

    python scripts/gen_png_golden.py

Each `<name>.alpha` in fixtures/alpha/desktop/ listed below is loaded as the desktop
opens it and exported with io.export_pattern_png, as design_window.py's Export PNG…
does. Patterns with SKIP_INDEX cells, or other indices past the palette, are left out:
the desktop can't export them (it indexes the palette with the cell's value).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from alphareader.core import io  # noqa: E402

SOURCES = ["basic.alpha", "partial-row.alpha", "unicode.alpha", "with-source.alpha"]


def main() -> None:
    out = ROOT / "fixtures" / "png"
    out.mkdir(exist_ok=True)
    for name in SOURCES:
        project = io.load_project(str(ROOT / "fixtures" / "alpha" / "desktop" / name))
        path = out / (Path(name).stem + ".png")
        io.export_pattern_png(project.pattern, str(path))
        print(f"wrote {path.relative_to(ROOT)}: {project.pattern.cols}×{project.pattern.rows}")


if __name__ == "__main__":
    main()
