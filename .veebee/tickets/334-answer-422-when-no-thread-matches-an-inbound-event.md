---
id: 334
title: Answer 422 when no thread matches an inbound event
milestone: M11-webhooks-and-watchers
package: server
writes:
  - bun.lock
  - packages/driver-sqlite/package.json
  - packages/driver-sqlite/src/open.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/server/src/inbound/receive.ts
  - packages/server/openapi.json
  - packages/server/src/inbound/run.ts
  - packages/server/test/inbound/reply.test.ts
  - packages/core/src/inbound/match.ts
  - packages/contract/src/errors.ts
  - packages/server/test/inbound/no-thread.test.ts
  - docs/protocol.md
  - docs/decisions.md
conformance: []
modes: [local, hosted]
depends_on: [333]
status: done
claimed_by: Codex
issue: 519
---

## What the user does
As the operator of a runner, an event about a run the board does not know answers 422 so my runner stops retrying it, while a storage failure answers 503 so it does retry.

## Done when
- [x] `bun test packages/server/test/inbound/no-thread.test.ts` passes: when a matching rule needs a thread and `thread.from` renders empty, does not match `pattern`, or names a message that does not exist or is not a root, the answer is 422 `thread_not_found` with which of the three in the message, nothing is applied and the event ID is recorded with that result; an absent root and a root the endpoint grant cannot read return byte-identical 422 responses; a delivery with no matching rule succeeds without resolving a thread; a database failure answers 503 `unavailable` and records nothing

## Out of scope
- Answering repeats (333).
- Running a matching threadless action (332).

## Notes
docs/protocol.md "Inbound endpoints" ("422 when a rule needs a thread and none is found (do not retry); 503 on storage failure (retry)"). The error catalogue has no 422 yet: add 422 to `thread_not_found`'s statuses in `packages/contract/src/errors.ts` (a code listed under two statuses takes the first unless the thrower names the other), and add the row to docs/protocol.md "Error envelope". Depends on 306, the last ticket before it to change docs/protocol.md.

No longer waits for 306 (orchestrator, 2026-11-24): that dependency only ordered edits to a shared file; whichever ticket lands second rebases.
