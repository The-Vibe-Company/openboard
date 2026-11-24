---
id: 399
title: Run openboard admin commands
milestone: M15-operations
package: app
writes:
  - apps/openboard/src/admin.ts
  - apps/openboard/test/admin.test.ts
  - packages/server/src/operator.ts
  - packages/server/test/operator.test.ts
  - packages/ports/src/store.ts
  - packages/driver-sql/src/views/operator.ts
  - packages/driver-sql/src/statements.ts
  - docs/auth.md
conformance: []
modes: [hosted]
depends_on: [214]
status: draft
claimed_by: null
issue: 594
---

## What the user does
As the operator of the hosted service, I list organizations, look one up, and delete or undelete one for abuse from a shell where the database is, and the tenant sees each action and its reason in its audit.

## Done when
- [ ] with `OPENBOARD_DATABASE_URL` set: `openboard admin orgs` prints one line per organization (slug, created, deleted or not, boards, members, stored bytes); `openboard admin show acme` prints its quotas and overrides, owners, boards and deletion state; `openboard admin delete acme --reason "abuse report"` soft-deletes it as 207 does and `openboard admin undelete acme --reason "appeal accepted"` restores it within its 30 days; `--json` prints the same as JSON
- [ ] `bun test packages/server/test/operator.test.ts` passes on SQLite and Postgres: every action that changes something needs `--reason` (exit 2, `error: invalid_request: --reason is required`), records an `ob.operator.*` organization event with actor `ob:operator:<name>` in the same transaction, and shows in `GET /api/x/orgs/acme/audit`; undeleting after the purge ran exits 1 and changes nothing; read-only commands record nothing
- [ ] `openboard admin --help` lists every command, and docs/auth.md "Threat model" lists them as the operator's only way to act on a tenant

## Out of scope
- `admin quota` (214); usage (396); restore (390); metrics (394).
- Any operator HTTP route: operator actions stay server commands (214's decision).

## Notes
- **No doc lists the command set** (cut question 8): this ticket proposes `orgs`, `show`, `delete`, `undelete` beside 214's `quota`, chosen for the actions a stranger-facing service needs first (find a tenant, act on abuse, undo a mistake), listed in docs/auth.md "Threat model" beside the operator decision 214 records, not in a new decision record, since 214 already decided their shape. Stop with `needs-decision` if the owner wants another set.
- Each action goes through 214's operator function (`packages/server/src/operator.ts`: action and audit event in one transaction under the organization's lock, D49), the name from `OPENBOARD_OPERATOR` or the OS user. Reads go through `packages/driver-sql/src/views/operator.ts`, platform-wide statements listed as such in the registry's scope check.
- `delete` reuses 207's soft delete and enqueues 208's purge exactly as an owner's deletion does; `undelete` clears `deleted_at` and drops the pending purge job.
- **Arrow added:** 214, which lands `apps/openboard/src/admin.ts` and `packages/server/src/operator.ts` and is not upstream of 215.
- Depends on 323, the last ticket before it to change docs/auth.md.

Orchestrator note (2026-11-24): the dependency on the deferred Railway ticket(s) [215] was dropped; this ticket does not need a deployment.

No longer waits for 323 (orchestrator, 2026-11-24): that dependency only ordered edits to a shared file; whichever ticket lands second rebases.
