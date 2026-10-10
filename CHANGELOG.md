# Changelog

What changed in Alpha Pattern Editor that you'll notice when you use it, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): one plain
line per change, under the release it's in.

## Unreleased

### Added

- A user guide, [`docs/guide/`](docs/guide/index.md): one page for each screen, how to do
  things in it, and what to do about the messages the app shows.
- **Help** on the home screen opens the guide, and a **?** at the top of each screen opens
  its page (in Work on a phone: **Options** then **Help**).
- **About**, at the bottom of Settings: the version and build, with a link to what's new.
- A link to the app shared in a chat or forum shows a picture of it.
- **Remove background** for a selection in Design: its background becomes see-through, so
  when you move or turn it, only the motif goes over what's there. Press **Put background
  back** to undo it.
- **Select object** (`W`) in Design: click a shape, such as one cat in a row of cats, to
  select it without its background, and drag it straight away.
- **Craft** in the Work stage's **Options**: follow a pattern as stranded or intarsia
  knitting, intarsia crochet, an alpha friendship bracelet or on a bead loom, as well as
  tapestry crochet. Each sets which row is first and which way rows run, and counts
  knots or beads where that's the word.
- **Start from the top row** and **Rows turn** in the Work stage's **Options**, for
  patterns worked from the top, or in the round.
- **Show the colours in this row** in the Work stage's **Options** and in Settings: switch
  it off to hide the list of the row's colours and give the chart its room.

### Changed

- Importing is two things now. **Import a chart** (the big area on the home screen, and
  pasting) always reads your image as a chart: it no longer decides that a chart is a
  picture and turns it into a different pattern. **Photo to pattern**, a new tile, makes
  a new chart from any photo or drawing. When a chart can't be read, or many of its
  squares are unclear, a button takes the same image to Photo to pattern.
- The home screen says what the app is for: turn a photo of a chart into a pattern you
  can edit and follow row by row.
- In the Work stage, a pattern much wider than it is tall now fits the screen whole, so
  each row is on screen at once. Before, it was enlarged and scrolled sideways along every
  row. A pattern much taller than wide still fills the width and scrolls down with you.
- The Work stage's **Options** are in three groups: **How you work it**, **Chart** and
  **Pattern**. Pick the corner you start in under **First stitch**, and **Back and forth**
  or **In the round** under **Rows**, with a line that says what that means for row 1
  and row 2. Several options have clearer names: **Enlarge the current row** and
  **Edit in Design**.
- **Export PNG** in the Work stage's **Options** replaces **Export readout**: it saves
  the chart as a picture, with stitch numbers and where to carry yarn when they're on,
  and without your progress.

### Removed

- **High contrast**. Your light or dark system setting still applies.

### Fixed

- Rotating a selection four times, or once each way, puts it back exactly where it was.
- Changing **Start rows from the right** partway through a row no longer leaves your place
  on the wrong stitch: the app asks, then starts that row again.
  Before, a selection whose width and height differed by an odd number crept up and left.
