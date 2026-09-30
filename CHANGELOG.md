# Changelog

What changed in Alpha Pattern Editor that you'll notice when you use it, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): one plain
line per change, under the release it's in.

## Unreleased

### Added

- A user guide, [`docs/guide/`](docs/guide/index.md): one page for each screen, how to do
  things in it, and what to do about the messages the app shows.
- **Remove background** for a selection in Design: its background becomes see-through, so
  when you move or turn it, only the motif goes over what's there. Press **Put background
  back** to undo it.

### Fixed

- Rotating a selection four times, or once each way, puts it back exactly where it was.
  Before, a selection whose width and height differed by an odd number crept up and left.
