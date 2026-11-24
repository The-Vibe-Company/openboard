---
id: 382
title: Answer sync routes as a board that syncs nowhere
milestone: M14-external-sync
package: server
writes:
  - packages/contract/src/entities/sync.ts
  - packages/contract/src/operations/sync.ts
  - packages/contract/src/operations/index.ts
  - packages/server/src/operations/sync.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/sync/stubs.test.ts
conformance: []
modes: [local, hosted]
depends_on: []
status: claimed
claimed_by: claude-opus-5.5-t382
issue: 577
---

## What the user does
As an agent written for upstream's board, every sync route I call answers what a board with no sync answers, never a 404 that looks like a wrong URL, so my code takes its "no sync here" path.

## Done when
- [ ] `bun test packages/server/test/sync/stubs.test.ts` passes on SQLite and Postgres with the answers of docs/protocol.md "Sync (deferred)": `POST /messages/:id/sync` 404 `not_synced_here`; `GET /messages/:id/sync` `{ targets: [] }`; `GET /links?url=…` 404 `message_not_found`; `POST /messages/:id/typing` `{ targets: [] }`; `GET /sources/:key/read` and `POST /sources/:key/join` 404 `not_synced_here`; `POST /webhooks/:key` 404 `not_found`; `GET /inbox/:key` `{ events: [] }` for a caller with `sync` in every channel and 403 `forbidden` otherwise; `POST /inbox/:key`, `GET /inbox/:key/next`, `POST /inbox/:key/:id/ack` and every `/sync/*` route 403 `forbidden` with the message "this board keeps no sync"; `POST /wake` 404
- [ ] in the same file: a message route given an ID that names no message (`/messages/999999/sync`) answers 404 `message_not_found` first, another organization's message ID answers as the isolation rules say (401 for a board-bound credential, 404 for a session), and `GET /` still answers `sync: []`

## Out of scope
- A post with sync targets (383); sync entries in a watcher registration (384); recording the sync checks as skips (385); building sync (386).

## Notes
- docs/protocol.md "Sync (deferred)", D19, upstream `docs/04-reference/03-http.md` "Sync's routes" and `SyncImportBody`, `SyncReceiptBody`, `SyncFindQuery`, `InboxItem`, `TypingResult` in `@vercel/board`'s `dist/routes-*.d.mts`. The stubs are contract operations with upstream's inputs (`packages/contract/src/operations/sync.ts`), so OpenAPI, the SDK and the isolation suite see them; handlers only answer as above. `cli: false` and `mcp: false`, with the reason that sync is deferred (D19).
- A route that names a message reads it through the scoped view first, so it answers for a message the caller cannot read exactly as `GET /messages/:id` does.
- No code here may name a platform (AGENTS.md non-negotiable 1): `:key` is an opaque sync key.

Orchestrator note: the dependency on 215 (serving production) was dropped: it ordered milestones, it is not a technical need, and 215 waits on the owner's production secrets, which would hold every feature milestone behind them.
