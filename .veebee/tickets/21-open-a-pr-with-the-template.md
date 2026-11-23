---
id: 21
title: Open a PR that carries the template's lines
milestone: M0-foundations
package: tools
writes:
  - .github/pull_request_template.md
conformance: []
modes: []
depends_on: [01]
status: ready
claimed_by: null
issue: 21
---

## What the user does
As a contributor, I open a PR and its body already asks for Ticket, Users, Protocol, Conformance, Performance, Tests and Dependency.

## Done when
- [ ] `gh pr create --fill` on a new branch opens a PR whose body holds the lines `Ticket:`, `Closes #`, `Users:`, `Protocol:`, `Conformance:`, `Performance:`, `Tests:`, `Dependency:`

## Out of scope
- Code owners (22).

## Notes
`docs/project.md` section 3 "Body".
