---
id: 170
title: Reach the local conformance score on Postgres
milestone: M5-postgres-driver
package: tools
writes:
  - tools/conformance/src/drivers.ts
  - tools/conformance/src/run.ts
  - tools/conformance/package.json
  - tools/conformance/score.json
  - .github/workflows/ci.yml
  - scripts/ci/verify-pg.ts
  - bun.lock
conformance: ["core/answers 400 for a request that does not validate", "core/answers 404 for an ID that names nothing", "core/creates a channel only once: one a post made is there already", "core/deletes a message, leaving a tombstone", "core/drops a deleted message from what its labels find", "core/edits and deletes a message only at the revision it was read at, which only edits and deletes change", "core/holds a long-poll open until the next event", "core/ignores x-board-avatar, which x-board-profile's avatar parameter replaced", "core/ignores x-board-session: who writes is the principal and its profile", "core/labels a message only while its labels are as the write says, one of any that race", "core/lets a profile change only its own messages, and its principal all of them", "core/lists channels a page at a time, and the ones under a prefix", "core/lists the channel and you in it", "core/lists threads, each with its reply count and latest reply", "core/posts a message, and reads it back by its ID", "core/posts once for a client ID, however many times it is sent", "core/puts a reply in its root's thread", "core/raises the version with each edit, reaction, and label", "core/reads a channel's newest events, oldest first, and goes on from their cursor", "core/reads a thread's replies after one of its messages, and as many of its newest as it's asked for", "core/reads events after a cursor, each with a cursor of its own", "core/reads one channel's messages after a cursor of its own, oldest first, and on from where it stopped", "core/reads one channel's newest messages, as many as it's asked for", "core/replies after a message only while it's the thread's newest, one of any that race", "core/says in its discovery where it is", "core/shows no session on a message, its event, or you", "core/stores a handle one actor has as a mention of them, and keeps one no one has as typed", "core/takes a profile and its avatar as one x-board-profile header, and shows both on what it writes", "paging/pages back through a channel's threads by their `older`, each thread once", "paging/refuses to page threads back and forward at once", "search/finds threads by text anywhere in a message of theirs, in any case, as it reads now", "search/lists the threads of every channel under a pattern at once", "sync/keeps noSync on a post and a reply, so sync sends neither"]
modes: [local, hosted]
depends_on: [164, 168, 169]
status: draft
claimed_by: null
issue: 250
---

## What the user does
As a contributor, upstream's conformance kit passes on a hosted instance on Postgres exactly the checks it passes on the local board.

## Done when
- [ ] `OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun run conformance --driver postgres --instances 1 --update` boots one hosted instance on a fresh Postgres database, runs the kit at `/api/conformance-ci/main` as a direct connection with `*=all`, and records in `score.json` `hosted` exactly the checks `local` lists (`jq '.local == .hosted' tools/conformance/score.json` prints `true`)
- [ ] the same command without `--update` exits 0 and reports no lost check, as do the `conformance-postgres` CI job and `bun run verify:pg`, which run it with `--instances 1` from this ticket

## Out of scope
- Refusing a hosted list shorter than the local one in lint (171).
- Two instances behind the round-robin proxy, and back to `--instances 2` in CI and `verify:pg` (M6, 186).
- Running the kit against a deployed instance with `--url` (M6, 192).

## Notes
- `conformance:` lists every check `local` holds once M1 to M4 are done (the union of their tickets' claims, 33 checks); they are claimed here for hosted mode. If `local` holds others when this ticket starts, `hosted` must hold them too.
- `tools/conformance/src/drivers.ts` runs hosted mode on in-memory SQLite today, one store per instance, which is why `hosted` is empty. Boot `postgresDriver` (`@openboard/driver-postgres`, added to `tools/conformance/package.json`) on a fresh database from 162's template harness, with `mode: "hosted"`.
- The credential (D43, docs/codebase.md 6.3 step 2, docs/auth.md "The credential that runs conformance"): create the organization `conformance-ci` and its board `main`, then the direct connection with `*=all`, through the public routes, as 169's test does: sign in through the GitHub provider's test double injected in the app's `deps`, `POST /api/x/orgs`, then `POST {BOARD_URL}/x/connections` with the session and `x-ob-csrf`. No auth bypass and no SQL in the tool.
- Why one instance: until M6's cross-instance wake-up (176), a long-poll parked on one instance never wakes on a write through the other, so `core/holds a long-poll open until the next event` cannot pass behind the proxy; M5 is "one Postgres instance" in docs/project.md. The PR says it changes the arguments of the `conformance-postgres` job in `.github/workflows/ci.yml`, not the job itself.
