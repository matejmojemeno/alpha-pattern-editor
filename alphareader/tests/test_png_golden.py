"""fixtures/png/ is what io.export_pattern_png makes today: the web export is checked
against it (web/tests/render/png.test.ts), so it must not drift from the desktop.
Regenerate with `python scripts/gen_png_golden.py`."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image

from ..core import io

ROOT = Path(__file__).resolve().parents[2]


def _sources() -> list[str]:
    spec = importlib.util.spec_from_file_location("gen_png_golden", ROOT / "scripts" / "gen_png_golden.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.SOURCES


def test_png_golden_is_current(tmp_path):
    for name in _sources():
        project = io.load_project(str(ROOT / "fixtures" / "alpha" / "desktop" / name))
        out = tmp_path / "x.png"
        io.export_pattern_png(project.pattern, str(out))
        golden = ROOT / "fixtures" / "png" / (Path(name).stem + ".png")
        with Image.open(out) as a, Image.open(golden) as b:
            assert np.array_equal(np.asarray(a.convert("RGB")), np.asarray(b.convert("RGB"))), name
