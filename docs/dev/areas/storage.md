# Storage

How projects are kept: `.alpha` files, compatible with the desktop app in both
directions, stored in the browser's IndexedDB. Code:
[`web/src/storage/`](../../../web/src/storage/); the test files are described in
[`fixtures/alpha/README.md`](../../../fixtures/alpha/README.md).

## During the port

What each phase of the port built here, newest first. The plan each phase followed is in
[`history/web-port.md`](../history/web-port.md).

### Hardening before hosting (after Phase 2, one PR)

- The flaky `repo.test.ts` change-events test awaits each listing.

### Phase 1

- **Storage and logic** (PR #6): `.alpha` read/write compatible with the desktop in both
  directions, IndexedDB via `ProjectRepo`, and `readout.ts`/`work.ts` replaying the golden
  fixtures.
