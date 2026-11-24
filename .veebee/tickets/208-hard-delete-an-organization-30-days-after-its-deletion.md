---
id: 208
title: Hard-delete an organization 30 days after its deletion
milestone: M7-hosted-deploy
package: server
writes:
  - packages/server/src/jobs/purge-org.ts
  - packages/server/src/jobs/registry.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/orgs.test-suite.ts
  - packages/driver-sql/src/views/orgs.ts
  - packages/driver-sql/src/views/purge.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/test/ha/purge-org.test.ts
conformance: []
modes: [local, hosted]
depends_on: [181, 207]
status: draft
claimed_by: null
issue: 369
---

## What the user does
As a person who left a hosted OpenBoard, 30 days after my organization's deletion nothing of it remains in the database.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/purge-org.test.ts` passes with both instances' runners polling: an organization deleted at T keeps every row at T + 29 days; at T + 30 days exactly one runner removes every row carrying its `org_id` (events, messages, connections, agents, memberships, invitations, organization events, boards), a second run of the job changes nothing, and the other organization's digest (docs/codebase.md 6.5) is unchanged
- [ ] the same file passes on SQLite: `bun test packages/server/test/ha/purge-org.test.ts`

## Out of scope
- Deleting the organization's prefix in the backup bucket (210, which owns the bucket).
- Backups ageing out within their retention (docs/architecture.md "SaaS seams": nothing to build).
- Hard-deleting a single board's rows (not planned in the cut).

## Notes
- docs/architecture.md "SaaS seams" (organization deletion) and "Jobs any instance can take" (the pick pattern; effects keyed so a duplicate pick does nothing), D40. The soft delete of 207 enqueues the job through the `Jobs` port (181) in its own write, due at `purgeAt`; this ticket adds that enqueue to the deletion's write in `packages/driver-sql/src/views/orgs.ts` and registers the job kind in `packages/server/src/jobs/registry.ts`.
- The purge deletes table by table in batches, each statement filtering on `org_id` (the registry's tenant check holds, `packages/driver-sql/src/statements.ts`); when a new tenant table appears, its migration's ticket adds it here, and a testkit case fails on a table with an `org_id` column the purge does not list.
- The `orgs` row and its slug stay, with `deleted_at` set, so the slug is never reused (207).
- A new job kind is handled by the release before the one that enqueues it (docs/codebase.md 5.7): with the deletion route already live, ship the handler first or in the same release as the enqueue.
