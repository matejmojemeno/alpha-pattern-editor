# Test images

**Drop your alpha-pattern chart images here** (`.png`, `.jpg`, `.jpeg`, `.webp`) to try
the detector on them.

Screenshots from Pinterest, friendship-bracelets.net, etc. are exactly the target. For
best results the chart should:

- have **uniform (non-staggered) rows** and **visible black gridlines**,
- be roughly axis-aligned (rotation beyond ~1.5° is rejected on purpose),
- have at least **~6 pixels per cell** (very small thumbnails are rejected rather than
  guessed at).

Row/column numbers, watermarks, captions and page margins around the grid are fine —
they're filtered out automatically.

`dachshund.png` is a sample so you can see it work out of the box.

## Run the detector on an image

From the project root:

```bash
.venv/bin/python detect_cli.py test_images/dachshund.png \
    --overlay out_overlay.png \
    --reconstruct out_reconstruct.png
```

It prints the detected grid size, pitch, and palette (with nearest DMC floss names), and
writes two pictures:

- `--overlay` — your image with the fitted grid drawn on top (sanity-check alignment),
- `--reconstruct` — the recovered pattern redrawn from the structured data.

Useful flags:

- `--delta-e N` — colour-merge sensitivity (2 = split more colours, 15 = merge more).
  If similar shades are wrongly merged or split, adjust this.
- `--dark N` — darkness threshold for gridline detection (default 100).
