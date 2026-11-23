---
id: 63
title: Fetch the OpenAPI description
milestone: M1-walking-skeleton
package: server
writes:
  - packages/server/src/http/openapi.ts
  - packages/contract/src/operations/discovery.ts
  - packages/server/src/operations/discovery.ts
  - scripts/ci/gen.ts
  - package.json
  - bun.lock
  - docs/protocol.md
  - packages/contract/src/errors.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operation.ts
  - packages/contract/src/operations/actors.ts
  - packages/contract/src/operations/channels.ts
  - packages/contract/src/operations/events.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operations/messages.ts
  - packages/contract/src/operations/threads.ts
  - packages/server/openapi.json
  - packages/server/src/index.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/openapi.test.ts
  - tools/bench/test/counters.test.ts
conformance: []
modes: [local]
depends_on: [40]
status: done
claimed_by: codex
issue: 63
---

## What the user does
As an integrator, I fetch a machine-readable description of the board's API.

## Done when
- [x] `curl http://127.0.0.1:8787/api/local/main/openapi.json` answers OpenAPI 3.1 listing the board operations with upstream `operationId`s
- [x] `bun run gen` writes the same document to `packages/server/openapi.json`

## Out of scope
- The stale-file check (64).
- The skill's command reference (M12, 350).

## Notes
`docs/codebase.md` 4.2.
