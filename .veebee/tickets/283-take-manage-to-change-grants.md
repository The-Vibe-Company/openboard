---
id: 283
title: Take manage to change grants
milestone: M10-access
package: server
writes:
  - packages/core/src/access/grant-changes.ts
  - packages/core/test/access/grant-changes.test.ts
  - packages/core/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/server/src/operations/grants/authority.ts
  - packages/server/src/operations/grants/create.ts
  - packages/server/src/operations/grants/revoke.ts
  - packages/server/src/operations/grants/update.ts
  - docs/protocol.md
  - packages/server/test/grants/manage.test.ts
conformance: []
modes: [local, hosted]
depends_on: [282]
status: done
claimed_by: Codex
issue: 458
---

## What the user does
As a board owner, I give an orchestrator `manage` on `work/armada/` so it may grant there and nowhere else.

## Done when
- [ ] a direct connection whose grant is `*=read,post` gets `error: forbidden: …` from `ob grants create`, `ob grants update`, `ob grants revoke` and `ob grants`; one whose grant is `work/armada/=all` creates, updates and revokes grants whose patterns all lie under `work/armada/`, and gets `error: forbidden: …` for one naming `work/`
- [ ] naming an `--oidc` principal without `manage` at every pattern prints `error: forbidden: …`

## Out of scope
- Callers narrowed with `x-board-can`, and upstream's check of these rules, which narrows: 288 (`.veebee/cut.md` moved the `[c]`).
- Lockout (284); child connections minted under these rules and their cascade revoke (docs/auth.md "Connections"): no ticket in the cut, listed for the owner.

## Notes
Upstream `03-http.md` routes: `POST /grants` needs `manage` at each pattern in `can`, and under each wherever the caller's own grants' limits narrow it, and what `everyone` gives wherever it gives something, and `manage` everywhere to name an `oidc` principal; `PATCH` needs it at the grant as it was and, to add principals or set `can`, all of it; revoke at its patterns but what `everyone` gives; listing at `*`. One rule in `core/access/grant-changes.ts`.
