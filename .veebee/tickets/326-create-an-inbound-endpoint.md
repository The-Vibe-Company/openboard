---
id: 326
title: Create an inbound endpoint
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/contract/src/operations/inbound.ts
  - packages/contract/src/entities/inbound.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/inbound/rules.ts
  - packages/core/test/inbound/rules.test.ts
  - packages/core/src/orgs/quotas.ts
  - packages/core/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/inbound.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sql/migrations/*-inbound.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/inbound.ts
  - packages/server/src/operations/inbound.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/inbound/create.test.ts
  - packages/server/test/isolation/seed.ts
  - packages/cli/src/commands/inbound.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/test/inbound.test.ts
conformance: []
modes: [local, hosted]
depends_on: [181, 304, 314]
status: claimed
claimed_by: codex
issue: 511
---

## What the user does
As a board admin, I create an inbound endpoint for an external runner's status events with `ob inbound create --file runner-status.json --secret-file inbound.secret`, get its URL to register on the runner, and see it listed without its secret.

## Done when
- [ ] `bun test packages/server/test/inbound/create.test.ts` passes: `POST /x/inbound` with the shape of docs/protocol.md "Inbound endpoints" (`name`, `can`, `verify`, `thread`, `rules`) answers 201 `{ inbound: { id: "ib_…", url: "<BOARD_URL>/x/inbound/ib_…/events", principal: "ob:hook:ib_…", … }, secret }` (the secret only when the board generated it); the endpoint's principal gets a grant with exactly that `can`, made under the grant-change rules, so a creator without `manage` where `can` reaches gets 403 `forbidden`; `GET /x/inbound`, `GET /x/inbound/:id` never show the secret; `POST /x/inbound/:id` changes rules, `POST /x/inbound/:id/delete` removes it and its grant; the 21st endpoint on a board answers 429 `quota_exceeded` with reason `inbound`; an action outside the closed list answers 400 `invalid_rule`
- [ ] in the same file, no column holds the verify secret in clear (D29, the box of 304), and creation, change and deletion append `ob.inbound.*` events without it
- [ ] `bun test packages/cli/test/inbound.test.ts` passes: `ob inbound create --file <spec.json> --secret-file <path>` behaves as `ob webhooks create` (304) for the secret, and `ob inbound`, `ob inbound show <id>`, `ob inbound delete <id>` print what the board answers

## Out of scope
- Receiving events: signature (327), effects (328-332), duplicates (333), the 422 (334), deeper rule checks (335), the received list (336).

## Notes
- docs/protocol.md "Inbound endpoints" and "Board extensions" (`POST, GET /x/inbound`; `GET, POST /x/inbound/:id`; `POST /x/inbound/:id/delete`), D18, docs/data-model.md `inbound_endpoints`, docs/architecture.md "SaaS seams" (20 per board). The verify object is the signing scheme of D16 plus `secret` and `tolerance` (default 300 s), validated with 304's `packages/core/src/webhooks/signing.ts`; the secret is stored with `packages/server/src/webhooks/secret-box.ts`.
- The contract lands the whole rule shape of docs/protocol.md (`when` on body paths, `do` with the closed list `reply`, `label`, `react`, `task.block`, `task.unblock`, `task.cancel`, `task.expire`, `agents.revoke`), so 328-332 change behaviour only. `core/inbound/rules.ts` parses rules into a plan; 335 tightens it.
- The endpoint's grant reuses 276's grant creation and 284's lockout rules (`packages/core/src/access/grant-changes.ts`); revoking it with the endpoint is one board write.
- An inbound endpoint is a new `Ref` kind (`ib_`).
- Depends on 304 for the secret box and the signing validator, and for `core/orgs/quotas.ts`, which both change.

Waits for 314 (orchestrator, 2026-11-24, #511): the criterion's documented request is signed with `ts-id-body`, whose validator 314 adds. A first draft is on branch `t/326-create-an-inbound-endpoint`.
