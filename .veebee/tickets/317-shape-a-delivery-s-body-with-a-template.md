---
id: 317
title: Shape a delivery's body with a template
milestone: M11-webhooks-and-watchers
package: core
writes:
  - packages/core/src/webhooks/template.ts
  - packages/core/test/webhooks/template.test.ts
  - packages/core/src/webhooks/validate.ts
  - packages/server/src/webhooks/request.ts
  - packages/server/test/webhooks/template.test.ts
conformance: []
modes: [local, hosted]
depends_on: [304]
status: draft
claimed_by: null
issue: 502
---

## What the user does
As a board admin pointing a webhook at a receiver that dictates its own body (a remote routine's trigger, a CI dispatch), I give a JSON template and each delivery's body is that template filled from the event.

## Done when
- [ ] `bun test packages/core/test/webhooks/template.test.ts` passes: `{ "externalRef": "ob:{{subject.thread}}", "idempotencyKey": "{{delivery.id}}", "input": { "board": "{{board.url}}", "labels": "{{subject.labels}}", "n": "{{delivery.attempt}}" } }` renders `subject.labels` as an object and `delivery.attempt` as a number (a value that is exactly one placeholder keeps its JSON type), and the rest as strings; a path naming nothing renders `null` alone and an empty string inside text; a placeholder never evaluates anything (no logic, no filters)
- [ ] `bun test packages/server/test/webhooks/template.test.ts` passes: a webhook with that `body` delivers the rendered JSON, signed over the rendered bytes; a rendered body over 256 KB is refused for that delivery with `lastError: "too_large"` and the delivery is dead

## Out of scope
- Refusing an unknown path at creation (318); the default payload's own cap and truncation (304).

## Notes
docs/protocol.md "Body templates" and the worked example (`"externalRef": "ob:{{subject.thread}}", "idempotencyKey": "{{delivery.id}}"`), D16. Rendering is a pure function over the version 1 payload (`core/webhooks/payload.ts`), so the same code serves 318's check. `validate.ts` stops refusing a non-null `body` (304) and checks it is a JSON object or array of at most 16 KB.
