---
id: 11
title: Refuse timers, the clock or randomness in contract, core, ports or server
milestone: M0-foundations
package: tools
writes:
  - .oxlintrc.json
  - scripts/ci/fixtures/oxlint/globals/**
conformance: []
modes: []
depends_on: [01]
status: ready
claimed_by: null
issue: 11
---

## What the user does
As a contributor, I take time, timers, IDs and randomness from `deps`, never from globals.

## Done when
- [ ] `Date.now()` in `packages/core/src` and `setTimeout` in `packages/server/src` each make `bun run lint` exit 1 naming the file and the global
- [ ] the same calls in `packages/driver-sqlite/src` and `apps/openboard/src` pass

## Out of scope
- Console (12), env (13), module state (14).

## Notes
Banned list and scope: `docs/codebase.md` 3.2 (`setTimeout`, `setInterval`, `queueMicrotask`, `Date`, `Math.random`, `crypto.randomUUID` in `contract`, `core`, `ports`, `server`); oxlint `no-restricted-globals` (3.3 point 2).
