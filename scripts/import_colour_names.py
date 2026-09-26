"""Build the table detection names colours from: everyday colour names, each anchored at
the colours people call by that name.

    python scripts/import_colour_names.py

Writes alphareader/core/detect/colour_names.json and the web app's copy,
web/src/importer/colour-names.json (web/tests/importer/names.test.ts keeps them equal).

Source (provenance: web/src/importer/README.md): the xkcd colour survey's results,
https://xkcd.com/color/rgb.txt, released CC0. Each hex there is the average of the
colours that survey takers gave that name. Nothing here is typed in by hand except which
names are used and which everyday name each one counts as (FAMILIES below): "navy" and
"sky blue" are both blue, so a chart with one of each says "Dark blue" and "Light blue".
The survey's own hex for every anchor comes from the file; a name missing from it, or a
file whose licence line has changed, makes this fail rather than guess.
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTS = [ROOT / "alphareader" / "core" / "detect" / "colour_names.json",
        ROOT / "web" / "src" / "importer" / "colour-names.json"]
SOURCE = "https://xkcd.com/color/rgb.txt"
LICENCE_LINE = "# License: https://creativecommons.org/publicdomain/zero/1.0/"

# Each everyday name, and the survey names that count as it. The first is the plain
# colour: the "dark" and "light" in a name are measured from its lightness. Grey's
# "black" and "white" anchors name the darkest and lightest neutrals.
FAMILIES: list[tuple[str, list[str]]] = [
    ("grey", ["grey", "black", "charcoal", "dark grey", "light grey", "white"]),
    ("cream", ["cream", "ivory", "off white"]),
    ("beige", ["beige", "light beige", "dark beige", "tan", "light tan", "dark tan"]),
    ("brown", ["brown", "light brown", "dark brown"]),
    ("red", ["red", "dark red", "light red"]),
    ("burgundy", ["burgundy", "maroon", "wine"]),
    ("pink", ["pink", "light pink", "dark pink", "hot pink", "baby pink", "pale pink",
              "dusty pink", "rose"]),
    ("magenta", ["magenta", "fuchsia", "dark magenta"]),
    ("coral", ["coral", "salmon"]),
    ("peach", ["peach", "light peach"]),
    ("orange", ["orange", "light orange", "dark orange", "burnt orange"]),
    ("yellow", ["yellow", "light yellow", "pale yellow"]),
    ("mustard", ["mustard", "dark yellow", "gold", "dark mustard"]),
    ("olive", ["olive", "dark olive", "light olive", "khaki"]),
    ("lime", ["lime", "light lime", "dark lime"]),
    ("green", ["green", "light green", "dark green", "forest green", "pale green"]),
    ("mint", ["mint", "light mint", "mint green"]),
    ("teal", ["teal", "dark teal"]),
    ("turquoise", ["turquoise", "light turquoise", "aqua", "light aqua", "cyan"]),
    ("blue", ["blue", "light blue", "dark blue", "royal blue", "sky blue", "baby blue",
              "pale blue", "navy"]),
    ("purple", ["purple", "dark purple", "light purple", "violet", "plum", "dark violet"]),
    ("lilac", ["lilac", "lavender", "pale lilac", "light lavender", "light violet",
               "pale violet"]),
]


def survey(text: str) -> dict[str, str]:
    lines = text.splitlines()
    if lines[0].strip() != LICENCE_LINE:
        sys.exit(f"{SOURCE}: expected the licence line {LICENCE_LINE!r}, got {lines[0]!r}")
    out = {}
    for line in lines[1:]:
        name, hex_str = line.split("\t")[:2]
        out[name] = hex_str.strip().lower()
    return out


def main() -> None:
    raw = urllib.request.urlopen(SOURCE, timeout=30).read()
    names = survey(raw.decode("utf-8"))
    families = []
    for family, anchors in FAMILIES:
        missing = [a for a in anchors if a not in names]
        if missing:
            sys.exit(f"{SOURCE} has no {missing}")
        families.append({"name": family, "anchors": [{"name": a, "hex": names[a]} for a in anchors]})
    doc = {
        "source": f"{SOURCE}, the xkcd colour survey's results, CC0",
        "sha256": hashlib.sha256(raw).hexdigest(),
        "families": families,
    }
    text = json.dumps(doc, indent=1) + "\n"
    for out in OUTS:
        out.write_text(text, encoding="utf-8")
        print(f"wrote {out.relative_to(ROOT)}: {len(families)} names, "
              f"{sum(len(f['anchors']) for f in families)} anchors")


if __name__ == "__main__":
    main()
