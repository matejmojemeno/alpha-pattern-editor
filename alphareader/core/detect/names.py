"""Everyday names for a palette's colours (§5 step 8): "Blue", "Dark blue", "Burgundy".

Each colour takes the everyday name of its nearest anchor in colour_names.json (the xkcd
colour survey's averages, built by scripts/import_colour_names.py), by CIEDE2000, which
unlike plain Lab distance keeps blues from sliding into purples. A name used once is left
plain: one blue is "Blue", however light. Colours sharing a name are told apart:

- by lightness, measured from the plain colour's: "Dark blue", "Blue", "Light blue".
  "Very dark" and "Very light" only when four or five share a name. When two would get
  the same word, they move apart the least that keeps them in order (`_spread`);
- two that differ more in strength than lightness are "Bright pink" and "Muted pink";
- neutrals: the darkest is "Black" and the lightest "White" when those are their
  nearest anchors, and the rest are greys, which say "Dark" or "Light" even alone:
  "Grey" for a near-black would mislead where "Blue" for a pale blue doesn't;
- past five of one name, "Grey 1", "Grey 2", … from the darkest.

So every name in a palette is different. web/src/importer/names.ts is a port;
fixtures/colour_names.json proves they agree.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from importlib import resources

import numpy as np

# The lightness words, darkest first, and the slot each one fills.
_WORDS = ["Very dark", "Dark", "", "Light", "Very light"]
_PLAIN = 2
# How far (in CIELAB L*) from the plain colour a colour must be to be called dark or
# light, and very dark or very light.
_STEP = 10.0
_VERY = 25.0


def _lab(hex_str: str) -> tuple[float, float, float]:
    from .palette import hex_to_rgb, srgb_to_lab
    l, a, b = srgb_to_lab(np.array(hex_to_rgb(hex_str), dtype=np.float64))
    return float(l), float(a), float(b)


@lru_cache(maxsize=1)
def _anchors() -> tuple[list[tuple[str, str, tuple[float, float, float]]], dict[str, float]]:
    """(family, anchor name, Lab) for every anchor, and each family's plain lightness."""
    with resources.files(__package__).joinpath("colour_names.json").open() as fh:
        doc = json.load(fh)
    anchors, plain = [], {}
    for fam in doc["families"]:
        for i, a in enumerate(fam["anchors"]):
            lab = _lab(a["hex"])
            anchors.append((fam["name"], a["name"], lab))
            if i == 0:
                plain[fam["name"]] = lab[0]
    return anchors, plain


