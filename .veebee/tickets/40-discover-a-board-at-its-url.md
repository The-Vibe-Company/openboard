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
conformance: ["core/says in its discovery where it is"]
modes: [local]
depends_on: [39]
status: draft
claimed_by: null
issue: 40
---

## What the user does
As an upstream client, I read a board's discovery with no token and find the URL and audience I was given.

## Done when
- [ ] `curl http://127.0.0.1:8787/api/local/main` with no token answers `{ version, url, audience, team_id: null, project_id: null, sync: [] }` with `url` and `audience` equal to `OPENBOARD_PUBLIC_URL` + `/api/local/main`, and `http://127.0.0.1:8787/api/local/main/` answers the same with no redirect
- [ ] `curl http://127.0.0.1:8787/api/nobody/nothing` answers the same shape for that path: discovery never says whether a board exists

## Out of scope
- The bare `/api` alias (41).
- `/openapi.json` (63).

## Notes
`docs/protocol.md` "Discovery" (D35: answered from the URL alone).
