# Pixel art without gridlines

Written by `scripts/fetch_test_pictures.py`; don't edit by hand. Pixel art is read
block by block (`alphareader/core/pixels.py`); `alphareader/tests/test_kind.py` checks
what each of these is read as, and its size in stitches.

All from Wikimedia Commons, retrieved 2026-09-29, at their own size (a thumbnail would
blur the blocks). Only CC0 and public-domain files are used.

| File | What it tests | Source | Author | Licence | SHA-256 |
|---|---|---|---|---|---|
| `bird-8x.png` | enlarged 8× | [Bird pixel art.png](https://commons.wikimedia.org/wiki/File:Bird_pixel_art.png) | Northern Pirozhki | CC0 | `3ebf100262c663b3…` |
| `city-8x.png` | enlarged 8×, 41 colours | [Upscaled pixel art of a city at night.png](https://commons.wikimedia.org/wiki/File:Upscaled_pixel_art_of_a_city_at_night.png) | Stvk Công Cuối (VN) | CC0 | `ea3f36512e3a6ab2…` |
| `circle-10x.png` | enlarged 10× | [Pixel magenta circle.png](https://commons.wikimedia.org/wiki/File:Pixel_magenta_circle.png) | Anpang | CC0 | `6dfc0c6fb370c62b…` |
| `face-9.375x.png` | enlarged 32 → 300 px: blocks of 9 and 10 | [Evil pixel art face (300x300).png](https://commons.wikimedia.org/wiki/File:Evil_pixel_art_face_(300x300).png) | 0x4fdawg | CC0 | `91b968667f739f46…` |
| `face-1x.png` | one pixel per stitch | [Evil pixel art face.png](https://commons.wikimedia.org/wiki/File:Evil_pixel_art_face.png) | 0x4fdawg | CC0 | `e05daa75144be3a3…` |
| `game-boy-1x.png` | one pixel per stitch, two equal neighbouring rows | [Retro-game-boy-with-sword.png](https://commons.wikimedia.org/wiki/File:Retro-game-boy-with-sword.png) | Mangaka lam | CC0 | `b246a792f5d81e41…` |
| `yin-yang-1x.png` | one pixel per stitch, 3 colours | [Yin-yang orb.png](https://commons.wikimedia.org/wiki/File:Yin-yang_orb.png) | ZUN | Public domain | `c8b79d1ad253fb00…` |
| `isometric-smoothed.png` | smoothed edges, 198 colours: not pixels | [Isometric Pixel Art Sample.png](https://commons.wikimedia.org/wiki/File:Isometric_Pixel_Art_Sample.png) | Anpang01 | CC0 | `4637d04351713320…` |
