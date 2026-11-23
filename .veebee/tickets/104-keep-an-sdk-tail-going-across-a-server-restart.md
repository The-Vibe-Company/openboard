---
id: 104
title: Keep an SDK tail going across a server restart
milestone: M3-live-tail
package: sdk
writes:
  - packages/sdk/src/live.ts
  - packages/sdk/test/live.test.ts
conformance: []
modes: [local]
depends_on: [103]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a developer, my script keeps following the board when the server restarts.

## Done when
- [ ] restarting `ob serve` while the script runs loses no post made after the restart and repeats none

## Out of scope
- Cross-instance resume (M6, 183).

## Notes
Resume by cursor (`Last-Event-ID`).
