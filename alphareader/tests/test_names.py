"""Everyday colour names (core/detect/names.py): plain when a name is used once, told
apart when it isn't, and never two the same."""
from __future__ import annotations

import json
import os

import numpy as np
import pytest

from alphareader.core.detect.names import ciede2000, simple_names

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_one_of_a_kind_keeps_the_plain_name():
    assert simple_names(["#c6e3ee", "#ffffff"]) == ["Blue", "White"]
    assert simple_names(["#610023"]) == ["Burgundy"]
    assert simple_names(["#06c2ac", "#e50000", "#15b01a"]) == ["Turquoise", "Red", "Green"]


def test_two_of_a_kind_are_dark_and_light():
    assert simple_names(["#8ab8e8", "#1a2a80"]) == ["Light blue", "Dark blue"]


def test_three_of_a_kind():
    assert simple_names(["#232812", "#4b503a", "#333822"]) == ["Dark olive", "Light olive", "Olive"]


def test_the_chart_that_was_all_dark_blue():
    # A chart the owner reported, whose palette DMC naming called "Dark Blue" three times.
    # #5539d3 is on the border of blue and purple (the survey's nearest name for it is
    # "blurple"); with three clear blues beside it, it is the purple, and the dusty
    # #834cae beside it is the muted one.
    names = simple_names(["#0a038f", "#e40ea2", "#5bbbea", "#bfe4f0", "#5539d3", "#834cae"])
    assert names == ["Dark blue", "Pink", "Blue", "Light blue", "Bright purple", "Muted purple"]
    # Alone, it is nearest to blue.
    assert simple_names(["#5539d3"]) == ["Blue"]


def test_a_border_colour_only_moves_out_of_a_crowded_name():
    # Two blues are told apart by their words; the blue-violet stays blue.
    assert simple_names(["#0a038f", "#5539d3"]) == ["Dark blue", "Blue"]
    # A pale blue is never moved to grey, however many blues there are.
    names = simple_names(["#0a038f", "#5bbbea", "#bfe4f0", "#3050c0"])
    assert "Grey" not in " ".join(names)


def test_dull_colours_do_not_move():
    # A dark olive-grey is near every name, so it isn't "on the border" of teal.
    names = simple_names(["#232812", "#333822", "#4b503a"])
    assert names == ["Dark olive", "Olive", "Light olive"]


def test_two_differing_in_hue_lean_either_way():
    assert simple_names(["#009fc6", "#3b98d5"]) == ["Greenish blue", "Purplish blue"]
    # When lightness differs about as much, Dark and Light are plainer.
    assert simple_names(["#345b94", "#55a4ba"]) == ["Blue", "Light blue"]


def test_neutrals_are_black_white_and_greys():
    assert simple_names(["#010101", "#151718", "#313131", "#ffffff"]) == \
        ["Black", "Dark grey", "Grey", "White"]
    assert simple_names(["#000000", "#ffffff"]) == ["Black", "White"]
    # Unlike a hue, a grey alone still says how dark it is.
    assert simple_names(["#e7e8ec", "#272930"]) == ["White", "Dark grey"]
    assert simple_names(["#ffffff", "#929591"]) == ["White", "Grey"]


def test_same_lightness_different_strength_is_bright_and_muted():
    assert simple_names(["#dc1e30", "#ad3a3a"]) == ["Bright red", "Muted red"]


def test_more_than_five_are_numbered_from_the_darkest():
    greys = ["#{0:02x}{0:02x}{0:02x}".format(v) for v in (150, 70, 110, 190, 90, 130, 170)]
    assert simple_names(greys) == ["Grey 5", "Grey 1", "Grey 3", "Grey 7", "Grey 2", "Grey 4", "Grey 6"]


@pytest.mark.parametrize("seed", range(20))
def test_names_are_always_different(seed):
    rng = np.random.default_rng(seed)
    for n in (2, 5, 12, 40):
        hexes = ["#{:02x}{:02x}{:02x}".format(*c) for c in rng.integers(0, 256, size=(n, 3))]
        names = simple_names(hexes)
        assert len(set(names)) == n, names
        assert all(names)


def test_ciede2000_matches_sharmas_test_data():
    # The first pairs of Sharma, Wu and Dalal's table ("The CIEDE2000 color-difference
    # formula: implementation notes, supplementary test data...", 2005).
    pairs = [
        ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
        ((50.0, 3.1571, -77.2803), (50.0, 0.0, -82.7485), 2.8615),
        ((50.0, 2.8361, -74.0200), (50.0, 0.0, -82.7485), 3.4412),
        ((50.0, -1.3802, -84.2814), (50.0, 0.0, -82.7485), 1.0000),
        ((50.0, 0.0, 0.0), (50.0, -1.0, 2.0), 2.3669),
        ((50.0, 2.49, -0.001), (50.0, -2.49, 0.0009), 7.1792),
        ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
        ((22.7233, 20.0904, -46.6940), (23.0331, 14.9730, -42.5619), 2.0373),
        ((90.8027, -2.0831, 1.4410), (91.1528, -1.6435, 0.0447), 1.4441),
        ((2.0776, 0.0795, -1.1350), (0.9033, -0.0636, -0.5514), 0.9082),
    ]
    for x, y, want in pairs:
        assert ciede2000(x, y) == pytest.approx(want, abs=1e-4)


def test_the_two_copies_of_the_name_table_are_the_same():
    with open(os.path.join(ROOT, "alphareader", "core", "detect", "colour_names.json")) as a, \
            open(os.path.join(ROOT, "web", "src", "importer", "colour-names.json")) as b:
        assert json.load(a) == json.load(b)
