"""`.alpha` project persistence (§8). A project is a zip archive of:
  pattern.json   - pattern metadata + palette (cells stored separately)
  progress.json  - Work-stage progress
  cells.npy      - uint16 (rows, cols) palette indices
  source.png     - the original imported image (for re-detection / provenance)
  meta.json      - {format_version}, so unknown major versions can be rejected.
"""
from __future__ import annotations

import dataclasses
import io as _io
import json
import os
import re
import time
import zipfile
from dataclasses import dataclass

import numpy as np
from PIL import Image

from .model import PaletteEntry, Pattern, Progress, Project

FORMAT_VERSION = 1

# Project root = two levels up from this file (…/alpha-pattern-editor).
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAVED_DIR = os.path.join(_ROOT, "saved")


def saved_dir() -> str:
    """The default projects folder (created on demand)."""
    os.makedirs(SAVED_DIR, exist_ok=True)
    return SAVED_DIR


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "pattern").lower()).strip("-")
    return s or "pattern"


def default_save_path(pattern: Pattern) -> str:
    """A stable auto-save location for this pattern under saved/ — no dialog needed.
    The id suffix keeps same-named patterns from colliding while filenames stay readable."""
    return os.path.join(saved_dir(), f"{_slug(pattern.name)}-{pattern.id[:6]}.alpha")


def _pattern_to_json(p: Pattern) -> dict:
    return {
        "id": p.id, "name": p.name,
        "created_at": p.created_at, "updated_at": p.updated_at,
        "cols": p.cols, "rows": p.rows,
        "row_ids": p.row_ids,
        "palette": [dataclasses.asdict(e) for e in p.palette],
        "start_direction": p.start_direction,
        "alternate_direction": p.alternate_direction,
        "bottom_up": p.bottom_up,
    }


def _pattern_from_json(d: dict, cells: np.ndarray) -> Pattern:
    return Pattern(
        id=d["id"], name=d["name"],
        created_at=d["created_at"], updated_at=d["updated_at"],
        cols=d["cols"], rows=d["rows"],
        row_ids=list(d["row_ids"]),
        cells=cells,
        palette=[PaletteEntry(**e) for e in d["palette"]],
        start_direction=d.get("start_direction", "LTR"),
        alternate_direction=d.get("alternate_direction", True),
        bottom_up=d.get("bottom_up", True),
    )


def _progress_to_json(pr: Progress) -> dict:
    return {
        "completed_row_ids": sorted(pr.completed_row_ids),
        "current_row_id": pr.current_row_id,
        "current_run_index": pr.current_run_index,
        "current_run_stitches": pr.current_run_stitches,
        "started_at": pr.started_at,
    }


def _progress_from_json(d: dict) -> Progress:
    return Progress(
        completed_row_ids=set(d.get("completed_row_ids", [])),
        current_row_id=d.get("current_row_id"),
        current_run_index=d.get("current_run_index", 0),
        current_run_stitches=d.get("current_run_stitches", 0),
        started_at=d.get("started_at"),
    )


def save_project(project: Project, path: str, source_img: np.ndarray | None = None,
                 *, now: float | None = None) -> Project:
    """Write `project` to `path` and return an updated Project — mutating nothing.

    Saving stamps a fresh `updated_at`, but it does so on a *copy*: silently rewriting a
    field on the caller's object is the one place in `core/` that broke the
    "operations return new objects" rule the rest of the package keeps, and it is exactly
    the kind of hidden mutation a UI can't see (a view re-renders from an object whose
    contents changed underneath it). Callers should rebind: `proj = save_project(proj, …)`.
    """
    p = dataclasses.replace(project.pattern,
                            updated_at=time.time() if now is None else now)
    project = dataclasses.replace(project, pattern=p)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("meta.json", json.dumps({"format_version": FORMAT_VERSION,
                                            "stage": project.stage}))
        z.writestr("pattern.json", json.dumps(_pattern_to_json(p)))
        z.writestr("progress.json", json.dumps(_progress_to_json(project.progress)))
        buf = _io.BytesIO()
        np.save(buf, p.cells.astype(np.uint16))
        z.writestr("cells.npy", buf.getvalue())
        if source_img is not None:
            ibuf = _io.BytesIO()
            Image.fromarray(source_img).save(ibuf, format="PNG")
            z.writestr("source.png", ibuf.getvalue())
    return project


