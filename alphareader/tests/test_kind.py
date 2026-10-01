"""Chart or picture (core/kind.py), on every image of the corpus.

Named file by file rather than globbed, so an image dropped into test_images/ to try the
detector never changes what this suite asserts."""
from __future__ import annotations

import os

import numpy as np
import pytest
from PIL import Image

from ..core.bridge import shrink, shrink_factor
from ..core.kind import read_image
from . import synth

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMAGES = os.path.join(ROOT, "test_images")

# (file, kind, sure, failure)
CHARTS = [
    ("bug.jpg", "chart", True, None),
    ("cats.png", "chart", True, None),
    ("dachshund.png", "chart", True, None),
    ("monkeys.png", "chart", True, None),
    # Squares about 5 px: refused as too fine, but a chart, never converted as a picture.
    ("garment.png", "chart", True, "LOW_RESOLUTION"),
    ("failed/face.jpg", "chart", True, None),
    ("failed/lisa.jpg", "chart", True, None),
    ("failed/shizuku.jpg", "chart", True, None),
    # A third of its cells unsure: read as a chart, with the picture reading offered.
    ("failed/bunny.jpg", "chart", False, None),
]
PICTURES = [
    "arctic-fox.jpg", "brick-wall.jpg", "butterfly-painting.jpg", "butterfly.jpg",
    "cat-grass.jpg", "cat-tabby.jpg", "chessboard-street.jpg", "chessboard-wood.jpg",
    "coat-of-arms.png", "dog-beach.jpg", "floor-tiles.jpg", "flowers-icon.png",
    "fox-yard.jpg", "heart.png", "knitted-fleece.png", "lake-mountains.jpg",
    "lcd-floor.jpg", "mosaic.webp", "parrot-cage.jpg", "parrot-squirrel-print.jpg",
    "potted-flower-icon.png", "smiley.png", "strawberry.jpg", "sunflower.jpg", "toy-car.jpg",
]


def _load(path: str) -> np.ndarray:
    """As the browser hands it over: RGB, shrunk to at most 4 MP (web/src/detect)."""
    a = np.asarray(Image.open(path).convert("RGB"))
    return shrink(a, shrink_factor(a.shape[1], a.shape[0], 4_000_000))


@pytest.mark.parametrize("name,kind,sure,failure", CHARTS)
def test_charts_are_read_as_charts(name, kind, sure, failure):
    r = read_image(_load(os.path.join(IMAGES, name)))
    assert (r.kind, r.sure) == (kind, sure), r.reason
    assert (None if r.error is None else r.error.code) == failure, r.reason
    assert (r.result is None) == (failure is not None)


@pytest.mark.parametrize("name", PICTURES)
def test_pictures_are_read_as_pictures(name):
    r = read_image(_load(os.path.join(IMAGES, "pictures", name)))
    assert r.kind == "picture", r.reason
    assert r.error is None


def test_every_corpus_picture_is_listed():
    """A picture fetched by scripts/fetch_test_pictures.py but not asserted here would
    calibrate nothing."""
    on_disk = sorted(f for f in os.listdir(os.path.join(IMAGES, "pictures")) if f != "README.md")
    assert on_disk == sorted(PICTURES)


@pytest.mark.parametrize("seed", range(12))
def test_synthetic_charts_are_charts(seed):
    """The detection suite's adversarial charts (JPEG, watermarks, odd downscales) are
    still charts. A rotated one may be refused, but as a chart."""
    spec = synth.random_spec(np.random.default_rng(seed))
    r = read_image(synth.render(spec))
    assert r.kind == "chart", r.reason
