"""Keeping a drawing's outlines (core/outlines.py, convert.PictureState(outlines=True))."""
from __future__ import annotations

import os

import numpy as np
import pytest
from PIL import Image

from ..core import convert
from ..core.bridge import _on_white
from ..core.confirm import Extent
from ..core.outlines import centrelines, ink_mask, outline_stitches, thin

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PICTURES = os.path.join(ROOT, "test_images", "pictures")


def _ring(h=400, w=400, r=150, width=3, inside=(255, 255, 255), line=(20, 20, 20)) -> np.ndarray:
    """A circle drawn as a line on white: a shape that is nothing but its outline."""
    y, x = np.mgrid[0:h, 0:w]
    d = np.hypot(y - h / 2, x - w / 2)
    img = np.full((h, w, 3), 255, np.uint8)
    img[d < r] = inside
    img[np.abs(d - r) < width / 2] = line
    return img


def _groups(b: np.ndarray) -> list[int]:
    """Sizes of the 8-connected groups of marked stitches."""
    from ..core.outlines import _components
    return sorted((len(g) for g in _components(b)), reverse=True)


def test_thinning_keeps_one_connected_pixel_wide_line():
    img = np.zeros((60, 80), bool)
    img[20:25, 5:75] = True                       # a bar 5 px thick
    img[5:55, 38:43] = True                       # crossed by another
    t = thin(img)
    assert _groups(t) == [int(t.sum())]           # still one piece
    # One pixel wide: no 2 × 2 block anywhere.
    assert not (t[:-1, :-1] & t[1:, :-1] & t[:-1, 1:] & t[1:, 1:]).any()


def test_ink_is_a_dark_line_not_the_edge_of_a_dark_area():
    img = np.full((120, 200, 3), 255, np.uint8)
    img[:, 20:23] = (30, 30, 30)                  # a drawn line
    img[30:90, 100:190] = (200, 20, 20)           # a red area, dark enough (L* ≈ 43)
    img[40:80, 120:170] = (20, 20, 20)            # a black area
    ink, _ = ink_mask(img)
    assert ink[:, 20:23].mean() > 0.9
    # Neither area's edge is a line, nor its inside.
    assert not ink[35:85, 95:195].any()


def test_a_tapered_line_end_is_still_ink():
    """Drawn lines get lighter where they thin out: the Moon Stick's reach L* 49."""
    img = np.full((80, 80, 3), 255, np.uint8)
    img[:, 38:41] = (110, 110, 110)               # L* ≈ 47
    ink, _ = ink_mask(img)
    assert ink[:, 38:41].mean() > 0.9


