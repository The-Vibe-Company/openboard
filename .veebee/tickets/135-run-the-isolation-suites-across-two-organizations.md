---
id: 135
title: Run the isolation suites across two organizations
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/test/isolation/**
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sqlite/test/isolation.test.ts
conformance: []
modes: [local]
depends_on: [97, 134]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner of the code base, I know no operation lets one organization read or change another's data.

## Done when
- [ ] `bun test packages/server/test/isolation` seeds organizations A and B and runs one path case per `org`/`board` operation and one ID case per `Ref` field; it passes and prints the number of cases
- [ ] on a scratch branch, making one handler look up a message without its scope makes the suite fail naming that operation

## Out of scope
- The same suites on Postgres (M5, 168).
- Expected-failure lists: forbidden (AGENTS.md non-negotiable 15).

## Notes
`docs/codebase.md` 6.5 and 4.4; storage twin in `packages/ports/testkit/isolation.test-suite.ts`. Owner-reviewed (CODEOWNERS), label `isolation`. This ticket closes M4's "tenant isolation suite green on SQLite".
