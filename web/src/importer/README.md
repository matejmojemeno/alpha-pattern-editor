# `colour-names.json`: where the everyday colour names come from

The table colours are named from ("Blue", "Burgundy", "Dark blue"): 22 everyday names,
each with the colours that count as it. It is a copy of
`alphareader/core/detect/colour_names.json`, which detection uses; both are written by
`scripts/import_colour_names.py`. Don't edit them by hand: change the script and rerun it,
then `python scripts/gen_names_fixture.py`. `web/tests/importer/names.test.ts` and
`alphareader/tests/test_names.py` fail if the two copies differ.

## The xkcd colour survey

- **What:** the results of Randall Munroe's colour naming survey (2010): for each of the
  954 most common names people gave to colours shown on screen, the average of the
  colours given that name. Each anchor's hex in the table is the survey's hex for that
  name, unchanged.
- **Where it was read:** <https://xkcd.com/color/rgb.txt>, retrieved 2026-09-27. The file
  isn't versioned, so the table records the SHA-256 of what was read.
- **Licence:** CC0 (public domain), as the file's first line states:
  `# License: https://creativecommons.org/publicdomain/zero/1.0/`. The script fails if
  that line changes.
- **What is ours, not the survey's:** which 22 names are used, and which survey names
  count as each ("navy", "sky blue" and "baby blue" are all blue, so that the words
  dark and light are chosen by the palette, not by the survey's name). That is the list
  `FAMILIES` in the script. Survey names that pulled colours into the wrong name were
  left out: "dark coral" took clear reds, "dark cyan" and "dark aqua" took grey-blues.
  "Taupe" and "mushroom" count as beige, so a greyish beige isn't called peach.

## How it is used

`names.ts` (and `core/detect/names.py`, the reference) gives each colour the name of its
nearest anchor by CIEDE2000, then tells apart colours that share a name within the
palette. The rules are in `names.py`'s docstring.
