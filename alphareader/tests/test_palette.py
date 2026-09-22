"""Palette recovery: rare colours must survive, and a lost colour must be reported.

The failure these guard against is the nastiest kind the detector can produce — a chart
whose dimensions are perfectly right but whose palette quietly lost a colour, so the cells
of that colour are recoloured into their neighbour with nothing to indicate it.
"""
from __future__ import annotations

import numpy as np
import pytest

from alphareader.core.detect import palette as P
from alphareader.core.detect import pipeline as PL
from alphareader.core.model import PaletteEntry
from alphareader.tests import synth

WHITE = (255, 255, 255)
BROWN = (150, 90, 40)
PURPLE = (120, 60, 160)


def _entries(*rgbs):
    return [PaletteEntry(id=str(i), hex="#{:02x}{:02x}{:02x}".format(*c), name=f"c{i}")
            for i, c in enumerate(rgbs)]


def test_sparse_chart_keeps_its_rare_colours():
    """A chart that is 99.8% one colour still has to report the other colours.

    Seed 119 is the case that motivated this: 2047 white cells and five coloured ones.
    Those five are the noisiest cells on the chart (isolated blocks ring badly under
    JPEG), so a reliability filter keyed on sample spread throws away every cell carrying
    a non-background colour, and the palette collapses to white plus one.
    """
    spec = synth.random_spec(np.random.default_rng(119))
    used = sorted(set(spec.cells.ravel().tolist()))
    assert len(used) >= 3, "seed 119 should be the sparse multi-colour trap"

    result = PL.detect_pattern(synth.render(spec))

    assert (result.rows, result.cols) == (spec.rows, spec.cols)
    # Every true colour must be represented by some entry. The palette may legitimately
    # over-segment (two noisy cells of one colour can land in separate entries), which the
    # confirmation screen can merge — losing a colour is what it cannot undo.
    found = P.srgb_to_lab(np.array([P.hex_to_rgb(e.hex) for e in result.palette]))
    for idx in used:
        truth = P.srgb_to_lab(np.array(spec.palette[idx], dtype=float))
        assert np.linalg.norm(found - truth, axis=1).min() < 15, \
            f"true colour {spec.palette[idx]} has no palette entry"


def test_count_unmatched_reports_a_missing_colour():
    """A cell far from the entry it was assigned means the palette lost a colour."""
    colors = np.array([[WHITE, WHITE], [WHITE, PURPLE]], dtype=np.uint8)
    cells = np.zeros((2, 2), dtype=np.uint16)          # everything assigned to white
    assert P.count_unmatched(colors, cells, _entries(WHITE), 6.0) == 1


def test_count_unmatched_is_quiet_when_the_palette_explains_everything():
    colors = np.array([[WHITE, WHITE], [WHITE, PURPLE]], dtype=np.uint8)
    cells = np.array([[0, 0], [0, 1]], dtype=np.uint16)
    assert P.count_unmatched(colors, cells, _entries(WHITE, PURPLE), 6.0) == 0


def test_detection_warns_rather_than_losing_a_colour_silently():
    """The backstop: if recovery ever fails to re-admit a colour, say so.

    Recovery is disabled here on purpose, to prove the warning does not depend on it —
    a wrong result is tolerable only when it is flagged (§13.8).
    """
    spec = synth.random_spec(np.random.default_rng(119))
    img = synth.render(spec)
    original = P._keep_unexplained
    P._keep_unexplained = lambda flat, reliable, delta_e: reliable
    try:
        result = PL.detect_pattern(img)
    finally:
        P._keep_unexplained = original
    assert len(result.palette) < len(set(spec.cells.ravel().tolist())), \
        "expected the un-recovered palette to collapse"
    assert any("may be missing" in w for w in result.warnings), \
        "a collapsed palette must warn; silent is the one thing it may not be"


@pytest.mark.parametrize("blend", [0.35, 0.5, 0.65])
def test_blended_edge_cells_do_not_mint_a_phantom_colour(blend):
    """A cell that straddled a gridline is a mixture, not a new colour.

    Its median lands on the line between the two colours it mixes, which is exactly what
    separates it from a genuinely missing colour sitting off on its own.
    """
    mix = tuple(int(round(a * (1 - blend) + b * blend))
                for a, b in zip(WHITE, BROWN))
    flat = np.array([WHITE] * 40 + [BROWN] * 40 + [mix], dtype=np.uint8)
    reliable = np.ones(len(flat), dtype=bool)
    reliable[-1] = False                                # the straddling cell
    assert not P._keep_unexplained(flat, reliable, 6.0)[-1]


def test_a_genuinely_missing_colour_is_re_admitted():
    """The counterpart: an excluded colour that is nobody's mixture comes back."""
    flat = np.array([WHITE] * 40 + [BROWN] * 40 + [PURPLE], dtype=np.uint8)
    reliable = np.ones(len(flat), dtype=bool)
    reliable[-1] = False
    assert P._keep_unexplained(flat, reliable, 6.0)[-1]
