---
id: 196
title: Refuse a resource past its organization's count quota
milestone: M7-hosted-deploy
package: core
writes:
  - packages/core/src/orgs/quotas.ts
  - packages/core/src/index.ts
  - packages/core/test/orgs/quotas.test.ts
  - packages/contract/src/errors.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/orgs.test-suite.ts
  - packages/driver-sql/src/views/orgs.ts
  - packages/driver-sql/src/views/invitations.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/server/src/operations/boards.ts
  - packages/server/src/operations/invitations.ts
  - packages/server/src/operations/connections.ts
  - packages/server/test/quotas.test.ts
conformance: []
modes: [local, hosted]
depends_on: [170, 195]
status: draft
claimed_by: null
issue: 357
---

## What the user does
As an organization admin on a shared instance, I get a clear `quota_exceeded` answer when I try to create a board, a member or a connection past my organization's limit, and nothing is created.

## Done when
- [ ] `bun test packages/server/test/quotas.test.ts` passes: creating the 11th board answers 429 `quota_exceeded` with reason `boards`, accepting an invitation that would make the 51st member answers it with reason `members` without consuming the link, and creating the 101st connection on a board answers it with reason `connections`; in each case nothing is written, and an organization whose overrides raise `boards` to 12 creates its 11th and 12th
- [ ] the same file passes on Postgres (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/quotas.test.ts`), and `bun test packages/core/test/orgs/quotas.test.ts` passes: the defaults are boards 10, members 50, connections per board 100, and overrides from `orgs.quotas` replace only the keys they name

## Out of scope
- Stored bytes (197) and events per board per day (198).
- Webhooks and inbound endpoints per board: their tickets check their own quota (M11).
- A command to set an organization's overrides (214); usage rollups (M15, 396).

## Notes
- docs/architecture.md "SaaS seams" (v1 limits), docs/codebase.md 4.5, D40. The check runs in the write transaction that would exceed the limit, under the lock that write already takes (the organization's row lock for boards and members, D49; the board lock for connections), so two racing creations cannot both pass. That is why it sits in the views' write paths (`createBoard` in `packages/driver-sql/src/views/orgs.ts`, `acceptInvitation` in `views/invitations.ts`, connection creation in `views/connections.ts`) rather than in a pipeline step before the transaction, as docs/codebase.md 4.4 step 6 sketches; say so in the PR.
- The limits are a pure function in core (defaults merged with the organization's overrides, the JSON in `orgs.quotas`, docs/data-model.md); counting is one statement read with the lock. The views return a `quota` outcome the handlers turn into `BoardError("quota_exceeded", …)` with a `reason` (new reasons in `REASONS`, `packages/contract/src/errors.ts`) and a hint that names the limit.
- The test lowers or raises an organization's overrides through a platform-view method an operator command will call (214); add it to the store port (`packages/ports/src/store.ts`, an append point).
- Depends on 195 because both change `packages/driver-sql/src/views/invitations.ts`.
