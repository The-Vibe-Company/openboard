---
id: 33
title: Run the tenant isolation suite over the contract
milestone: M0-foundations
package: server
writes:
  - packages/server/test/isolation/**
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/server/package.json
  - packages/server/tsconfig.json
  - bun.lock
conformance: []
modes: [local]
depends_on: [01]
status: done
claimed_by: Codex
issue: 33
---

## What the user does
As a contributor, I have an isolation suite that will grow one cross-tenant case for every operation I add.

## Done when
- [x] `bun test packages/server/test/isolation` runs as part of `bun run verify`, walks `operations` from `@openboard/contract` (empty for now) and prints `0 operations checked`, passing

## Out of scope
- Seeding two organizations and the path and ID cases: 135, the first multi-tenant ticket.
- The storage-level twin in `packages/ports/testkit` (135).

## Notes
`docs/codebase.md` 6.5 and 4.2 ("Isolation suite" row). Until 135, the suite only fails on an operation without `scope`. Owner-reviewed (CODEOWNERS), label `isolation`.
