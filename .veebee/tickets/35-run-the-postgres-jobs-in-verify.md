---
id: 35
title: Run the Postgres jobs in Verify
milestone: M0-foundations
package: tools
writes:
  - .github/workflows/ci.yml
conformance: []
modes: [local, hosted]
depends_on: [20, 34]
status: ready
claimed_by: null
issue: 35
---

## What the user does
As a contributor, I see every PR checked on Postgres too, inside the same required Verify.

## Done when
- [ ] a PR's `Verify` aggregates six jobs, the four of 20 plus `postgres` and `conformance-postgres`, each with a Postgres service container, and is green
- [ ] on `main`, Verify still finishes in under two minutes

## Out of scope
- Driver code: the Postgres driver lands in M5.

## Notes
`docs/codebase.md` 6.2 ("In CI") and 6.7. This ticket closes M0's "Verify green on `main` in under two minutes".