@pytest.mark.parametrize("cols", [20, 30, 40, 60])
def test_a_circle_drawn_as_a_line_becomes_a_closed_ring_one_stitch_thick(cols):
    img = _ring()
    lines, ink = centrelines(img)
    assert ink is not None and ink.max() < 60
    rows = cols
    b = outline_stitches(lines, convert.whole(img), rows, cols)
    assert _groups(b) == [int(b.sum())]           # one closed piece
    assert not (b[:-1, :-1] & b[1:, :-1] & b[:-1, 1:] & b[1:, 1:]).any()
    # About the circle's circumference in stitches: 2π · 150 px at 400/cols px a stitch.
    around = 2 * np.pi * 150 / (400 / cols)
    assert 0.8 * around <= b.sum() <= 1.6 * around
    # The inside isn't touched.
    c = cols // 2
    assert not b[c - cols // 6:c + cols // 6, c - cols // 6:c + cols // 6].any()


def test_a_clump_of_lines_keeps_only_its_outline():
    """A small box crammed with little outlines (an ornament of gems) at a size where they
    can't all fit keeps its edge, and the colours inside come back."""
    img = np.full((400, 400, 3), 255, np.uint8)
    img[100:300, 100:300] = (230, 180, 60)        # a gold box ...
    for i in range(110, 300, 14):                 # ... crammed with lines
        img[i:i + 3, 100:300] = (20, 20, 20)
        img[100:300, i:i + 3] = (20, 20, 20)
    lines, _ = centrelines(img)
    b = outline_stitches(lines, convert.whole(img), 20, 20)
    # The box covers stitches 5–14; the clump, widened by a stitch to bridge its gaps,
    # keeps its edge at 4 and 15, and everything inside goes back to gold.
    assert not b[5:15, 5:15].any()
    assert b[5:15, 4].all() and b[5:15, 15].all() and b[4, 5:15].all() and b[15, 5:15].all()


def test_specks_are_dropped():
    img = np.full((400, 400, 3), 255, np.uint8)
    img[200:203, 200:210] = (20, 20, 20)          # a dash, under a stitch long
    lines, _ = centrelines(img)
    assert not outline_stitches(lines, convert.whole(img), 20, 20).any()


def test_no_ink_no_outline():
    img = np.full((100, 100, 3), 255, np.uint8)
    img[30:70, 30:70] = (200, 60, 60)
    lines, ink = centrelines(img)
    assert ink is None and not lines.any()
    off = convert.convert_picture(img, cols=20)
    on = convert.convert_picture(img, cols=20, outlines=True)
    assert np.array_equal(off.cells, on.cells)


def test_outlines_on_draw_a_shape_that_is_only_its_line():
    """White on white, the circle is its outline alone: off, it vanishes; on, it's there,
    in the ink's colour, as a colour of its own."""
    img = _ring()
    off = convert.convert_picture(img, cols=40, colours=4)
    on = convert.convert_picture(img, cols=40, colours=4, outlines=True)
    assert [e.hex for e in off.palette] == ["#ffffff"] or len(off.palette) <= 2
    dark = [i for i, e in enumerate(on.palette) if sum(int(e.hex[k:k + 2], 16) for k in (1, 3, 5)) < 150]
    assert len(dark) == 1
    assert 0.8 * 2 * np.pi * 15 <= (on.cells == dark[0]).sum() <= 1.6 * 2 * np.pi * 15


def test_the_ink_is_the_pictures_black_when_it_has_one():
    """with_ink: reuse a colour within ΔE 20, replace one within 45, else add."""
    black = np.array([[0.0, 0.0, 0.0], [255.0, 255.0, 255.0]])
    lab = convert.srgb_to_lab(black)
    _, _, index, added = convert.with_ink(lab, black, np.array([12.0, 12.0, 12.0]))
    assert (index, added) == (0, False)
    grey = np.array([[90.0, 90.0, 90.0], [255.0, 255.0, 255.0]])
    lab2, rgb2, index, added = convert.with_ink(convert.srgb_to_lab(grey), grey, np.array([20.0, 20.0, 20.0]))
    assert (index, added, list(rgb2[0])) == (0, False, [20.0, 20.0, 20.0])
    pale = np.array([[250.0, 220.0, 120.0], [255.0, 255.0, 255.0]])
    lab3, rgb3, index, added = convert.with_ink(convert.srgb_to_lab(pale), pale, np.array([20.0, 20.0, 20.0]))
    assert (index, added, rgb3.shape[0]) == (2, True, 3)


def test_outline_stitches_are_ink_whatever_the_smoothing():
    img = _ring()
    st = convert.PictureState(img=img, extent=convert.whole(img), cols=40, colours=4, outlines=True)
    counts = []
    for detail in (0.0, 0.5, 1.0):
        st.set_detail(detail)
        p = st.preview()
        counts.append(int((p.cells == min(range(len(p.palette)), key=lambda i: int(p.palette[i].hex[1:3], 16))).sum()))
    assert len(set(counts)) == 1


def test_the_same_drawing_gives_the_same_outline():
    img = _ring()
    a = convert.convert_picture(img, cols=40, outlines=True)
    b = convert.convert_picture(img.copy(), cols=40, outlines=True)
    assert np.array_equal(a.cells, b.cells) and [e.hex for e in a.palette] == [e.hex for e in b.palette]


def _corpus(name: str) -> np.ndarray:
    rgba = np.asarray(Image.open(os.path.join(PICTURES, name)).convert("RGBA"))
    h, w = rgba.shape[:2]
    flat = _on_white(rgba.tobytes(), w, h)
    return np.ascontiguousarray(rgba[..., :3]) if flat is None else flat


def test_drawings_get_one_continuous_black_outline():
    img = _corpus("coat-of-arms.png")
    st = convert.PictureState(img=img, extent=convert.whole(img), cols=40, colours=6, outlines=True)
    p = st.preview()
    mask = st._outline[1]
    sizes = _groups(mask)
    assert sizes[0] >= 0.8 * int(mask.sum())      # almost all of it one line
    ink = p.palette[int(p.cells[mask][0])]
    assert ink.name == "Black"


def test_lines_wide_enough_to_survive_are_left_to_the_conversion():
    """The smiley's outline is ~20 px in a 960 px image, half a stitch at 40 wide: it's
    black with the switch off, and on, nothing is traced (a line that wide isn't a ridge
    3 or 6 px across) and nothing changes."""
    img = _corpus("smiley.png")
    off = convert.convert_picture(img, cols=40, colours=6)
    on = convert.convert_picture(img, cols=40, colours=6, outlines=True)
    assert "Black" in {e.name for e in off.palette}
    assert np.array_equal(off.cells, on.cells)


def test_the_coat_of_arms_loses_its_edge_smudge():
    """Off, the anti-aliased edges take colours of their own (greys, a muted red); on, the
    outline takes those stitches, and the colours are the shield's."""
    img = _corpus("coat-of-arms.png")
    off = convert.convert_picture(img, cols=40, colours=6)
    on = convert.convert_picture(img, cols=40, colours=6, outlines=True)
    assert len(on.palette) < len(off.palette)
    assert {"White", "Black", "Red"} <= {e.name for e in on.palette}
