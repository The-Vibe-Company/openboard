---
id: 384
title: Refuse a sync entry in a watcher registration
milestone: M14-external-sync
package: core
writes:
  - packages/core/src/watchers/register.ts
  - packages/core/test/watchers/register.test.ts
  - packages/server/test/watchers/sync.test.ts
conformance: []
modes: [local, hosted]
depends_on: [300, 301, 382]
status: draft
claimed_by: null
issue: 579
---

## What the user does
As a sync written for upstream's board, registering here is refused with the answer upstream's kit and clients read as "this board keeps no sync", so they stop trying.

## Done when
- [ ] `bun test packages/server/test/watchers/sync.test.ts` passes on SQLite and Postgres: `POST /watchers` with `{ "watch": {}, "sync": [{ "key": "conformance", "platform": "conformance" }] }` answers 403 `forbidden` with the message "this board keeps no sync" and leaves the caller's registration as it was; `sync: []` registers as before; a narrowed caller still gets 302's refusal
- [ ] `bun run conformance` in both modes reports every check that registers a sync (the six remaining sync checks and `tasks/holds a task when anyone but its owner edits its root, which ends its claim`) as skipped with "this token can't register a sync here", and none as failed

## Out of scope
- Recording those skips in `score.json` (385).

## Notes
- D19 ("`POST /watchers` with `sync` entries … answer 403 `forbidden`; the kit then skips every sync check"), docs/protocol.md "Watchers" (`any sync entry → 403 "this board keeps no sync"`). Until now 300 answers a non-empty `sync` with 400 `invalid_request`; the kit treats only a 403 as "can't register" (`registerSync()` in `dist/conformance-*.mjs`), so before this ticket those checks fail.
- The refusal is decided in `packages/core/src/watchers/register.ts` (300), before anything is written.
- Depends on 301, the last ticket before it to change `packages/core/src/watchers/register.ts`.
