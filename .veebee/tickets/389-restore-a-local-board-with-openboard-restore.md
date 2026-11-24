---
id: 389
title: Restore a local board with openboard restore
milestone: M15-operations
package: app
writes:
  - apps/openboard/src/restore.ts
  - apps/openboard/src/main.ts
  - apps/openboard/test/restore.test.ts
  - packages/driver-sqlite/src/restore.ts
  - packages/driver-sqlite/src/index.ts
  - packages/driver-sql/src/views/restore.ts
  - packages/driver-sql/src/views/fold.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/statements.ts
conformance: []
modes: [local]
depends_on: [378, 388]
status: draft
claimed_by: null
issue: 584
---

## What the user does
As someone whose machine died, I run `openboard restore --to ./.openboard` on a new one and my board comes back from the bucket as it was ten seconds before.

## Done when
- [ ] with 388's bucket configured: `ob serve`, three posts and an attached file, 20 s, stop the server, `rm -rf .openboard`, then `openboard restore --to .openboard` prints the snapshot it started from and how many events it replayed, and `ob serve` with that directory shows the three posts with `ob read dev` and gives the file back with `ob download`; `openboard restore --to <a directory that holds a database>` prints `error: invalid_request: …` and exits 2 without touching it
- [ ] `bun test apps/openboard/test/restore.test.ts` passes with a fake bucket: the newest snapshot plus every segment after it rebuilds a board whose `events` and fold tables equal the original's byte for byte, `--at <ISO time>` stops at the last event before that time, a missing segment in the middle stops the restore with an error naming it, and `openboard restore --from .openboard/backups/<snapshot>` restores from a local snapshot with no bucket

## Out of scope
- Hosted organizations (390); importing another instance's export (393); the drill and its numbers (391).

## Notes
- D25 ("Restore = snapshot + replay", using the normal fold), docs/codebase.md 2.2 and 7.6 (`apps/openboard/src/restore.ts`; "`openboard restore` reads them back"), D42 (server commands; secrets from the environment or files only).
- A restore writes a fresh database (temp file, then rename): copy the snapshot, then append each shipped event after the snapshot's last position and fold it, in `packages/driver-sql/src/views/restore.ts`, board by board in order, under the board lock. Never through HTTP, never re-deciding a command: the events are already decided.
- `restore` is a server command handled in `apps/openboard/src/main.ts` before `runCli`, like `migrate` (167) and `admin` (214).
- Today `appendEvent` (`packages/driver-sql/src/views/messages.ts`) both appends an event and dispatches its folds; split the dispatch into `packages/driver-sql/src/views/fold.ts` so a replay folds a stored event without deciding it again. 390, 393 and 397 reuse it.
- Depends on 378, the last ticket before it to change `packages/driver-sql/src/views/messages.ts`.
