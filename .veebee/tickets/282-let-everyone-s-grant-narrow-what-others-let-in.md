---
id: 282
title: Let everyone's grant narrow what others let in
milestone: M10-access
package: core
writes:
  - packages/core/src/access/resolve.ts
  - packages/core/test/access/resolve.test.ts
  - packages/server/test/grants/everyone.test.ts
  - docs/protocol.md
  - packages/core/src/access/explain.ts
  - packages/core/test/access/explain.test.ts
  - packages/core/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/src/grants.ts
  - packages/driver-sql/src/views/agents.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/driver-sql/src/views/grants.ts
  - packages/server/src/auth/oidc.ts
  - packages/contract/src/operations/grants/create.ts
  - packages/server/openapi.json
  - skills/openboard/references/commands.md
  - packages/server/src/operations/grants/authority.ts
  - packages/server/src/operations/grants/create.ts
  - packages/server/src/operations/grants/explain.ts
  - packages/server/src/operations/grants/revoke.ts
  - packages/server/src/operations/grants/update.ts
  - packages/server/test/grants/lockout.test.ts
conformance: ["grants/lets everyone narrow what something else lets in, and lets no one in itself"]
modes: [local, hosted]
depends_on: [281, 221, 226]
status: done
claimed_by: Codex
issue: 457
---

## What the user does
As a board owner, I narrow or close a channel for everyone, `ob grants create --everyone --can 'ops/=read'`, while principals named closer keep what their own grants give them there.

## Done when
- [ ] after `ob grants create --everyone --can 'ops/=read'`, a connection whose own grant gives `*=read,post` reads `ops/x` but posting there prints `error: forbidden: …`, until a grant naming it at `ops/` gives `post`; `ob grants explain --github acme/web ops/x` for a repository nothing else lets in shows `pattern: null` and `can: []`
- [ ] with an `--all-projects --environment production` grant at `*` and the everyone grant at `ops/`, `ob grants explain --project prj_x --environment production ops/x` shows `level: "everyone"` and `can: ["read"]`; adding an `--all-projects` grant at `ops/` makes it `level: "group"` with that grant's permissions alone
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` retain all recorded checks. The everyone narrowing check stays skipped and unrecorded.

- [ ] A grant that would leave its creator unable to manage it returns `409 grant_lockout` without persisting unless the creator set `lockMeOut`.

## Out of scope
- Callers narrowed with `x-board-can` against `everyone` (288, 289).

## Notes
- Upstream `docs/01-board/09-access.md` "How grants combine" (`everyone` is "everyone something else lets in").
- Orchestrator decision on #457: keep discovery `team_id` and `project_id` null. Verify narrowing through the CLI and server tests. Leave the upstream check unrecorded while it skips because discovery names no team.
- Revised decision on #457: reject create-time lockout with `409 grant_lockout` unless `lockMeOut` is set. Ticket 284 owns PATCH, revoke, and error guidance.
