"""Build web/src/yarn/data/*.json, the yarn colour libraries the web app matches against.

    python scripts/import_yarn_libraries.py

Sources (full provenance, licences and retrieval dates: web/src/yarn/data/README.md):

- Shade names and hex colours: the yarn colorway data of temperature-blanket.com,
  licensed CC BY 4.0, read from its public repository at a pinned commit.
- Scheepjes Colour Crafter shade numbers: the product page on scheepjes.com, whose
  swatches are listed in the same order as the colorway data (checked below, name by name).
- DMC: a copy of alphareader/core/detect/dmc.json, the table detection already uses, in
  the same format as the yarn libraries (web/tests/yarn/data.test.ts keeps them equal).

Nothing here is typed in by hand except the ball weights and lengths, which are quoted
from the pages named in LIBRARIES. A source that stops matching what this script
expects makes it fail rather than guess.
"""
from __future__ import annotations

import html
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "src" / "yarn" / "data"

UPSTREAM_COMMIT = "d22f7d9eb0cdf32aad9595931f01a33333b8d95a"
UPSTREAM = ("https://raw.githubusercontent.com/jdvlpr/Temperature-Blanket-Web-App/"
            f"{UPSTREAM_COMMIT}/src/lib/data/yarns")
ATTRIBUTION = "Yarn colours from temperature-blanket.com, licensed CC BY 4.0"
SCHEEPJES_PAGE = "https://www.scheepjes.com/en/colour-crafter-328/"

LIBRARIES = [
    {
        "id": "stylecraft-special-dk",
        "brand": "Stylecraft",
        "yarn": "Special DK",
        "path": "stylecraft/special-dk",
        # https://www.stylecraft-yarns.co.uk/yarns/special-dk: "100g", "295m/322yds"
        "ball": {"grams": 100, "metres": 295},
    },
    {
        "id": "paintbox-simply-dk",
        "brand": "Paintbox Yarns",
        "yarn": "Simply DK",
        "path": "paintbox-yarns/simply-dk",
        # https://www.lovecrafts.com/en-gb/p/paintbox-yarns-simply-dk:
        # "100g (3.53oz)", "276m (302yds)"
        "ball": {"grams": 100, "metres": 276},
    },
    {
        "id": "scheepjes-colour-crafter",
        "brand": "Scheepjes",
        "yarn": "Colour Crafter",
        "path": "scheepjes/colour-crafter",
        # https://www.scheepjes.com/en/colour-crafter-328/: "100 grams", "300 metres"
        "ball": {"grams": 100, "metres": 300},
    },
]

HEX = re.compile(r"^#[0-9a-f]{6}$")


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (alpha-pattern-editor)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def parse_colorways(ts: str) -> tuple[dict, list[tuple[str, str]]]:
    """The upstream colorways.ts: one source object, then `{ hex: '…', name: '…' }` pairs.

    The files are plain object literals; anything else in them fails loudly."""
    src = re.search(r"source:\s*{\s*name:\s*'([^']*)',\s*href:\s*'([^']*)',\s*accessed:\s*'([^']*)',\s*}", ts)
    if not src or ts.count("source:") != 1:
        raise SystemExit("expected exactly one source in the colorways file")
    pairs = re.findall(r"{\s*hex:\s*'([^']*)',\s*name:\s*'([^']*)',\s*}", ts)
    if len(pairs) != ts.count("hex:"):
        raise SystemExit("a colour entry is not in the expected { hex, name } form")
    for hex_, _ in pairs:
        if not HEX.match(hex_):
            raise SystemExit(f"not a #rrggbb colour: {hex_!r}")
    source = {"name": src.group(1), "href": src.group(2), "accessed": src.group(3)}
    return source, pairs


def stylecraft_shades(pairs):
    """Stylecraft's names end in the shade number ("White 1001"): split it off."""
    out = []
    for hex_, name in pairs:
        m = re.fullmatch(r"(.+) (\d{4})", name)
        if not m:
            raise SystemExit(f"Stylecraft name without a shade number: {name!r}")
        out.append({"code": m.group(2), "name": m.group(1), "hex": hex_})
    return out, []


def paintbox_shades(pairs):
    """The source gives names only; Paintbox shade numbers are left out, not guessed."""
    return [{"code": None, "name": name, "hex": hex_} for hex_, name in pairs], []


