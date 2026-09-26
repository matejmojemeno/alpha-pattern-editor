# Colour libraries: where the data comes from

Each file here is one library the app matches palette colours against: `{ id, brand, yarn,
weight, ball, attribution, shades: [{ code, name, hex }] }`. They are written by
`scripts/import_yarn_libraries.py`; don't edit them by hand. Rerun the script instead,
and update this file.

Manufacturers don't publish hex values for their yarns. Every hex below is someone's
reading of the manufacturer's swatch photos, which is as close as a screen gets: yarn
looks different in the hand, and dye lots vary.

| File | Shades | Hex and names from | Shade numbers from | Ball |
|---|---|---|---|---|
| `stylecraft-special-dk.json` | 125 | temperature-blanket.com | the same data (each name ends in its number, "White 1001") | 100 g, 295 m |
| `paintbox-simply-dk.json` | 63 | temperature-blanket.com | none: the source gives names only, so `code` is `null` | 100 g, 276 m |
| `scheepjes-colour-crafter.json` | 90 | temperature-blanket.com | scheepjes.com (see below) | 100 g, 300 m |
| `dmc.json` | 119 | `alphareader/core/detect/dmc.json` | the same | none |

## temperature-blanket.com yarn colorways

- **What:** the yarn colorway data behind temperature-blanket.com's yarn palettes.
- **Where it was read:** the site's public repository at a pinned commit,
  <https://github.com/jdvlpr/Temperature-Blanket-Web-App/tree/d22f7d9eb0cdf32aad9595931f01a33333b8d95a/src/lib/data/yarns>
  (`stylecraft/special-dk`, `paintbox-yarns/simply-dk`, `scheepjes/colour-crafter`).
- **Retrieved:** 2026-09-26.
- **Licence:** CC BY 4.0, <https://creativecommons.org/licenses/by/4.0/>, as stated on
  <https://temperature-blanket.com/api/yarn-colorways>: "Data is provided under the terms
  of the CC BY 4.0 DEED Attribution 4.0 International license", with the suggested credit
  "Yarn colorways from temperature-blanket.com licensed under CC BY 4.0 DEED". The app
  shows that credit under the library picker. (The repository's *code* is GPL-3.0; the
  colorway data is what the site licenses separately, and only the data is used here.)
- **Its own sources**, recorded in each upstream file: Stylecraft Special DK from
  <https://www.stylecraft-yarns.co.uk/yarns/special-dk> (accessed 2024-12-31), Paintbox
  Yarns Simply DK from <https://www.lovecrafts.com/en-gb/p/paintbox-yarns-simply-dk>
  (accessed 2023-07-13), Scheepjes Colour Crafter from
  <https://www.scheepjes.com/en/colour-crafter-328/> (accessed 2022-03-19).
- **Changes made** (as CC BY asks us to say): Stylecraft's trailing shade numbers split
  into `code`; Scheepjes shade numbers added (below); three Scheepjes shades left out
  (below); reformatted as JSON.

## Scheepjes Colour Crafter shade numbers

Read from the swatches on <https://www.scheepjes.com/en/colour-crafter-328/> on
2026-09-26: each is an image with `alt="1240 Ommen"` and a file name ending in its number,
listed in the same order as the colorway data. The script checks every name lines up.

Left out, because the sources contradict themselves and nothing says which is right:

- **Kampen, #b0405c:** its swatch is labelled "1035 Kampen" but its image file is 1023,
  next to another "1035 Kampen" whose label and file agree (that one is kept).
- **Bergen (1420) and Haarlem (1054):** both have the hex #c9945b in the colorway data,
  so at least one is wrong.

## Ball weights and lengths

Quoted from the manufacturer's or retailer's page on 2026-09-26, and used only as the
default skein length in the yarn estimate (the user can change it):

- Stylecraft Special DK: "100g", "295m/322yds",
  <https://www.stylecraft-yarns.co.uk/yarns/special-dk>.
- Paintbox Yarns Simply DK: "100g (3.53oz)", "276m (302yds)",
  <https://www.lovecrafts.com/en-gb/p/paintbox-yarns-simply-dk>.
- Scheepjes Colour Crafter: "100 grams", "300 metres",
  <https://www.scheepjes.com/en/colour-crafter-328/>.

## DMC

`dmc.json` is `alphareader/core/detect/dmc.json` (the table detection names colours
from), converted to this format so the app can match against it without Pyodide.
`web/tests/yarn/data.test.ts` fails if the two drift apart. Its provenance predates this
file and isn't recorded in the repository.
