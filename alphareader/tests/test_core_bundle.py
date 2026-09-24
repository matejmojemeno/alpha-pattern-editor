"""scripts/build_core_bundle.py: what the browser gets, and that it imports without the
desktop-only parts (io.py, Pillow)."""
from __future__ import annotations

import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "build_core_bundle.py"


def _build(out: Path) -> dict:
    res = subprocess.run([sys.executable, str(SCRIPT), "--out", str(out)],
                         capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_bundle_contents(tmp_path):
    info = _build(tmp_path)
    names = zipfile.ZipFile(tmp_path / info["file"]).namelist()
    assert names == info["entries"]
    assert "alphareader/__init__.py" in names
    for needed in ("core/bridge.py", "core/confirm.py", "core/model.py",
                   "core/detect/pipeline.py", "core/detect/dmc.json"):
        assert f"alphareader/{needed}" in names
    assert "alphareader/core/io.py" not in names
    assert not any("__pycache__" in n or n.endswith(".pyc") for n in names)
    assert not any(n.startswith(("alphareader/ui/", "alphareader/tests/")) for n in names)
    assert info["file"] == f"alphareader-core.{info['sha256'][:12]}.zip"


def test_bundle_is_deterministic_and_replaces_old_ones(tmp_path):
    (tmp_path / "alphareader-core.000000000000.zip").write_bytes(b"stale")
    a = _build(tmp_path)
    b = _build(tmp_path)
    assert a["sha256"] == b["sha256"]
    assert [p.name for p in tmp_path.iterdir()] == [a["file"]]


def test_bundle_imports_without_io_or_pillow(tmp_path):
    """Run the bridge from the unpacked zip alone, with Pillow made unimportable, as in
    Pyodide."""
    info = _build(tmp_path / "out")
    zipfile.ZipFile(tmp_path / "out" / info["file"]).extractall(tmp_path / "site")
    code = (
        "import sys; sys.modules['PIL'] = None\n"
        f"sys.path.insert(0, {str(tmp_path / 'site')!r})\n"
        "import numpy as np\n"
        "from alphareader.core import bridge\n"
        "assert 'alphareader.core.io' not in sys.modules\n"
        "assert bridge.__file__.startswith(sys.path[0])\n"
        "img = np.full((40, 40, 4), 255, np.uint8)\n"
        "print(bridge.open_session(img.tobytes(), 40, 40)['code'])\n"
    )
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                         cwd=tmp_path)
    assert res.returncode == 0, res.stderr
    assert res.stdout.strip() == "NO_GRIDLINES"
