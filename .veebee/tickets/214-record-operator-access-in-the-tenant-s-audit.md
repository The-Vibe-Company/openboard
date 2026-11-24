---
id: 214
title: Record operator access in the tenant's audit
milestone: M7-hosted-deploy
package: app
writes:
  - apps/openboard/src/main.ts
  - apps/openboard/src/admin.ts
  - apps/openboard/src/compose.ts
  - apps/openboard/test/admin.test.ts
  - packages/server/src/operator.ts
  - packages/server/src/index.ts
  - packages/server/test/operator.test.ts
  - packages/ports/src/store.ts
  - packages/driver-sql/src/views/orgs.ts
  - docs/auth.md
  - docs/decisions.md
  - apps/openboard/package.json
  - apps/openboard/src/config.ts
  - apps/openboard/tsconfig.json
  - bun.lock
  - docs/protocol.md
  - packages/contract/src/operations/audit.ts
  - packages/ports/src/index.ts
  - packages/ports/src/operator.ts
  - packages/server/openapi.json
  - packages/server/src/operations/audit.ts
conformance: []
modes: [local, hosted]
depends_on: [161, 196, 209, 210]
status: done
claimed_by: Codex
issue: 375
---

## What the user does
As an organization admin, when the service's operator changes something in my organization, I see who did it, what and why in my organization's audit.

## Done when
- [x] with `OPENBOARD_DATABASE_URL` set, `bun apps/openboard/src/main.ts admin quota acme boards=20 --reason "customer asked"` sets the override, prints the organization's quotas, and exits 0; `GET /api/x/orgs/acme/audit` then lists `ob.operator.quota_changed` with actor `ob:operator:<name>`, the change and the reason
- [x] `bun test packages/server/test/operator.test.ts` passes on SQLite and on Postgres (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`): an operator action without a reason, or on an unknown organization, is refused and records nothing, and an action and its audit event commit together or not at all
- [x] `bun apps/openboard/src/main.ts admin quota acme boards=20` without `--reason` prints `error: invalid_request: --reason is required` and exits 2

## Out of scope
- The rest of the `openboard admin` command set (M15, 399), which records through the same function.
- Operator metrics (M15, 394).

## Notes
- docs/auth.md "Threat model" (operator access goes through a support role and appears in the tenant's audit), docs/architecture.md "SaaS seams" (v1: recorded), D40. No doc designs it further, so this ticket proposes the shape, recorded in docs/decisions.md: operator actions are `openboard admin …` server commands, run where the database URL is (a Railway shell or a one-off command), never HTTP routes; the operator's name comes from `OPENBOARD_OPERATOR` or the OS user, as principal `ob:operator:<name>`; each action and its `ob.operator.*` organization event commit in one transaction under the organization's lock (D49).
- The first action is the quota override 196 needed an operator for; quotas are where the owner will first act on a tenant. Owner: confirm the command name before this is claimed.
- `admin` is a server command like `migrate` (167): handled in `apps/openboard/src/main.ts` before `runCli`, the driver reached only through `compose.ts`.
- Depends on 209 and 210, the last tickets before it to change `packages/driver-sql/src/views/orgs.ts` and `apps/openboard/src/compose.ts`.
