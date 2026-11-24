---
id: 310
title: Disable a subscription answered 410
milestone: M11-webhooks-and-watchers
package: server
writes:
  - docs/decisions.md
  - docs/protocol.md
  - packages/cli/src/commands/index.ts
  - packages/cli/src/commands/usage.ts
  - packages/cli/src/commands/webhooks/state.ts
  - packages/cli/src/output.ts
  - packages/cli/test/webhooks.test.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/audit.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operations/webhooks/index.ts
  - packages/core/src/index.ts
  - packages/core/src/webhooks/events.ts
  - packages/core/src/webhooks/outcome.ts
  - packages/core/src/webhooks/validate.ts
  - packages/core/test/webhooks/outcome.test.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/views/webhooks/deliveries.ts
  - packages/driver-sql/src/views/webhooks/webhooks.ts
  - packages/ports/src/webhooks/index.ts
  - packages/ports/testkit/isolation-case-seeds.ts
  - packages/ports/testkit/isolation-webhooks.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/openapi.json
  - packages/server/src/http/pipeline.ts
  - packages/server/src/jobs/webhooks.ts
  - packages/server/src/operations/audit.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/webhooks/deliveries.ts
  - packages/server/src/operations/webhooks/index.ts
  - packages/server/test/webhooks/claimed-token.test.ts
  - packages/server/test/webhooks/gone.test.ts
  - skills/openboard/references/commands.md
  - skills/openboard/references/webhooks.md
conformance: []
modes: [local, hosted]
depends_on: [309]
status: done
claimed_by: codex-310
issue: 495
---

## What the user does
As a board admin, when a receiver answers 410 Gone the board stops calling it and tells me why, and I turn it back on with `ob webhooks enable <id>` once it is back.

## Done when
- [ ] `bun test packages/server/test/webhooks/gone.test.ts` passes: a 410 answer marks that delivery `dead`, disables the webhook (`enabled: false`, `disabledReason: "gone"`) and appends `ob.webhook.disabled`; its other pending deliveries wait and new events queue nothing; `POST /x/webhooks/:id` with `{ "enabled": true }` turns it back on and the waiting deliveries go out; the same route changes `name`, `url`, `filter`, `headers` and `body` under the same checks as creation
- [ ] `ob webhooks disable <id>` and `ob webhooks enable <id>` print the webhook with its state, and `ob webhooks show <id>` prints `disabled: gone` while it is off
- [ ] At the daily event quota, a 410 still disables the webhook and appends the audit event without reserving or charging an event slot.

## Out of scope
- Disabling after many dead deliveries (311); after the creator loses access (321).

## Notes
docs/protocol.md "Delivery semantics" (410 disables), docs/data-model.md `webhooks.enabled`, `disabled_reason`, and `GET, POST /x/webhooks/:id`. The update reuses 304's `core/webhooks/validate.ts` and the target check; changing `signing` takes a new secret the same way creation does. `enable`/`disable` are thin CLI forms of the update. Depends on 309, the last ticket to change the files it shares.
