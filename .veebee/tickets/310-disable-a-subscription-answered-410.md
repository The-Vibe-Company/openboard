---
id: 310
title: Disable a subscription answered 410
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/contract/src/operations/webhooks.ts
  - packages/server/src/operations/webhooks.ts
  - packages/core/src/webhooks/outcome.ts
  - packages/driver-sql/src/views/webhooks.ts
  - packages/server/src/jobs/webhooks.ts
  - packages/server/test/webhooks/gone.test.ts
conformance: []
modes: [local, hosted]
depends_on: [309]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board admin, when a receiver answers 410 Gone the board stops calling it and tells me why, and I turn it back on with `ob webhooks enable <id>` once it is back.

## Done when
- [ ] `bun test packages/server/test/webhooks/gone.test.ts` passes: a 410 answer marks that delivery `dead`, disables the webhook (`enabled: false`, `disabledReason: "gone"`) and appends `ob.webhook.disabled`; its other pending deliveries wait and new events queue nothing; `POST /x/webhooks/:id` with `{ "enabled": true }` turns it back on and the waiting deliveries go out; the same route changes `name`, `url`, `filter`, `headers` and `body` under the same checks as creation
- [ ] `ob webhooks disable <id>` and `ob webhooks enable <id>` print the webhook with its state, and `ob webhooks show <id>` prints `disabled: gone` while it is off

## Out of scope
- Disabling after many dead deliveries (311); after the creator loses access (321).

## Notes
docs/protocol.md "Delivery semantics" (410 disables), docs/data-model.md `webhooks.enabled`, `disabled_reason`, and `GET, POST /x/webhooks/:id`. The update reuses 304's `core/webhooks/validate.ts` and the target check; changing `signing` takes a new secret the same way creation does. `enable`/`disable` are thin CLI forms of the update. Depends on 309, the last ticket to change the files it shares.
