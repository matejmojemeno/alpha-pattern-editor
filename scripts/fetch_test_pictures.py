"""Fetch the pictures corpus (test_images/pictures/): images that are *not* charts; and
the pixel art corpus (test_images/pixels/): pixel art without gridlines.

The import decides by itself whether an image is a chart to read or a picture to turn
into a pattern (core/kind.py). Its thresholds are calibrated on real charts and on these,
and `test_kind.py` asserts the kind of every one. They come from Wikimedia Commons, and
only files whose licence is CC0 or public domain are accepted: the repository is public.

    python scripts/fetch_test_pictures.py

Writes each file at 640 px wide (Commons' own thumbnail, not re-encoded here; drawings
are Commons' PNG rendering of the SVG) and test_images/pictures/README.md, recording for
every file its page, author, licence and SHA-256. The script fails if a file's licence is
no longer CC0 or public domain.
"""
from __future__ import annotations

import datetime
import hashlib
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "test_images", "pictures")
PIXELS_DEST = os.path.join(ROOT, "test_images", "pixels")
UA = {"User-Agent": "alpha-pattern-editor test corpus (https://github.com/matejmojemeno/alpha-pattern-editor)"}
WIDTH = 640
LICENCES = {"CC0", "Public domain"}

# (Commons title, file name here, what it tests). Chosen from Commons searches filtered to
# CC0 (haswbstatement:P275=Q6938433), 2026-09-29. No people, no brands.
FILES = [
    # Photos: what people will most often paste.
    ("File:Tabby cat with blue eyes-3336579.jpg", "cat-tabby.jpg", "photo"),
    ("File:Domestic shorthair cat portrait in grass.jpg", "cat-grass.jpg", "photo"),
    ("File:Dog at Nørre Vorupør Strand.jpg", "dog-beach.jpg", "photo"),
    ("File:Sončnica - Sunflower - Helianthus annuus (4).JPG", "sunflower.jpg", "photo"),
    ("File:Lake Mountain Landscape.jpg", "lake-mountains.jpg", "photo"),
    ("File:Strawberry on white background.jpg", "strawberry.jpg", "photo"),
    ("File:Red car toy.jpg", "toy-car.jpg", "photo"),
    ("File:Common Jezebel Delias eucharis by kadavoor 3.jpg", "butterfly.jpg", "photo"),
    ("File:Red fox in yard, Charlton MA 2025-12-26.jpg", "fox-yard.jpg", "photo"),
    ("File:Vulpes lagopus in Iceland.jpg", "arctic-fox.jpg", "photo"),
    ("File:Parrot in cage not free.jpg", "parrot-cage.jpg", "photo, cage bars"),
    ("File:Parrot and squirrel MET 102015.jpg", "parrot-squirrel-print.jpg", "artwork"),
    ("File:Butterfly Oil painting.jpg", "butterfly-painting.jpg", "artwork"),
    # Photos with a real grid in them: the hardest cases for "is this a chart?".
    ("File:Blind floor tiles.jpg", "floor-tiles.jpg", "grid-like texture"),
    ("File:Surfaces vertical brick wall closeup view.JPG", "brick-wall.jpg", "grid-like texture"),
    ("File:Knitted fleece (Rico Cilliers and colormass via Poly Haven).png", "knitted-fleece.png", "grid-like texture"),
    ("File:Empty wooden chessboard.jpg", "chessboard-wood.jpg", "grid-like texture"),
    ("File:Public chessboard at Primary School 1 in Tomaszów Mazowiecki, Poland.jpg", "chessboard-street.jpg", "grid-like texture"),
    ("File:LCD floor, at Perfume exhibition in Tokyo Node 2.jpg", "lcd-floor.jpg", "grid-like texture"),
    ("File:Context 01 – Marble Mosaic Tiles (Amal Kumar via Poly Haven).webp", "mosaic.webp", "grid-like texture"),
    # Flat drawings: few colours and hard edges, like a chart without its grid.
    ("File:Flower bouquet Pinhead icon.svg", "flowers-icon.png", "drawing"),
    ("File:Potted flower Pinhead icon.svg", "potted-flower-icon.png", "drawing"),
    ("File:Red-Heart-vector-2731436.svg", "heart.png", "drawing"),
    ("File:Happy smiley face.svg", "smiley.png", "drawing"),
    ("File:Coa House of Ochsenstein.svg", "coat-of-arms.png", "drawing"),
]

