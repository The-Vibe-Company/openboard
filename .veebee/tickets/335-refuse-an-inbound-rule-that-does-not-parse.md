---
id: 335
title: Refuse an inbound rule that does not parse
milestone: M11-webhooks-and-watchers
package: core
writes:
  - packages/core/src/inbound/rules.ts
  - packages/core/test/inbound/rules.test.ts
  - packages/server/test/inbound/invalid-rules.test.ts
conformance: []
modes: [local, hosted]
depends_on: [326]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board admin, a mistake in an inbound endpoint's rules is refused when I save it, with the place of the mistake, instead of silently doing nothing when events arrive.

## Done when
- [ ] `bun test packages/server/test/inbound/invalid-rules.test.ts` passes: creating or changing an endpoint answers 400 `invalid_rule` naming the path (`rules[1].do[0].reply`) for an unknown action, an action with an unknown or missing argument, a `when` path not starting with `body.` or `headers.`, an unclosed `{{`, a template naming something other than `body.*` or `thread.*`, a `thread.pattern` that is not a valid regex or has no capturing group, more than 32 rules or 8 actions in one rule, and a rule with no action
- [ ] `bun test packages/core/test/inbound/rules.test.ts` passes: the parse is pure and returns the plan 328-332 run, so no check repeats at receive time

## Out of scope
- Verifying a body against a schema of the sender's events (not in docs).

## Notes
docs/protocol.md "Inbound endpoints" (shape of `thread`, `rules`, `when`, `do`), docs/protocol.md "Error envelope" (`invalid_rule`). The limits (32 rules, 8 actions) are proposals; say so in the PR. A regex runs on untrusted input at receive time: refuse patterns over 200 characters and run them on at most 200 characters of input, so a crafted body cannot stall an instance.
