---
id: 97
title: Hold a long-poll open until the next event
milestone: M3-live-tail
package: server
writes:
  - packages/contract/src/operations/events.ts
  - packages/server/src/operations/events.ts
  - packages/driver-sql/src/views/events.ts
  - packages/ports/testkit/store/events.test-suite.ts
  - packages/server/test/events.test.ts
  - packages/ports/src/store.ts
  - packages/ports/src/broadcaster.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/broadcaster.test-suite.ts
  - packages/driver-sqlite/src/broadcaster.ts
  - packages/driver-sqlite/test/broadcaster.test.ts
  - packages/server/src/live/long-poll.ts
  - apps/openboard/src/compose.ts
  - apps/openboard/src/serve.ts
  - docs/protocol.md
  - packages/driver-postgres/src/broadcaster.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/test/testkit.test.ts
  - packages/driver-postgres/test/unavailable.test.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/local-broadcaster.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sqlite/src/open.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/openapi.json
  - packages/server/src/deps.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/accounts.test.ts
  - packages/server/test/auth/csrf.test.ts
  - packages/server/test/auth/local-owner.test.ts
  - packages/server/test/auth/member-cap.test.ts
  - packages/server/test/auth/session-idle.test.ts
  - packages/server/test/boards.test.ts
  - packages/server/test/invitations.test.ts
  - packages/server/test/isolation/seed.ts
  - packages/server/test/log.test.ts
  - packages/server/test/orgs.test.ts
  - packages/server/test/scope.test.ts
  - packages/server/test/support/app.ts
  - packages/server/test/support/browser-session.ts
  - packages/server/test/tenancy.test.ts
  - tools/bench/src/drivers.ts
  - tools/conformance/score.json
  - tools/conformance/src/drivers.ts
conformance: ["core/holds a long-poll open until the next event"]
modes: [local]
depends_on: [96]
status: done
claimed_by: codex
issue: 97
---

## What the user does
As an agent, I wait on the board without polling it in a loop.

## Done when
- [x] `curl 'http://127.0.0.1:8787/api/local/main/events?channel=dev&after=<cursor>&wait=30'` stays open until `ob post dev hi` runs in another terminal, then answers with that post

## Out of scope
- Wake-ups across instances (M6, 176).

## Notes
The wake-up comes from the `Broadcaster` port, never from a write in the same process (`docs/codebase.md` 5.6, AGENTS.md non-negotiable 8).

Orchestrator note (from ticket 163): the Postgres driver exists (`packages/driver-postgres`). When you add the Broadcaster port, give the Postgres driver the same local-only broadcaster (wake this instance's subscribers after commit; cross-instance wake-ups stay ticket 176) and run `runBroadcasterSuite` in `packages/driver-postgres/test/testkit.test.ts` too; add those files to `writes`.
