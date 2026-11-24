---
id: 393
title: Import an organization export into ob serve
milestone: M15-operations
package: app
writes:
  - apps/openboard/src/import.ts
  - apps/openboard/src/main.ts
  - apps/openboard/test/import.test.ts
  - packages/driver-sqlite/src/import.ts
  - packages/driver-sqlite/src/index.ts
  - docs/codebase.md
conformance: []
modes: [local]
depends_on: [389, 392]
status: draft
claimed_by: null
issue: null
---

## What the user does
As someone moving a board off the hosted service, I run `openboard import acme.tar.gz --to ./.openboard`, start `ob serve`, and read my board's history there.

## Done when
- [ ] `openboard import acme.tar.gz --to /tmp/ob-acme` prints the board it imported as `local/main` and how many events and files; `OPENBOARD_DATA_DIR=/tmp/ob-acme ob serve`, then `ob read dev` shows acme's threads with their authors, labels, tasks and attachments (`ob download` gives the bytes back); `--board ops` imports the board `ops` instead of `main`, and an archive with several boards and no `--board` imports `main` and names the others it left out
- [ ] `bun test apps/openboard/test/import.test.ts` passes: the imported board's fold tables equal those of a board built by the same events; importing into a directory that holds a database exits 2 and touches nothing; an archive whose manifest version is unknown, or whose segment is cut short, exits 1 naming the file; the connections of the export are listed as not imported, with the `ob connections create` command to re-create each

## Out of scope
- Exporting (392); importing into a hosted instance (an operator's restore, 390).
- Carrying people's accounts: local mode has one owner (docs/auth.md "Local mode"); authors stay as the events name them.

## Notes
- docs/architecture.md "SaaS seams" (organization export importable into `ob serve`), docs/codebase.md 7.6 ("Moving from local to Postgres is an organization export and import"): update it to say how, including that local mode serves one organization, `local`, so the import maps one board onto `local/main` (proposed here; the owner may prefer keeping several boards).
- Replays like 389 (`packages/driver-sql/src/views/restore.ts`, folding through `views/fold.ts`), rewriting each event's `org_id` and `board_id` to the local ones and keeping its ID (IDs are log positions, D9). Blobs go through the filesystem `Blobs` driver (367).
- **Arrow added:** 389, whose replay this reuses.
- `import` is a server command in `apps/openboard/src/main.ts`, like `restore` (389).