def scheepjes_shades(pairs):
    """Names from the colorway data, numbers from the swatches on scheepjes.com.

    The page lists each swatch as <img alt="1240 Ommen" … src="…-1240.jpg">, in the same
    order as the colorway data. One swatch is labelled "1035 Kampen" while its image file
    is 1023, next to the real 1035 Kampen: its number and name can't both be right, so
    that entry is dropped rather than guessed."""
    page = fetch(SCHEEPJES_PAGE)
    swatches = re.findall(
        r'alt="([^"]{2,40})" data-sizes="auto" data-src="/image/[0-9-]+/67x67/[^"]*-(\d{4})\.jpg', page)
    if len(swatches) != len(pairs):
        raise SystemExit(f"scheepjes.com lists {len(swatches)} swatches, the colorway data {len(pairs)}")
    out, dropped = [], []
    for (hex_, name), (alt, file_code) in zip(pairs, swatches):
        m = re.fullmatch(r"(\d{4})\s+(.+)", html.unescape(alt).strip())
        if not m or m.group(2) != name:
            raise SystemExit(f"swatch {alt!r} does not line up with {name!r}")
        if m.group(1) != file_code:
            dropped.append({"name": name, "hex": hex_,
                            "reason": f"swatch labelled {m.group(1)} but its image is {file_code}"})
            continue
        out.append({"code": m.group(1), "name": name, "hex": hex_})
    return out, dropped


SHADES = {
    "stylecraft-special-dk": stylecraft_shades,
    "paintbox-simply-dk": paintbox_shades,
    "scheepjes-colour-crafter": scheepjes_shades,
}


def write(name: str, data: dict) -> None:
    """Pretty-printed, one shade per line, so a changed shade is a one-line diff."""
    head = {k: v for k, v in data.items() if k != "shades"}
    lines = [f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}," for k, v in head.items()]
    shades = ",\n".join(f"    {json.dumps(s, ensure_ascii=False)}" for s in data["shades"])
    text = "{\n" + "\n".join(lines) + '\n  "shades": [\n' + shades + "\n  ]\n}\n"
    assert json.loads(text) == data
    (OUT / name).write_text(text, encoding="utf-8")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for lib in LIBRARIES:
        source, pairs = parse_colorways(fetch(f"{UPSTREAM}/{lib['path']}/colorways.ts"))
        yarn_ts = fetch(f"{UPSTREAM}/{lib['path']}/yarn.ts")
        if "weightId: 'd'" not in yarn_ts:
            raise SystemExit(f"{lib['id']}: expected a DK yarn (weightId 'd')")
        shades, dropped = SHADES[lib["id"]](pairs)
        # Two different shades with the very same hex: at least one of them is wrong, and
        # nothing says which, so both go.
        hexes = [s["hex"] for s in shades]
        for s in [s for s in shades if hexes.count(s["hex"]) > 1]:
            shades.remove(s)
            dropped.append({"name": s["name"], "hex": s["hex"],
                            "reason": "another shade in the source has the same hex"})
        seen = set()
        for s in shades:
            key = (s["code"], s["name"])
            if key in seen:
                raise SystemExit(f"{lib['id']}: duplicate shade {key}")
            seen.add(key)
        write(f"{lib['id']}.json", {
            "id": lib["id"],
            "brand": lib["brand"],
            "yarn": lib["yarn"],
            "weight": "DK",
            "ball": lib["ball"],
            "attribution": ATTRIBUTION,
            "shades": shades,
        })
        print(f"{lib['id']}: {len(shades)} shades (source {source['href']}, accessed {source['accessed']})"
              + "".join(f"\n  dropped {d['name']} {d['hex']}: {d['reason']}" for d in dropped))

    dmc = json.loads((ROOT / "alphareader" / "core" / "detect" / "dmc.json").read_text())
    write("dmc.json", {
        "id": "dmc",
        "brand": "DMC",
        "yarn": "Stranded cotton",
        "weight": None,
        "ball": None,
        "attribution": None,
        "shades": [{"code": e["code"], "name": e["name"],
                    "hex": "#{:02x}{:02x}{:02x}".format(*e["rgb"])} for e in dmc],
    })
    print(f"dmc: {len(dmc)} shades")
    return 0


if __name__ == "__main__":
    sys.exit(main())
