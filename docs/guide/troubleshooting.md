# Troubleshooting

Each problem below is a heading, with what to do about it. Most are messages the app
shows, quoted as it shows them. If yours isn't here, or the fix doesn't work, please
[open an issue](https://github.com/matejmojemeno/alpha-pattern-editor/issues/new) (or use
**Feedback** on the home screen), and say which browser and device you use.

## Import messages

When the app can't read an image, it says why where the pattern would be. The small print
underneath, such as "Detection failed (NO_GRIDLINES)", is for bug reports.

### "I couldn't find the grid in this image."

The app didn't find the chart's gridlines. Drag a box around just the squares on your
image, and let go: it looks again inside the box. If that doesn't work, the chart may
have no gridlines, or very faint ones; try a clearer copy. See
[which images work](import.md#choose-an-image-that-works).

### "This image is too small to read reliably."

Each square needs about 6 pixels or more. Find a larger copy of the chart, or zoom in
before taking a screenshot.

### "The chart looks tilted."

The chart is turned by more than about 1.5°. Straighten the image in a photo editor, or
take the photo again straight on, and import it again.

### "This image is too small to contain a chart."

The image is too small to hold a grid at all. Use a larger copy.

### "This image is taking too long to read."

Reading stopped after 20 seconds. Drag a box around just the squares, which gives the app
far less to read, or press **Try again**.

### "This image is too big to read on this device."

The device ran out of memory. Drag a box around just the squares, or import a smaller
copy of the image.

### "The pattern reader couldn't be loaded."

The chart reader didn't download. Check your internet connection and press
**Try again**. It's needed only for importing pictures: your saved projects open without
it.

### "This file couldn't be read as an image."

The file may be damaged, or in a format this browser can't open. Open it on your device
and save or screenshot it as PNG or JPEG.

## A warning shows above the image

A warning (⚠) means the app read the chart but is less sure than usual. Check the pattern
against your image before saving:

- **"Grid found via a fallback for faint / low-contrast gridlines"**: count the rows and
  columns against your chart, and
  [drag the outline](import.md#fix-a-grid-thats-a-row-or-column-short) if they're off.
- **"… cell(s) don't closely match any detected colour"**: a colour may be missing.
  Look for stitches in the wrong colour, and fix them in Design.
- **"Reduced from … for detection"** (a note, not a warning): a very large photo was shrunk before reading. Check
  the size, and fix it in Design if needed.

## The grid is a row or column short

Drag that edge of the blue outline outwards until it takes in the missing row or column
([details](import.md#fix-a-grid-thats-a-row-or-column-short)). A very narrow chart, under
about 6 columns, with row numbers beside it can come out a column short: this fixes it too.

## One colour came out as two

Press **−** beside **Colours** on the import screen to merge the two most alike colours
([details](import.md#merge-colours-that-should-be-one)). To merge a particular colour
into its nearest, delete it in [Design](design.md#delete-a-colour).

## Two colours came out as one

Colours that are very close, such as two pale pinks, can be merged. Save the pattern,
[add the missing colour](design.md#add-a-colour) in Design, and paint it back.

## A file won't import

- **"… is an image the importer can't read. Use a PNG, JPEG or WebP image."** The app
  reads PNG, JPEG and WebP. Other formats, such as HEIC (some iPhone photos), GIF or
  TIFF, aren't read: save or screenshot the image as PNG or JPEG.
- **"… isn't a .alpha file or a chart image."** Only `.alpha` project files and chart
  images can be imported.
- **"… was saved by a newer version of Alpha Pattern Editor and can't be opened here."**
  Reload the app to get the latest version, then import it again.
- **"… couldn't be read as a pattern. It may be damaged."** The `.alpha` file is
  incomplete or damaged. Export it again from where it came from, if you can.

## It asks "Already in your library"

The project you're importing is already in your Library. The question shows how much of
each copy is done: **Replace** swaps in the imported one; **Cancel** keeps yours. See
[Import a project you already have](library.md#import-a-project-you-already-have).

## "This browser isn't letting the app store projects"

The browser won't let the app save anything, which private or incognito windows can do.
Open the app in a normal window.

## The Work stage says "Not saved"

Your last change couldn't be saved. Press **Try again** next to it. If it keeps failing,
the device may be out of storage space: free some up, and export your projects to be
safe.

## "The Design stage needs a larger screen"

Designing needs a tablet or a computer. On a phone, press **Start working →** to follow
the pattern. To edit it on a tablet or computer,
[move it there](library.md#move-a-project-to-another-device-or-browser).

## My projects have gone

Projects are kept in one browser, on one device, at one web address. Check that you're
using the same browser and device, and the same web address, as before. If the
browser's data was cleared, the projects are gone; import the `.alpha` files you
exported. See [Your data](your-data.md).

## The screen goes dark while I work

The Work stage asks the device to keep the screen on, but some browsers refuse, for
example in a battery-saving mode. Turn battery saving off, or lengthen your device's
screen timeout while you crochet.
