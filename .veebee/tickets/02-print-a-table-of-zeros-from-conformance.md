---
id: 02
title: Print a table of zeros from bun run conformance
milestone: M0-foundations
package: tools
writes:
  - tools/conformance/**
  - packages/server/src/app.ts
  - packages/server/src/index.ts
  - packages/contract/src/protocol.ts
  - package.json
  - bun.lock
conformance: []
modes: [local, hosted]
depends_on: [01]
status: done
claimed_by: codex
issue: 2
---

## What the user does
As a contributor, I run the upstream conformance kit against our still-empty server, in both modes, and see where we stand.

## Done when
- [x] `bun run conformance` prints one row per group (core, paging, search, schedules, tasks, grants, schemas, attachments, watchers, sync) with 0 passed in each, and exits 0
- [x] `bun run conformance --driver postgres --instances 2` prints the same table of zeros for two instances behind a round-robin proxy, and `tools/conformance/score.json` has an empty `local` and an empty `hosted` list

## Out of scope
- Refusing a run that loses a recorded check (04); checking the `@vercel/board` pin (03).
- `--update` recording new passes: checkable only once a check passes (54).
- A credential: the run uses the local owner token from 37, then a direct connection from 111 (D43).
- Any real route: the stub answers JSON 404 to everything, so discovery fails and the kit stops.

## Notes
`docs/codebase.md` 6.3 (steps, groups, per-mode score) and 2.1 (`createApp(config, ports, deps)`). Drivers are still empty packages, so the Postgres run boots two server stubs and needs no database yet; `tools/conformance/src/drivers.ts` is the composition root the boundaries rule allows. The stub answers JSON, never HTML (D8). This ticket closes M0's "conformance prints a table of zeros in both modes".