def delete_project(path: str) -> None:
    """Remove a saved project file. Guards against deleting anything but an .alpha."""
    if not path.endswith(".alpha"):
        raise ValueError("Refusing to delete a non-project file.")
    if os.path.exists(path):
        os.remove(path)


def load_project(path: str) -> Project:
    with zipfile.ZipFile(path, "r") as z:
        meta = json.loads(z.read("meta.json"))
        major = int(meta.get("format_version", 0))
        if major > FORMAT_VERSION:
            raise ValueError(
                f"This project was made by a newer version (format {major}); "
                f"this build understands up to {FORMAT_VERSION}."
            )
        cells = np.load(_io.BytesIO(z.read("cells.npy")))
        pattern = _pattern_from_json(json.loads(z.read("pattern.json")), cells)
        progress = _progress_from_json(json.loads(z.read("progress.json")))
        stage = meta.get("stage", "design")
    return Project(pattern=pattern, progress=progress, stage=stage)


def load_source_image(path: str) -> np.ndarray | None:
    """Read the embedded source image from a .alpha file, if present."""
    with zipfile.ZipFile(path, "r") as z:
        if "source.png" not in z.namelist():
            return None
        return np.asarray(Image.open(_io.BytesIO(z.read("source.png"))).convert("RGB"),
                          dtype=np.uint8)


@dataclass
class ProjectSummary:
    path: str
    name: str
    rows: int
    cols: int
    progress_pct: float
    updated_at: float
    thumbnail_png: bytes | None      # source image bytes for a preview


def list_saved_projects(directory: str | None = None) -> list[ProjectSummary]:
    """Scan the saved folder and summarise each project for the library view."""
    directory = directory or saved_dir()
    summaries: list[ProjectSummary] = []
    for name in os.listdir(directory):
        if not name.endswith(".alpha"):
            continue
        path = os.path.join(directory, name)
        try:
            with zipfile.ZipFile(path, "r") as z:
                pat = json.loads(z.read("pattern.json"))
                prog = json.loads(z.read("progress.json"))
                rows = int(pat.get("rows", 0))
                done = len(prog.get("completed_row_ids", []))
                thumb = z.read("source.png") if "source.png" in z.namelist() else None
        except Exception:  # noqa: BLE001 — skip unreadable/foreign files
            continue
        summaries.append(ProjectSummary(
            path=path, name=pat.get("name", name), rows=rows, cols=int(pat.get("cols", 0)),
            progress_pct=(100.0 * done / rows) if rows else 0.0,
            updated_at=float(pat.get("updated_at", os.path.getmtime(path))),
            thumbnail_png=thumb,
        ))
    summaries.sort(key=lambda s: s.updated_at, reverse=True)
    return summaries


def export_pattern_png(pattern: Pattern, path: str, cell: int = 16) -> None:
    """Export the pattern as a clean chart image."""
    from PIL import ImageDraw
    from .detect.palette import hex_to_rgb
    pal = [tuple(int(v) for v in hex_to_rgb(e.hex)) for e in pattern.palette]
    W, H = pattern.cols * cell + 1, pattern.rows * cell + 1
    img = Image.new("RGB", (W, H), (200, 200, 200))
    d = ImageDraw.Draw(img)
    for r in range(pattern.rows):
        for c in range(pattern.cols):
            d.rectangle([c * cell, r * cell, (c + 1) * cell, (r + 1) * cell],
                        fill=pal[int(pattern.cells[r, c])], outline=(170, 170, 170))
    img.save(path)
