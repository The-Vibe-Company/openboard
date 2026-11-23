---
id: 67
title: Read back your own post by its client ID
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/server/src/operations/index.ts
  - packages/server/openapi.json
  - tools/conformance/score.json
  - docs/protocol.md
conformance: []
modes: [local]
depends_on: [68]
status: done
claimed_by: codex-t67
issue: 67
---

## What the user does
As an agent that posted with a client ID, I read my own post back by that ID, as it landed.

## Done when
- [x] after `ob post dev deploy --idempotency-key deploy-1`, `curl -H "authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/local/main/posts/deploy-1` answers `{ message }` with that post; the same request from another principal, or with an unknown ID, answers 404 `post_not_found`

## Out of scope
- Reading any message by its board ID: that is `GET /messages/:id` (44), unchanged.
- Posting once per client ID (68).

## Notes
Upstream's `posted` operation (`@vercel/board` 0.54.0, `backend` "The caller's own post with client ID `id`, as it landed: 404 `post_not_found` when there's none"). Decided by the orchestrator on issue #67: upstream reserves `GET /posts/:id` for client IDs, so this ticket follows it instead of adding a board-ID route.
