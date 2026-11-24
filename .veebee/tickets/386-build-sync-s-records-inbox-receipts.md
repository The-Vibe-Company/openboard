---
id: 386
title: Build sync's records, inbox, receipts
milestone: M14-external-sync
package: server
writes:
  - packages/contract/src/entities/sync.ts
  - packages/contract/src/operations/sync.ts
  - packages/core/src/sync/imports.ts
  - packages/core/src/sync/receipts.ts
  - packages/core/src/sync/inbox.ts
  - packages/core/test/sync/imports.test.ts
  - packages/core/src/watchers/register.ts
  - packages/core/src/index.ts
  - packages/ports/src/store.ts
  - packages/driver-sql/migrations/*-sync.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/sync.ts
  - packages/server/src/operations/sync.ts
  - packages/server/test/sync/records.test.ts
  - tools/conformance/score.json
conformance: []
modes: [local, hosted]
depends_on: [378, 385]
status: dropped
claimed_by: null
issue: 581
---

## What the user does
As someone writing a bridge between a chat platform and the board, I register a sync, import the platform's messages as profiles of my principal, record receipts for what I sent out, and pull my sync's inbox, as upstream's protocol describes.

## Done when
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass the six remaining sync checks and `tasks/holds a task when anyone but its owner edits its root, which ends its claim`; the owner removes them from `expectedSkips` (385) and they are recorded with `--update` under `local` and `hosted`
- [ ] `bun test packages/server/test/sync/records.test.ts` passes on SQLite and Postgres: an import by one connection never writes as another principal or a board-authenticated ID (403), imports and receipts stay inside the board, and every record is answered 401 or 404 across organizations as the isolation suite expects

## Out of scope
- Any platform's own code: bridges are recipes in `examples/` (387, and later recipes); core never names a platform (AGENTS.md non-negotiable 1).
- Platform webhooks received by the board itself (`POST /webhooks/:key`), which upstream's own sync owns and OpenBoard does not ship.

## Notes
- **Needs the owner's decision before anything else.** D19 and Q8 defer platform sync from v1, while docs/project.md M14 lists "Sync records, inbox, receipts" (cut question 7). If the owner keeps D19, set this ticket to `dropped` with the reason "D19 stands (Q8)", and M14 is done with 385's skips. If the owner says yes, stop with `needs-decision` until the planner re-cuts this line: as one ticket it is far over 600 changed lines per workspace (imports with authors and mentions, receipts and lookups by platform ID, the inbox with leases and acks, `@sync` watcher matches, narrowed refusals), so it becomes one ticket per check, in the order above, each recording its check; the first of them records the decision that replaces D19 in docs/decisions.md and turns docs/protocol.md "Sync (deferred)" into "Sync", which this placeholder leaves out of `writes` so that no other ticket waits on it.
- Upstream `docs/04-reference/03-http.md` "Sync's routes" and "What `sync` grants", `docs/02-sync/01-overview.md` and `02-functions.md`, `SyncImportBody`, `SyncReceiptBody`, `InboxItem` and `RegistrationView.sync` in `@vercel/board`'s `dist/routes-*.d.mts`, the sync checks in `dist/conformance-*.mjs`.
- The checks it would record are the seven 385 lists as expected skips; they stay in `conformance: []` here because 385 places them (every check is placed once) until the owner decides.
- The task check imports a root through sync and edits it as a platform user (`registerSync` then `syncImport`); 272 already holds the task for an edit by anyone but its owner, so it passes once imports exist.
- Depends on 378, the last ticket before it to change `packages/core/src/index.ts`.

Orchestrator decision (2026-11-24): dropped — D19 stands (Q8); platform sync stays deferred from v1 and M14 completes with 385's expected skips and 387's bridge recipe.
