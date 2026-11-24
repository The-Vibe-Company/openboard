---
id: 318
title: Refuse a template with an unknown path
milestone: M11-webhooks-and-watchers
package: core
writes:
  - packages/core/src/webhooks/template.ts
  - packages/core/test/webhooks/template.test.ts
  - packages/server/test/webhooks/template-paths.test.ts
conformance: []
modes: [local, hosted]
depends_on: [310, 317]
status: claimed
claimed_by: codex
issue: 503
---

## What the user does
As a board admin, a typo in a body template (`{{subject.thraed}}`) is refused when I create the webhook, not discovered as an empty field at the receiver.

## Done when
- [ ] `bun test packages/server/test/webhooks/template-paths.test.ts` passes: creating or updating a webhook whose `body` names `{{subject.thraed}}` or any path outside the version 1 payload's schema answers 400 `invalid_request` naming the path and listing the closest valid one; paths into free-form parts (`event.payload.*`, `subject.labels.*`) are accepted; an unclosed `{{` is refused
- [ ] `bun test packages/core/test/webhooks/template.test.ts` passes: the known paths come from the payload's TypeBox schema in `packages/contract/src/entities/webhooks.ts`, not from a hand-written list

## Out of scope
- Rendering (317).

## Notes
docs/protocol.md "Body templates" ("Unknown paths are 400 at creation").
