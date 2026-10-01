# Generated images: don't edit by hand

Every file here is written by `web/e2e/docs-media.spec.ts`, which drives the real app
(the production build, in Chromium) through the demo pattern in `fixtures/demo/`. A
screenshot taken by hand would drift from the app the first time the screen changed.

Regenerate them from `web/` after any change to how a screen looks:

```bash
npm run docs:media               # every screenshot; rewrites only the ones whose pixels changed
DOCS_TOUR=1 npm run docs:media   # the same, plus tour.gif and tour.mp4 (needs ffmpeg)
```

Then commit the images that changed; unchanged ones stay untouched, so git shows only
what's new. The tour is encoded afresh on every run, so it's re-recorded only when
`DOCS_TOUR=1` asks. If a test fails because it can't find a button, the button was
renamed or moved: update the spec, and the guide pages that name it.

Each image is named after the test that writes it: to add one, add a `test()` named
after the new file.
