"""Everyday names for a palette's colours (§5 step 8): "Blue", "Dark blue", "Burgundy".

Each colour takes the everyday name of its nearest anchor in colour_names.json (the xkcd
colour survey's averages, built by scripts/import_colour_names.py), by CIEDE2000, which
unlike plain Lab distance keeps blues from sliding into purples.

Names are chosen for the palette, not one colour at a time, because that is how people
see them: next to strong blues, a blue-violet reads as purple. A colour on the border
between two names (the second within `_BORDER` times the first's distance) takes the
second when that leaves fewer colours sharing a name (`_families`). The survey itself
calls #5539d3 "blurple"; in a chart of four blues it is the purple.

A name used once is left plain: one blue is "Blue", however light. Colours sharing a
name are told apart:

- by lightness, measured from the plain colour's: "Dark blue", "Blue", "Light blue".
  "Very dark" and "Very light" only when four or five share a name. When two would get
  the same word, they move apart the least that keeps them in order (`_spread`);
- two that differ most in strength are "Bright pink" and "Muted pink";
- two that differ most in hue lean towards the hues either side: "Bluish purple" and
  "Pinkish purple" (`_HUES`);
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
# How much further than its nearest name a colour's second name may be for it to count
# as on the border between them.
_BORDER = 1.75
# Only a name shared by this many colours gives one up (two are told apart well enough by
# their words), and only a colour this strong (CIELAB chroma) moves: a dull dark colour
# is near every name, so being "on the border" means nothing for it.
_CROWD = 3
_MOVE_CHROMA = 20.0
# Dark and Light are the plainest words, so two colours are told apart by strength or hue
# only when that difference is this many times their difference in lightness.
_CLEAR = 1.5
# The hues a name can lean towards, with the word for leaning ("Bluish purple").
_HUES = {"red": "Reddish", "orange": "Orangey", "yellow": "Yellowish", "green": "Greenish",
         "blue": "Bluish", "purple": "Purplish", "pink": "Pinkish"}


def _lab(hex_str: str) -> tuple[float, float, float]:
    from .palette import hex_to_rgb, srgb_to_lab
    l, a, b = srgb_to_lab(np.array(hex_to_rgb(hex_str), dtype=np.float64))
    return float(l), float(a), float(b)


@lru_cache(maxsize=1)
def _anchors() -> tuple[list[tuple[str, str, tuple[float, float, float]]],
                        dict[str, tuple[float, float, float]]]:
    """(family, anchor name, Lab) for every anchor, and each family's plain colour."""
    with resources.files(__package__).joinpath("colour_names.json").open() as fh:
        doc = json.load(fh)
    anchors, plain = [], {}
    for fam in doc["families"]:
        for i, a in enumerate(fam["anchors"]):
            lab = _lab(a["hex"])
            anchors.append((fam["name"], a["name"], lab))
            if i == 0:
                plain[fam["name"]] = lab
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


def _hue(lab: tuple[float, float, float]) -> float:
    return math.degrees(math.atan2(lab[2], lab[1])) % 360


def _turn(a: float, b: float) -> float:
    """From hue a to hue b, the short way round, in degrees (-180, 180]."""
    d = (b - a) % 360
    return d - 360 if d > 180 else d


def _leanings(fam: str) -> tuple[str, str]:
    """The words for leaning each way round the hue circle from `fam`'s plain colour: the
    nearest of _HUES's other names below it, and above it."""
    _, plain = _anchors()
    h = _hue(plain[fam])
    turns = [(_turn(h, _hue(plain[f])), f) for f in _HUES if f != fam]
    below = max((t, f) for t, f in turns if t < 0)[1]
    above = min((t, f) for t, f in turns if t > 0)[1]
    return _HUES[below], _HUES[above]


