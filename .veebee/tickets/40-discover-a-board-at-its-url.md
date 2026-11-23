---
id: 40
title: Discover a board at its URL
milestone: M1-walking-skeleton
package: server
writes:
  - packages/contract/src/operations/discovery.ts
  - packages/server/src/operations/discovery.ts
  - packages/server/test/discovery.test.ts
  - apps/openboard/src/config.ts
  - apps/openboard/src/compose.ts
  - apps/openboard/test/config.test.ts
  - packages/contract/src/entities/discovery.ts
  - packages/contract/src/operation.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/server/src/deps.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/operations/index.ts
  - packages/server/tsconfig.json
  - packages/server/test/support/app.ts
  - packages/server/test/log.test.ts
  - packages/server/test/auth/local-owner.test.ts
  - tools/conformance/src/drivers.ts
  - tools/bench/src/drivers.ts
  - tools/bench/test/counters.test.ts
conformance: ["core/says in its discovery where it is"]
modes: [local]
depends_on: [39]
status: done
claimed_by: claude-opus-t40
issue: 40
---

## What the user does
As an upstream client, I read a board's discovery with no token and find the URL and audience I was given.

## Done when
- [x] `curl http://127.0.0.1:8787/api/local/main` with no token answers `{ version, url, audience, team_id: null, project_id: null, sync: [] }` with `url` and `audience` equal to `OPENBOARD_PUBLIC_URL` + `/api/local/main`, and `http://127.0.0.1:8787/api/local/main/` answers the same with no redirect
- [x] `curl http://127.0.0.1:8787/api/nobody/nothing` answers the same shape for that path: discovery never says whether a board exists

## Out of scope
- The bare `/api` alias (41).
- `/openapi.json` (63).

## Notes
`docs/protocol.md` "Discovery" (D35: answered from the URL alone).
