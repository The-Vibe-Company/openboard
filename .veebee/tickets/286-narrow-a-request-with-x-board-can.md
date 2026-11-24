---
id: 286
title: Narrow a request with x-board-can
milestone: M10-access
package: server
writes:
  - packages/contract/src/headers.ts
  - packages/contract/src/index.ts
  - packages/core/src/access/narrow.ts
  - packages/core/src/index.ts
  - packages/core/test/access/narrow.test.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/auth/access.ts
  - packages/server/src/deps.ts
  - packages/server/src/operations/actors.ts
  - packages/server/test/auth/narrowing.test.ts
  - packages/server/test/auth/github-oidc.test.ts
  - packages/server/test/me.test.ts
  - tools/conformance/score.json
conformance: ["core/narrows a caller to what its x-board-can says"]
modes: [local, hosted]
depends_on: [281, 115, 216]
status: done
claimed_by: codex
issue: 461
---

## What the user does
As an agent, or a proxy in front of one, I send `x-board-can: dev=read` and the board treats the request as if my grants gave only that, never more.

## Done when
- [x] with `agent.headers` (mode 0600) holding `authorization: Bearer <secret of a direct connection whose grant is *=all>`, `curl -s -H @agent.headers -H 'x-board-can: dev=read' "$BOARD_URL/me"` shows the same principal and `can` `{ "dev": ["read"] }`; with that header a thread in `dev` reads, a post to `dev` answers 403 `forbidden`, and `x-board-can: *=all` on a connection whose grant is `dev=read` still posts nowhere
- [x] `bun test packages/server/test/auth/narrowing.test.ts` passes: every credential is narrowed, a claimed token inside its pin, a session or personal token inside its role cap, and the local owner too
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `core/narrows a caller to what its x-board-can says`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- A malformed header, 400 `invalid_scope` (287).
- Granting under narrowing (288, 289); narrowed claims and needs (290, 291); narrowed watchers (M11).

## Notes
docs/auth.md "Upstream's model" 6 (`x-board-can` intersects, never widens); upstream `parseCan`, `compileAccess` and `narrow` in `@vercel/board`'s `access` export (`pattern=permissions;…`, `all`, nothing after `=` for none, 4000 characters at most). `keepInsideCan` (`server/src/auth/access.ts`) returns early for the local owner, who holds no `can`: a narrowed local owner is held to the header. `/me`'s `can` (`server/src/operations/actors.ts`) is the narrowed one. Depends on 115 (`headers.ts`) and 216 (`pipeline.ts`, `deps.ts`), the last tickets before it to change those files.