# Pixel art without gridlines (test_images/pixels/), fetched at its own size: a thumbnail's
# resampling would blur the blocks that make it pixel art. What each is read as is in
# test_kind.py.
PIXELS = [
    ("File:Bird pixel art.png", "bird-8x.png", "enlarged 8×"),
    ("File:Upscaled pixel art of a city at night.png", "city-8x.png", "enlarged 8×, 41 colours"),
    ("File:Pixel magenta circle.png", "circle-10x.png", "enlarged 10×"),
    ("File:Evil pixel art face (300x300).png", "face-9.375x.png", "enlarged 32 → 300 px: blocks of 9 and 10"),
    ("File:Evil pixel art face.png", "face-1x.png", "one pixel per stitch"),
    ("File:Retro-game-boy-with-sword.png", "game-boy-1x.png", "one pixel per stitch, two equal neighbouring rows"),
    ("File:Yin-yang orb.png", "yin-yang-1x.png", "one pixel per stitch, 3 colours"),
    ("File:Isometric Pixel Art Sample.png", "isometric-smoothed.png", "smoothed edges, 198 colours: not pixels"),
]


def _api(titles: list[str], width: int | None = WIDTH) -> dict:
    params = {"action": "query", "format": "json", "titles": "|".join(titles), "prop": "imageinfo",
              "iiprop": "url|extmetadata", "iiextmetadatafilter": "LicenseShortName|Artist|LicenseUrl"}
    if width is not None:
        params["iiurlwidth"] = width
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
        return json.load(r)


def _plain(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def _fetch(files: list[tuple[str, str, str]], dest: str, width: int | None) -> list[tuple] | None:
    """Download `files` into `dest`: Commons' `width` px thumbnail, or the original when
    `width` is None. The rows for the README, or None if a licence is no longer free."""
    os.makedirs(dest, exist_ok=True)
    info: dict[str, dict] = {}
    titles = [t for t, _, _ in files]
    for i in range(0, len(titles), 20):
        data = _api(titles[i:i + 20], width)
        norm = {n["to"]: n["from"] for n in data["query"].get("normalized", [])}
        for page in data["query"]["pages"].values():
            info[norm.get(page["title"], page["title"])] = page["imageinfo"][0]
    rows = []
    for title, name, kind in files:
        ii = info[title]
        meta = ii["extmetadata"]
        licence = meta["LicenseShortName"]["value"]
        if licence not in LICENCES:
            print(f"{title}: licence is now {licence!r}, not CC0 or public domain")
            return None
        url = ii["thumburl"] if width is not None else ii["url"]
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
            data = r.read()
        with open(os.path.join(dest, name), "wb") as fh:
            fh.write(data)
        rows.append((name, kind, title, ii["descriptionurl"], _plain(meta.get("Artist", {}).get("value", "")),
                     licence, hashlib.sha256(data).hexdigest()))
        print(name, licence)
    return rows


def _readme(path: str, heading: str, intro: list[str], rows: list[tuple]) -> None:
    lines = [f"# {heading}", "", *intro, "",
             "| File | What it tests | Source | Author | Licence | SHA-256 |",
             "|---|---|---|---|---|---|"]
    for name, kind, title, url, artist, licence, sha in rows:
        lines.append(f"| `{name}` | {kind} | [{title[5:]}]({url}) | {artist or '—'} | {licence} | `{sha[:16]}…` |")
    with open(path, "w") as fh:
        fh.write("\n".join(lines) + "\n")


def main() -> int:
    today = datetime.date.today().isoformat()
    pictures = _fetch(FILES, DEST, WIDTH)
    pixels = _fetch(PIXELS, PIXELS_DEST, None)
    if pictures is None or pixels is None:
        return 1
    _readme(os.path.join(DEST, "README.md"), "Pictures: images that aren't charts", [
        "Written by `scripts/fetch_test_pictures.py`; don't edit by hand. The import reads an",
        "image as a chart or as a picture (`alphareader/core/kind.py`); these are the pictures",
        "its thresholds are calibrated on, and `alphareader/tests/test_kind.py` checks every one.",
        "",
        f"All from Wikimedia Commons, retrieved {today}, as Commons' {WIDTH} px wide thumbnail",
        "(drawings: its PNG rendering of the SVG). Only CC0 and public-domain files are used.",
    ], pictures)
    _readme(os.path.join(PIXELS_DEST, "README.md"), "Pixel art without gridlines", [
        "Written by `scripts/fetch_test_pictures.py`; don't edit by hand. Pixel art is read",
        "block by block (`alphareader/core/pixels.py`); `alphareader/tests/test_kind.py` checks",
        "what each of these is read as, and its size in stitches.",
        "",
        f"All from Wikimedia Commons, retrieved {today}, at their own size (a thumbnail would",
        "blur the blocks). Only CC0 and public-domain files are used.",
    ], pixels)
    return 0


if __name__ == "__main__":
    sys.exit(main())
