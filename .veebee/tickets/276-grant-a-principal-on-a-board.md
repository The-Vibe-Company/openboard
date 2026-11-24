---
id: 276
title: Grant a principal on a board
milestone: M10-access
package: server
writes:
  - packages/contract/src/entities/grants.ts
  - packages/contract/src/operations/grants.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/core/src/access/principals.ts
  - packages/core/test/access/principals.test.ts
  - packages/core/src/access/resolve.ts
  - packages/core/test/access/resolve.test.ts
  - packages/core/src/access/grant-events.ts
  - packages/core/src/index.ts
  - packages/ports/src/grants.ts
  - packages/ports/src/store.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/store/grants.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/ports/testkit/isolation-seed.ts
  - packages/driver-sql/src/views/grants.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/grants.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/auth/connections.ts
  - packages/server/src/auth/tokens.ts
  - packages/server/src/auth/sessions.ts
  - packages/server/src/auth/personal-tokens.ts
  - packages/server/test/grants/create.test.ts
  - packages/server/test/isolation/seed.ts
  - packages/server/test/isolation/cases.ts
  - packages/cli/src/commands/grants.ts
  - packages/cli/src/grant-principals.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/test/grants.test.ts
conformance: []
modes: [local, hosted]
depends_on: [215, 238]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, I let a connection or a person do more on part of the board with `ob grants create --connection <id> --can 'deploys/=read,post'`, and it holds from their next request.

## Done when
- [ ] as the local owner, with a direct connection made `--can 'dev=read'`, `ob grants create --connection <its id> --can 'deploys/=read,post'` prints `created g5  --connection <its id>  deploys/=read,post`; with that connection's secret as `BOARD_TOKEN`, `ob post deploys/web hi` then lands while `ob post ops hi` prints `error: forbidden: …`
- [ ] `bun test packages/server/test/grants/create.test.ts` passes: principals of upstream's kinds (`user` by ID, `project` with environments, `github`, `oidc` with a `sub` claim, `all-users`, `all-projects`, `everyone`, `app`, `all-apps`) and OpenBoard's `connection` and `all-connections` are kept and shown as upstream's views show them; an unknown key, a malformed pattern, a `user` by email or an `oidc` principal without a well-formed `sub` is 400 `invalid_grant`; the caller needs `manage` at every pattern (403 otherwise); a grant appends `ob.grant.created`, which `/x/audit` shows and `/events` never does

## Out of scope
- Listing (277), revoking (278), changing (279), `[]` patterns (280).
- Explain and upstream's order between principals (281), `everyone` (282), the full grant-change rules (283), lockout (284), batches (285).
- Tokens of GitHub Actions and other issuers (296, 297); the settings page (299).

## Notes
- Upstream `POST /grants` and "Grants" (`03-http.md`), `GrantBody`, `GrantView` and `GrantPrincipal` in `@vercel/board` 0.54.0 (`dist/routes-*.d.mts`, `dist/auth-*.d.mts`). docs/auth.md "Upstream's model" 5 and "Connections" (principal kind `connection`, group `all-connections`), docs/protocol.md route inventory and "Deferred and dropped" (`project`, `all-projects`, `app`, `all-apps` are kept and shown, never matched).
- The `grants` and `grant_principals` tables exist (migration 0002), with `next_grant` on `boards`; `foldConnectionCreated` (`driver-sql/src/views/connections.ts`) writes a connection's own grant. Grant views go in `views/grants.ts`; `appendEvent` (`views/messages.ts`) hands every `ob.grant.*` event to one `foldGrantEvent`, as 238 does for `task.*` (hence the dependency on 238: both change that dispatch). The port members go in `packages/ports/src/grants.ts`, which `BoardView` and `BoardWriter` extend (`store.ts` is at 400 lines).
- What a caller may do: each verifier sets `callerCan` (`server/src/deps.ts`; `auth/connections.ts`, `auth/tokens.ts`, `auth/sessions.ts`, `auth/personal-tokens.ts` through `grants.allUsersCan(role)`), and `keepInsideCan` (`auth/access.ts`, 402) checks it. Compile it in `core/access/resolve.ts` from the board's unrevoked grants naming the caller (its connection or person, `all-connections` or `all-users`), read once per request through `grant_principals_kind`, keeping g1's role cap (152, `capByRole`); a claimed token stays inside its pin. Here grants on one pattern add up; upstream's order between principal levels arrives with 281, `everyone` with 282. The local owner keeps every permission.
- OpenBoard verifies its own tokens, so a `user` principal takes a person's ID (`{ kind: "user", userId: "u_…" }`, principal `ob:user:u_…`) and an email is 400 `invalid_grant`, as upstream says of a board that verifies tokens itself. `oidc` needs a `sub` claim, exact or ending in `*` right after a `:` or `/` (upstream "Grants"); naming one takes `manage` everywhere (283). `github` and `oidc` principals match callers from 296 and 297.
- CLI: `packages/cli/src/commands/grants.ts` with upstream's principal flags plus `--connection <id>` and `--all-connections`, parsed in `packages/cli/src/grant-principals.ts` (reused by 281's `explain`). `RefKind` already has `grant`: seed one per organization.