def _families(labs: list[tuple[float, float, float]]) -> tuple[list[str], list[int]]:
    """Each colour's name, and its nearest anchor. A colour on the border between two
    names, sharing its name with at least _CROWD - 1 others and at least _MOVE_CHROMA
    strong, moves to the other while that leaves a name with two fewer colours than it had
    (so the sum of squared group sizes falls and this ends); the move costing least
    distance goes first, then the earliest colour, then the earliest name. Only colours
    cross: nothing moves into or out of grey, as coloured or not is never in doubt the
    way blue or purple can be. Black and white neither move nor count, being named by
    their own anchors."""
    anchors, _ = _anchors()
    order = list(dict.fromkeys(a[0] for a in anchors))
    near, dist = [], []
    for lab in labs:
        best, best_d, by_fam = -1, math.inf, {}
        for k, (f, _, a) in enumerate(anchors):
            d = ciede2000(lab, a)
            if d < best_d:
                best, best_d = k, d
            if d < by_fam.get(f, math.inf):
                by_fam[f] = d
        near.append(best)
        dist.append(by_fam)
    fams = [anchors[k][0] for k in near]
    fixed = [anchors[k][1] in ("black", "white") for k in near]
    borders = [[] if fixed[i] or _chroma(labs[i]) < _MOVE_CHROMA else
               [f for f in order if f != fams[i] and "grey" not in (f, fams[i])
                and dist[i][f] <= _BORDER * dist[i][fams[i]]]
               for i in range(len(labs))]
    while True:
        size: dict[str, int] = {}
        for i, f in enumerate(fams):
            if not fixed[i]:
                size[f] = size.get(f, 0) + 1
        best_move = None
        for i, alts in enumerate(borders):
            for f in alts:
                if f != fams[i] and size[fams[i]] >= _CROWD and size.get(f, 0) + 1 < size[fams[i]]:
                    key = (dist[i][f] - dist[i][fams[i]], i, order.index(f))
                    if best_move is None or key < best_move[0]:
                        best_move = (key, i, f)
        if best_move is None:
            return fams, near
        fams[best_move[1]] = best_move[2]


def _axis(x: tuple[float, float, float], y: tuple[float, float, float], fam: str) -> str:
    """What two colours of one name differ in most: "lightness", "chroma" or "hue" (the
    CIE76 hue difference), with lightness kept unless another is _CLEAR times it. Greys
    differ only in lightness."""
    dl = abs(x[0] - y[0])
    dc = abs(_chroma(x) - _chroma(y))
    de2 = (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2
    dh = math.sqrt(max(0.0, de2 - dl * dl - dc * dc))
    if fam == "grey" or _CLEAR * dl >= max(dc, dh):
        return "lightness"
    return "chroma" if dc >= dh else "hue"


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def simple_names(hexes: list[str]) -> list[str]:
    """A different everyday name for each colour of a palette."""
    anchors, plain = _anchors()
    labs = [_lab(h) for h in hexes]
    fams, near = _families(labs)
    out = [""] * len(hexes)
    groups: dict[str, list[int]] = {}
    for i, f in enumerate(fams):
        groups.setdefault(f, []).append(i)
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
        elif n == 2 and _axis(labs[members[0]], labs[members[1]], fam) == "chroma":
            strong, weak = sorted(members, key=lambda i: (-_chroma(labs[i]), i))
            out[strong], out[weak] = f"Bright {fam}", f"Muted {fam}"
        elif n == 2 and _axis(labs[members[0]], labs[members[1]], fam) == "hue":
            below, above = _leanings(fam)
            a, b = members
            if _turn(_hue(labs[a]), _hue(labs[b])) < 0:
                a, b = b, a
            out[a], out[b] = f"{below} {fam}", f"{above} {fam}"
        elif n <= len(_WORDS):
            slots = _spread([_ideal_slot(labs[i][0], plain[fam][0]) for i in members])
            for i, s in zip(members, slots):
                out[i] = f"{_WORDS[s]} {fam}" if s != _PLAIN else _cap(fam)
        else:
            for k, i in enumerate(members):
                out[i] = f"{_cap(fam)} {k + 1}"
    return out