def ciede2000(x: tuple[float, float, float], y: tuple[float, float, float]) -> float:
    """CIEDE2000 colour difference (Sharma, Wu and Dalal, 2005), kL = kC = kH = 1."""
    l1, a1, b1 = x
    l2, a2, b2 = y
    c_bar = (math.sqrt(a1 * a1 + b1 * b1) + math.sqrt(a2 * a2 + b2 * b2)) / 2
    c7 = c_bar ** 7
    g = 0.5 * (1 - math.sqrt(c7 / (c7 + 25.0 ** 7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.sqrt(a1p * a1p + b1 * b1), math.sqrt(a2p * a2p + b2 * b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if c1p else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if c2p else 0.0
    dlp, dcp = l2 - l1, c2p - c1p
    if c1p * c2p == 0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180:
        dhp = h2p - h1p
    elif h2p - h1p > 180:
        dhp = h2p - h1p - 360
    else:
        dhp = h2p - h1p + 360
    dhp_big = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(dhp / 2))
    lp_bar, cp_bar = (l1 + l2) / 2, (c1p + c2p) / 2
    if c1p * c2p == 0:
        hp_bar = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hp_bar = (h1p + h2p) / 2
    elif h1p + h2p < 360:
        hp_bar = (h1p + h2p + 360) / 2
    else:
        hp_bar = (h1p + h2p - 360) / 2
    t = (1 - 0.17 * math.cos(math.radians(hp_bar - 30)) + 0.24 * math.cos(math.radians(2 * hp_bar))
         + 0.32 * math.cos(math.radians(3 * hp_bar + 6)) - 0.20 * math.cos(math.radians(4 * hp_bar - 63)))
    d_theta = 30 * math.exp(-(((hp_bar - 275) / 25) ** 2))
    cp7 = cp_bar ** 7
    r_c = 2 * math.sqrt(cp7 / (cp7 + 25.0 ** 7))
    s_l = 1 + 0.015 * (lp_bar - 50) ** 2 / math.sqrt(20 + (lp_bar - 50) ** 2)
    s_c = 1 + 0.045 * cp_bar
    s_h = 1 + 0.015 * cp_bar * t
    r_t = -math.sin(math.radians(2 * d_theta)) * r_c
    return math.sqrt((dlp / s_l) ** 2 + (dcp / s_c) ** 2 + (dhp_big / s_h) ** 2
                     + r_t * (dcp / s_c) * (dhp_big / s_h))


def nearest_anchor(lab: tuple[float, float, float]) -> int:
    """The index of the nearest anchor; the first of equals, as np.argmin picks it."""
    anchors, _ = _anchors()
    best, best_d = -1, math.inf
    for i, (_, _, a) in enumerate(anchors):
        d = ciede2000(lab, a)
        if d < best_d:
            best, best_d = i, d
    return best


def _ideal_slot(l: float, plain: float) -> int:
    d = l - plain
    if d <= -_VERY:
        return 0
    if d <= -_STEP:
        return 1
    if d < _STEP:
        return 2
    if d < _VERY:
        return 3
    return 4


def _spread(ideal: list[int]) -> list[int]:
    """Strictly increasing slots, as close to `ideal` (non-decreasing) as they can be: the
    least total movement, and of equals the one found first (lowest slots). Up to three
    members use only Dark, plain and Light, so two blues are "Dark blue" and "Light
    blue", never "Very light blue"."""
    n = len(ideal)
    lo, hi = (1, 3) if n <= 3 else (0, 4)
    inf = math.inf
    # cost[i][s]: the least movement placing members 0..i with member i in slot s.
    cost = [[inf] * 5 for _ in range(n)]
    back = [[-1] * 5 for _ in range(n)]
    for s in range(lo, hi + 1):
        cost[0][s] = abs(s - ideal[0])
    for i in range(1, n):
        for s in range(lo, hi + 1):
            for p in range(lo, s):
                c = cost[i - 1][p] + abs(s - ideal[i])
                if c < cost[i][s]:
                    cost[i][s], back[i][s] = c, p
    s = min(range(lo, hi + 1), key=lambda k: cost[n - 1][k])
    out = [0] * n
    for i in range(n - 1, -1, -1):
        out[i] = s
        s = back[i][s]
    return out


def _chroma(lab: tuple[float, float, float]) -> float:
    return math.sqrt(lab[1] * lab[1] + lab[2] * lab[2])


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def simple_names(hexes: list[str]) -> list[str]:
    """A different everyday name for each colour of a palette."""
    anchors, plain = _anchors()
    labs = [_lab(h) for h in hexes]
    near = [nearest_anchor(lab) for lab in labs]
    out = [""] * len(hexes)
    groups: dict[str, list[int]] = {}
    for i, a in enumerate(near):
        groups.setdefault(anchors[a][0], []).append(i)
    for fam, members in groups.items():
        # Darkest first; equal lightness keeps palette order.
        members = sorted(members, key=lambda i: (labs[i][0], i))
        if fam == "grey":
            if anchors[near[members[0]]][1] == "black":
                out[members.pop(0)] = "Black"
            if members and anchors[near[members[-1]]][1] == "white":
                out[members.pop()] = "White"
        n = len(members)
        if n == 0:
            continue
        if n == 1 and fam != "grey":
            out[members[0]] = _cap(fam)
        elif n == 2 and abs(_chroma(labs[members[0]]) - _chroma(labs[members[1]])) > \
                abs(labs[members[0]][0] - labs[members[1]][0]):
            strong, weak = sorted(members, key=lambda i: (-_chroma(labs[i]), i))
            out[strong], out[weak] = f"Bright {fam}", f"Muted {fam}"
        elif n <= len(_WORDS):
            slots = _spread([_ideal_slot(labs[i][0], plain[fam]) for i in members])
            for i, s in zip(members, slots):
                out[i] = f"{_WORDS[s]} {fam}" if s != _PLAIN else _cap(fam)
        else:
            for k, i in enumerate(members):
                out[i] = f"{_cap(fam)} {k + 1}"
    return out
