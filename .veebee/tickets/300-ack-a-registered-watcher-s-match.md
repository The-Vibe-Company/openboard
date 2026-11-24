---
id: 300
title: Ack a registered watcher's match
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/contract/src/operations/watchers.ts
  - packages/contract/src/entities/watchers.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/events/tail.ts
  - packages/core/test/events/tail.test.ts
  - packages/core/src/watchers/register.ts
  - packages/core/src/watchers/ack.ts
  - packages/core/test/watchers/register.test.ts
  - packages/core/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/watchers.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sql/migrations/*-watchers.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/watchers.ts
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/server/src/operations/watchers.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/watchers/matches.test.ts
  - packages/server/test/isolation/seed.ts
conformance: ["watchers/matches a registered tail, hands the match to a pull, and takes its ack"]
modes: [local, hosted]
depends_on: [215, 97, 198, 276]
status: draft
claimed_by: null
issue: 485
---

## What the user does
As an agent that cannot keep a tail open, I register a watcher on a tail, pull what it matched when I wake, and ack each match so it is not handed out again.

## Done when
- [ ] `bun test packages/server/test/watchers/matches.test.ts` passes: `POST /watchers` with `{"watch":{"triage":{"tail":"dev --label conformance=x"}}}` answers `{ owner, url: null, watch, sync: [], hash }` and `GET /watchers` lists it; a post in `dev` with that label comes back from `GET /watchers/matches?wait=5` as `{ id, watcher: "triage", thread, lease, attempt: 0, event }`, `event` as `GET /events` serves it; an ack with its lease answers 200, a second ack 404 `no_match`, an ack with a lease that ran out and was pulled again 409 `stale_lease`; a tail with `--after` and a 33rd watcher answer 400 `bad_watcher`; pulling with no registration answers 404 `no_registration`
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/watchers/matches.test.ts` passes, including on two instances: a match pulled on instance 1 is not handed out by instance 2 until its 5-minute lease runs out on the fake clock, and a pull waiting on instance 2 returns when instance 1 writes the matching post
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `watchers/matches a registered tail, hands the match to a pull, and takes its ack`, recorded with `--update` under `local` and `hosted`

## Out of scope
- `path` and `url` in a registration (301); narrowed callers and claimed tokens (302); acks with `error` or `skip`, retries and `watch.failed` (303).
- `sync` entries in a registration: 384 answers them 403 as D19 says; until then a non-empty `sync` answers 400 `invalid_request`.
- Outbound webhooks (304), which reuse this ticket's tail parser and match rule.

## Notes
- Upstream: `POST /watchers`, `GET /watchers`, `GET /watchers/matches`, `POST /watchers/matches/:id/ack` in `docs/04-reference/03-http.md`; `RegistrationView` and `MatchView` in `@vercel/board`'s `dist/routes-*.d.mts`; `docs/01-board/06-watchers.md` "The expression" (a channel or `prefix/` plus `--re`, `--by`, `--mentions`, `--label`, `--text`, `--all`; `--after` fails; ids `[a-z0-9_-]`) and "What it sees" (an event matches when its message matched before or after it; labels match the message or its root). D17: registrations are keyed by actor, so `owner` is the actor ID (the principal when there is no profile, which is how the kit registers).
- `packages/core/src/events/tail.ts` parses a tail string into the feed's filters (`packages/contract/src/operations/thread-filters.ts`, `packages/core/src/threads/filters.ts`, `labelFilters`, `mentionFilter`) and decides a match from an event and its message before and after it, the same rule `GET /events` applies in `packages/driver-sql/src/views/events.ts`. One parser and one rule, so a watcher, `ob tail` and a webhook (304) see the same events.
- Matches are inserted in the writing transaction (docs/architecture.md "Life of a write" step 4; `watcher_registrations` and `watcher_matches` in docs/data-model.md). The writer in `packages/driver-sql/src/views/messages.ts` folds each event; matching happens beside the fold. A board with no registration must pay nothing: have `lockBoard` (`packages/driver-sql/src/views/boards.ts`) also return whether the board has registrations, so `bun run bench --quick` counters do not move. Leases are lazy (D24): a lease is free once `lease_until` is past, and a pull re-leases it with a new `lease` value.
- A pull hands matches one thread at a time, in event order, only for events the caller may read now (`canReadChannel`, `packages/server/src/auth/access.ts`). `wait` (at most 25 s) parks on the long-poll of 97 (`packages/server/src/live/long-poll.ts`), woken through the `Broadcaster`, never a same-process write.
- Registering appends `ob.watchers.registered` (docs/data-model.md: watcher registrations are `ob.*` events); a match ID is a new `Ref` kind for the isolation suite (`packages/server/test/isolation/seed.ts`).
- No CLI command: upstream's `vb` has none; agents use the SDK or MCP.
- Depends on 97 (long-poll; M3 is not upstream of M7, cut question 13), 198, the last ticket before it to change `packages/driver-sql/src/views/boards.ts`, and 276, the last to change `packages/driver-sql/src/views/messages.ts` and `packages/core/src/index.ts`.
