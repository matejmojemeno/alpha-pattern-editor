"""Write fixtures/photos/made-exif.jpg: a stand-in for a phone photo of a finished piece.

Used by web/e2e/made-photo.spec.ts to check what the web app keeps of a photo:

- 3000 x 2000 stored pixels, larger than MADE_PHOTO_MAX_EDGE (2048), so it must shrink;
- EXIF Orientation 6 ("rotate 90 clockwise to view"), as a phone held upright writes it,
  so the kept photo must come out 2000 wide by 3000 tall, scaled to 1365 x 2048;
- the stored image is red on its left half and blue on its right, so once turned the
  right way up red is at the top and blue at the bottom;
- a GPS position and a camera model, which the kept photo must not carry.

Every value is made up for the test. Run from the repo root:

    .venv/bin/python scripts/gen_made_photo_fixture.py
"""

import os

from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "fixtures", "photos", "made-exif.jpg")

W, H = 3000, 2000


def main() -> None:
    img = Image.new("RGB", (W, H), (220, 30, 30))
    img.paste((30, 60, 220), (W // 2, 0, W, H))

    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90 CW to view
    exif[0x0110] = "Test Camera Model"  # Model
    gps = {
        1: "N",  # GPSLatitudeRef
        2: (50.0, 5.0, 0.0),  # GPSLatitude
        3: "E",  # GPSLongitudeRef
        4: (14.0, 25.0, 0.0),  # GPSLongitude
    }
    exif[0x8825] = gps  # GPSInfo IFD

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, "JPEG", quality=80, exif=exif)
    print(f"wrote {os.path.normpath(OUT)} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
