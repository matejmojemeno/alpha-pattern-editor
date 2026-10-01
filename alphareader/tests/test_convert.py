"""Turning a picture into a pattern (core/convert.py)."""
from __future__ import annotations

import numpy as np
import pytest

from ..core import convert
from ..core.confirm import Extent


def _field(h=240, w=320, colour=(200, 190, 170)) -> np.ndarray:
    return np.full((h, w, 3), colour, np.uint8)


def _gradient(h=240, w=320) -> np.ndarray:
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    img = np.stack([120 + 100 * x / w, 90 + 120 * y / h, 160 - 60 * x / w], axis=2)
    return np.clip(img, 0, 255).astype(np.uint8)


def _lone_stitches(cells: np.ndarray) -> int:
    p = np.pad(cells.astype(int), 1, constant_values=-1)
    same = ((p[:-2, 1:-1] == cells) | (p[2:, 1:-1] == cells)
            | (p[1:-1, :-2] == cells) | (p[1:-1, 2:] == cells))
    return int((~same).sum())


def _hex_rgb(h: str) -> np.ndarray:
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)])


def test_the_same_picture_gives_the_same_pattern():
    """No randomness anywhere: the desktop and Pyodide must agree (scripts/parity)."""
    img = _gradient()
    a = convert.convert_picture(img, colours=7)
    b = convert.convert_picture(img.copy(), colours=7)
    assert np.array_equal(a.cells, b.cells)
    assert [e.hex for e in a.palette] == [e.hex for e in b.palette]


def test_rows_keep_the_pictures_shape_for_the_stitch():
    ext = Extent(0, 0, 320, 240)
    assert convert.picture_rows(ext, 60, 1.0) == 45
    # Stitches wider than tall (a swatch of 16 stitches and 20 rows over 10 cm): more rows.
    assert convert.picture_rows(ext, 60, (10 / 20) / (10 / 16)) == 56
    assert convert.picture_rows(Extent(0, 0, 0, 10), 60, 1.0) == 1


def test_width_and_extent_are_clamped():
    ext = Extent(0, 0, 50, 40)
    assert convert.clamp_width(1, ext) == convert.MIN_WIDTH
    assert convert.clamp_width(10_000, ext) == 50             # a stitch per pixel at most
    assert convert.clamp_width(10_000, Extent(0, 0, 5000, 10)) == convert.MAX_WIDTH
    e = convert.clamp_edges(Extent(-20, 90, 400, -5), 320, 240)
    assert (e.x0, e.y0, e.x1, e.y1) == (0.0, 0.0, 320.0, 90.0)
    e = convert.clamp_edges(Extent(500, 500, 600, 600), 320, 240)
    assert e.x1 - e.x0 >= 1 and e.y1 - e.y0 >= 1


def test_the_palette_is_ordered_like_a_charts():
    p = convert.convert_picture(_gradient(), colours=5)
    counts = [e.count for e in p.palette]
    assert counts == sorted(counts, reverse=True)
    assert sum(counts) == p.rows * p.cols
    assert int(p.cells.max()) < len(p.palette) <= 5
    assert p.cells.dtype == np.uint16 and p.confidence.min() == 1.0
    assert all(e.name and e.dmc for e in p.palette)


def test_a_small_distinct_feature_gets_a_colour_of_its_own():
    """The dark pupil in a gradient: a few stitches out of thousands, but no other colour
    comes near it, so it must not be folded into a shade of the gradient."""
    img = _gradient()
    y, x = np.mgrid[0:240, 0:320]
    img[(x - 200) ** 2 + (y - 100) ** 2 < 9 ** 2] = (20, 20, 30)
    p = convert.convert_picture(img, colours=6)
    darkest = min(p.palette, key=lambda e: _hex_rgb(e.hex).sum())
    assert np.abs(_hex_rgb(darkest.hex) - (20, 20, 30)).max() <= 8
    assert darkest.count >= 4


