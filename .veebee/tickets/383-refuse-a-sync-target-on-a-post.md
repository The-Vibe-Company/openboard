---
id: 383
title: Refuse a sync target on a post
milestone: M14-external-sync
package: core
writes:
  - packages/contract/src/operations/messages.ts
  - packages/core/src/messages/post.ts
  - packages/core/test/messages/post-sync.test.ts
  - packages/server/test/sync/post-target.test.ts
  - docs/protocol.md
conformance: []
modes: [local, hosted]
depends_on: [381, 382]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent that asks for a new thread to start in a platform channel, I am told this board syncs nowhere, and nothing is posted, instead of a post that silently stays on the board.

## Done when
- [ ] `bun test packages/server/test/sync/post-target.test.ts` passes on SQLite and Postgres: `POST /messages` with `{ "channel": "dev", "text": "x", "sync": ["chat:#incidents"] }` answers 400 `invalid_target` with a message saying this board syncs nowhere and a `next` naming `noSync`; `sync` on a reply, and `sync` with `noSync: true`, answer 400 `invalid_request` as upstream's rules say; an empty `sync: []` posts; nothing is written on a refusal
- [ ] `bun test packages/core/test/messages/post-sync.test.ts` covers the same rules in core, and docs/protocol.md "Sync (deferred)" lists the answer to a post's `sync`

## Out of scope
- Other sync routes (382); watcher registrations (384).

## Notes
- Upstream `docs/04-reference/03-http.md` "Posting" (`sync`: at most 10 targets, a string or `{ target, kind }`; for posts only; contradicts `noSync`). Upstream's `local()` records `thread.synced` for requested targets though it syncs nowhere (`commitPost` in `dist/local-*.mjs`); OpenBoard never writes sync events (docs/protocol.md "Events"), so it refuses instead.
- **Proposal for the owner:** 400 `invalid_target` (upstream's code for "a target it can't read", already in `packages/contract/src/errors.ts`). Docs name no code for this case; record it in docs/protocol.md.
- `sync` joins the post body in the contract (`packages/contract/src/operations/messages.ts`) so the refusal is specific and not the strict body's generic `invalid_request`.
- Depends on 381, the last ticket before it to change docs/protocol.md.
