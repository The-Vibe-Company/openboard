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
status: done
claimed_by: codex-a925b7f8
issue: 21
---

## What the user does
As a contributor, I open a PR and its body already asks for Ticket, Users, Protocol, Conformance, Performance, Tests and Dependency.

## Done when
- [x] `.github/pull_request_template.md` contains the eight lines `Ticket:`, `Closes #`, `Users:`, `Protocol:`, `Conformance:`, `Performance:`, `Tests:`, and `Dependency:`.
- [ ] Once the template is on `main`, GitHub's new pull request form prefills those eight lines.

## Out of scope
- Code owners (22).

## Notes
`docs/project.md` section 3 "Body".