def test_a_large_plain_area_keeps_its_colour():
    """Detail wins small areas a colour, but never at the cost of a large plain one (a
    white background covering half the picture was once folded into beige)."""
    img = _gradient()
    img[:, :160] = 255
    p = convert.convert_picture(img, colours=6)
    assert "#ffffff" in [e.hex for e in p.palette]
    left = p.cells[:, : p.cols // 2 - 1]
    assert {p.palette[i].hex for i in np.unique(left)} == {"#ffffff"}


def test_smoothing_removes_speckle_and_detail_one_is_the_nearest_colour():
    rng = np.random.default_rng(1)
    img = _field()
    img[:, 160:] = (60, 90, 150)
    noise = rng.random((240, 320)) < 0.04                       # speckle of the other colour
    img[noise & (np.arange(320)[None, :] < 160)] = (60, 90, 150)
    img[noise & (np.arange(320)[None, :] >= 160)] = (200, 190, 170)
    img = np.repeat(np.repeat(img[::4, ::4], 4, 0), 4, 1)     # speckle a stitch big or so
    rough = convert.convert_picture(img, colours=2, detail=1.0)
    smooth = convert.convert_picture(img, colours=2, detail=0.3)
    assert _lone_stitches(smooth.cells) < _lone_stitches(rough.cells) / 3

    st = convert.PictureState(img=img, extent=convert.whole(img), colours=2, detail=1.0)
    st.preview()
    nearest = np.argmin(st._costs[1], axis=2)
    got = st.preview().cells
    # Same partition (the palette is reordered by count).
    assert len({(a, b) for a, b in zip(nearest.ravel(), got.ravel())}) == 2


def test_a_thin_line_survives_default_smoothing():
    """A one-stitch-wide dark line across a light field is a feature, not noise: its
    stitches carry detail, and a change along a row costs more than up a column."""
    img = _field()
    img[118:122, :] = (30, 30, 30)                              # 4 px of 5.33 px stitches
    p = convert.convert_picture(img, colours=2)
    dark = [i for i, e in enumerate(p.palette) if _hex_rgb(e.hex).sum() < 200]
    assert dark, [e.hex for e in p.palette]
    rows_with_line = [(p.cells[r] == dark[0]).mean() for r in range(p.rows)]
    assert max(rows_with_line) > 0.9


def test_two_colours_in_one_are_one_of_them_not_their_mean():
    """With fewer colours than the picture has, yellow and orange share one, and it must be
    one of them: their mean made the Moon Stick's crescent an olive beige."""
    yellow, orange = np.array([250, 210, 75]), np.array([235, 170, 72])
    img = _field(colour=(255, 255, 255))
    img[40:200, 20:150] = yellow
    img[40:200, 170:280] = orange
    p = convert.convert_picture(img, cols=40, colours=2)
    (shared,) = [_hex_rgb(e.hex) for e in p.palette if e.hex != "#ffffff"]
    assert min(np.abs(shared - yellow).max(), np.abs(shared - orange).max()) <= 3, shared


def test_a_photos_colours_are_still_means():
    """A photo's colour is a spread of shades, and its mean stands for it better than its
    most common shade (a parrot's red beak, sharing a colour with brown ground, went
    brown): the most common shade is for drawings, which are flat colour."""
    rng = np.random.default_rng(3)
    yellow, orange = np.array([250, 210, 75]), np.array([235, 170, 72])
    img = _field(colour=(255, 255, 255)).astype(np.float64)
    img[40:200, 20:150] = yellow
    img[40:200, 170:280] = orange
    img = np.clip(img + rng.normal(0, 6, img.shape), 0, 255).astype(np.uint8)   # grain
    st = convert.PictureState(img=img, extent=convert.whole(img), cols=40, colours=2)
    p = st.preview()
    assert st._samples[1].flat < convert._FLAT_SHARE
    (shared,) = [_hex_rgb(e.hex) for e in p.palette if _hex_rgb(e.hex).min() < 200]
    assert min(np.abs(shared - yellow).max(), np.abs(shared - orange).max()) > 8, shared


def test_the_state_caches_each_step(monkeypatch):
    st = convert.PictureState(img=_gradient(), extent=Extent(0, 0, 320, 240))
    calls = {"sample": 0, "colours": 0, "assign": 0}
    for name, key in (("sample_stitches", "sample"), ("choose_colours", "colours"),
                      ("assign_stitches", "assign")):
        real = getattr(convert, name)

        def counting(*a, _real=real, _key=key, **kw):
            calls[_key] += 1
            return _real(*a, **kw)

        monkeypatch.setattr(convert, name, counting)
    st.preview()
    st.preview()
    assert calls == {"sample": 1, "colours": 1, "assign": 1}
    st.set_detail(0.1)
    st.preview()
    assert calls == {"sample": 1, "colours": 1, "assign": 2}
    st.set_colours(3)
    st.preview()
    assert calls == {"sample": 1, "colours": 2, "assign": 3}
    st.set_width(30)
    st.preview()
    assert calls == {"sample": 2, "colours": 3, "assign": 4}


@pytest.mark.parametrize("shape", [(1, 1), (3, 50), (50, 3)])
def test_tiny_pictures_still_convert(shape):
    img = np.zeros(shape + (3,), np.uint8)
    img[..., 0] = np.arange(shape[1])[None, :] * 5
    p = convert.convert_picture(img)
    assert p.cols <= shape[1] and p.rows <= shape[0]
    assert p.cells.shape == (p.rows, p.cols)
