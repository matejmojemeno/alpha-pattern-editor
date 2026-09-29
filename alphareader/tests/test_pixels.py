"""Pixel art without gridlines, read block by block (core/pixels.py)."""
from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from ..core.pixels import MAX_COLOURS, MAX_STITCHES, pixel_preview, read_pixels

COLOURS = np.array([(255, 255, 255), (20, 20, 30), (200, 40, 40), (40, 90, 200), (240, 200, 40)], np.uint8)


def _sprite(rows=12, cols=16, seed=1, colours=COLOURS) -> np.ndarray:
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(colours), size=(rows, cols))
    idx[0, 0], idx[0, 1] = 0, 1                     # every image has at least two colours
    return colours[idx]


def _enlarge(img: np.ndarray, width: int, height: int) -> np.ndarray:
    """Pillow's nearest-neighbour resize, as a browser or an image editor enlarges art."""
    return np.asarray(Image.fromarray(img).resize((width, height), Image.NEAREST))


def test_one_pixel_per_stitch():
    sprite = _sprite()
    art = read_pixels(sprite)
    assert (art.block, art.cols, art.rows) == (1.0, 16, 12)
    assert np.array_equal(art.colours[art.cells], sprite)


@pytest.mark.parametrize("k", [2, 3, 8, 13])
def test_whole_enlargements_are_read_back_exactly(k):
    sprite = _sprite()
    art = read_pixels(np.repeat(np.repeat(sprite, k, axis=0), k, axis=1))
    assert (art.block, art.cols, art.rows) == (float(k), 16, 12)
    assert np.array_equal(art.colours[art.cells], sprite)


@pytest.mark.parametrize("size", [(300, 225), (150, 113), (523, 392), (37, 28)])
def test_fractional_enlargements_are_read_back_exactly(size):
    """Resized to fit, not by a whole factor: blocks alternate between two sizes."""
    sprite = _sprite()
    art = read_pixels(_enlarge(sprite, *size))
    assert (art.cols, art.rows) == (16, 12)
    assert np.array_equal(art.colours[art.cells], sprite)


def test_both_ways_of_enlarging_are_recognised():
    """floor(x·n/L) and floor((x + ½)·n/L), the two ways tools map a pixel to its source."""
    sprite = _sprite(rows=10, cols=10)
    for centred in (False, True):
        x = np.arange(47)
        src = ((2 * x + 1) * 10) // 94 if centred else (x * 10) // 47
        img = sprite[np.ix_(src, src)]
        art = read_pixels(img)
        assert art is not None and (art.cols, art.rows) == (10, 10), centred
        assert np.array_equal(art.colours[art.cells], sprite)


def test_equal_neighbouring_rows_are_not_one_stretched_row():
    """A 1:1 sprite with two equal rows isn't a 63-row sprite enlarged by 64/63."""
    sprite = _sprite(rows=64, cols=64)
    sprite[10] = sprite[11]
    art = read_pixels(sprite)
    assert (art.cols, art.rows, art.block) == (64, 64, 1.0)


def test_the_palette_is_ordered_like_a_charts():
    art = read_pixels(np.repeat(np.repeat(_sprite(), 4, 0), 4, 1))
    assert list(art.counts) == sorted(art.counts, reverse=True)
    p = pixel_preview(art)
    assert [e.count for e in p.palette] == list(art.counts)
    assert p.palette[0].hex == "#{:02x}{:02x}{:02x}".format(*art.colours[0])
    assert (p.extent.x1, p.extent.y1) == (64.0, 48.0)
    assert p.confidence.min() == 1.0


def test_a_preview_read_in_a_crop_is_placed_where_the_crop_is():
    art = read_pixels(np.repeat(np.repeat(_sprite(), 4, 0), 4, 1))
    p = pixel_preview(art, origin=(30, 12))
    assert (p.extent.x0, p.extent.y0, p.extent.x1, p.extent.y1) == (30.0, 12.0, 94.0, 60.0)
    assert (p.col_lines[0], p.col_lines[-1]) == (30.0, 94.0)


@pytest.mark.parametrize("why,img", [
    ("one colour", np.full((20, 20, 3), 128, np.uint8)),
    ("too many colours",
     np.arange(MAX_COLOURS + 1, dtype=np.uint32).repeat(2).reshape(1, -1).repeat(3, 0)[..., None].repeat(3, 2).astype(np.uint8)),
    ("too many stitches", _sprite(rows=4, cols=MAX_STITCHES + 1)),
    ("not square", np.repeat(np.repeat(_sprite(), 4, axis=0), 8, axis=1)),
])
def test_what_isnt_pixel_art(why, img):
    assert read_pixels(img) is None, why


def test_one_pixel_off_is_no_longer_an_enlargement():
    """Its blocks aren't uniform: what's left is an image of one pixel per stitch (which
    kind.py reads as pixels only when detection finds no chart in it)."""
    img = np.repeat(np.repeat(_sprite(), 4, 0), 4, 1).copy()
    img[5, 6] = (1, 2, 3)
    art = read_pixels(img)
    assert (art.block, art.cols, art.rows) == (1.0, 64, 48)


def test_jpeg_noise_is_not_pixel_art():
    """A lossy copy's blocks aren't uniform any more: that is left to the chart reader and
    the converter (the docs' known limitation)."""
    import io
    buf = io.BytesIO()
    Image.fromarray(np.repeat(np.repeat(_sprite(), 8, 0), 8, 1)).save(buf, "JPEG", quality=85)
    assert read_pixels(np.asarray(Image.open(buf).convert("RGB"))) is None
