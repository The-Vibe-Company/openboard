---
id: 391
title: Record a restore drill in both modes
milestone: M15-operations
package: tools
writes:
  - scripts/ops/restore-drill.ts
  - scripts/ops/restore-drill.test.ts
  - docs/runbooks/restore.md
  - docs/architecture.md
conformance: []
modes: [local, hosted]
depends_on: [389, 390]
status: draft
claimed_by: null
issue: 586
---

## What the user does
As the owner, I know how long a restore takes and how many acknowledged writes it loses in each mode, because a drill measured both, and the runbook says what to type when it happens for real.

## Done when
- [ ] `bun scripts/ops/restore-drill.ts local` against MinIO (or with `--fake-bucket`) starts `ob serve` with shipping on, writes for 60 s, kills the process with SIGKILL, deletes its data directory, restores with `openboard restore`, and prints the events acknowledged and the events restored (the difference is the RPO) and the restore's duration (the RTO); it exits 1 if any event older than 10 s before the kill is missing; `bun test scripts/ops/restore-drill.test.ts` passes
- [ ] `bun scripts/ops/restore-drill.ts hosted` against a scratch Postgres and the owner's bucket (never production) restores the latest dump and the segments after it, prints the same numbers, and the PR carries both transcripts
- [ ] docs/architecture.md "Backups and recovery" replaces "measure in a drill before launch" with the measured RPO and RTO per mode and the command that reproduces them, and `docs/runbooks/restore.md` lists the steps for a lost local disk, one lost hosted organization, and a lost database volume

## Out of scope
- Restoring Railway's own volume backups: Railway's procedure, linked from the runbook, not scripted.
- Scheduling the drill: running it again is a line in the runbook, not a CI job (adding a job is the owner's decision).

## Notes
- docs/project.md M15 ("Restore drill recorded for SQLite and Postgres"), docs/architecture.md "Backups and recovery" (RPO and RTO; "measure in a drill before launch") and "Hosted on Railway" ("To measure before launch: … the drill above").
- Owner first: the bucket (Q2) and a scratch Postgres for the hosted run (a Railway environment of its own or a local container fed with a copy of staging's dump); the hosted criterion is checked once they exist. Secrets reach the script from the environment or files, never argv.
- `docs/runbooks/` is new (400 adds `upgrade.md` beside it); link the restore runbook from docs/architecture.md "Backups and recovery".
