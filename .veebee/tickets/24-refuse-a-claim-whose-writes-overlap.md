---
id: 24
title: Refuse a ticket claim whose writes overlap a claimed ticket
milestone: M0-foundations
package: tools
writes:
  - scripts/tickets/claim.ts
  - scripts/tickets/lib.ts
  - scripts/tickets/test/**
conformance: []
modes: []
depends_on: [23]
status: ready
claimed_by: null
issue: 24
---

## What the user does
As a contributor agent, I cannot claim a ticket whose `writes` overlap a ticket another agent holds.

## Done when
- [ ] with ticket A `status: claimed` writing `scripts/ci/**`, `bun scripts/tickets/claim.ts B` for a ticket writing `scripts/ci/sizes.ts` exits 1 naming A and the overlapping glob, and leaves B unchanged
- [ ] for a ticket with no overlap and `status: ready`, it sets `status: claimed` and `claimed_by`

## Out of scope
- Claiming through the board (`ob tasks claim --next`): dogfooding phase B (275).

## Notes
`docs/project.md` section 5 (ownership, shared append points, one claimed ticket at a time touching `contract`, `ports` or `driver-sql/migrations/`).
