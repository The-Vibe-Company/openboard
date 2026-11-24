---
id: 328
title: Reply in a thread from an inbound rule
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/core/src/inbound/match.ts
  - packages/core/src/inbound/actions.ts
  - packages/core/test/inbound/match.test.ts
  - packages/server/src/inbound/receive.ts
  - packages/server/src/inbound/run.ts
  - packages/driver-sql/src/views/inbound/index.ts
  - packages/server/test/inbound/reply.test.ts
  - packages/core/src/index.ts
  - packages/core/src/webhooks/template.ts
  - packages/ports/src/inbound/index.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/driver-sql/migrations/0039-inbound-seen.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/jobs/purge.ts
  - packages/contract/src/operations/inbound/index.ts
  - packages/server/openapi.json
  - packages/server/test/inbound/create.test.ts
  - packages/server/src/operations/inbound/index.ts
  - packages/ports/testkit/isolation-case-seeds.ts
  - docs/data-model.md
  - docs/protocol.md
  - skills/openboard/references/webhooks.md
conformance: []
modes: [local, hosted]
depends_on: [317, 327]
status: done
claimed_by: codex
issue: 513
---

## What the user does
As a person following a task, when the external runner reports that its turn finished, a reply appears in the task's thread with its summary, written by the inbound endpoint.

## Done when
- [ ] `bun test packages/server/test/inbound/reply.test.ts` passes: with `"thread": { "from": "{{body.externalRef}}", "pattern": "^ob:(\\d+)$" }` and the rule `{ "when": { "body.event": "turn.finished" }, "do": [ { "reply": "Turn finished: {{body.summary}}" } ] }`, a signed `{ "event": "turn.finished", "externalRef": "ob:812", "summary": "fixed" }` posts `Turn finished: fixed` in thread 812 as `ob:hook:ib_…` and answers `{ ok: true, matched: [0], results: [{ reply: "<message id>" }] }`; `when` takes a value or a list of values; an event no rule matches answers `matched: []` and writes nothing
- [ ] in the same file, a reply to a thread in a channel the endpoint's grant does not let it post in answers 403 `forbidden` with no effect, and the reply and the record of the event ID (`inbound_seen`) commit in one board transaction

## Out of scope
- Other actions (329-332); answering a repeated event ID (333); no thread found (334).

## Notes
- docs/protocol.md "Inbound endpoints" (`thread.from` is a template over the body, `pattern` a regex whose first group is the thread ID; rules run in order; "Effects run in one board transaction together with the dedupe insert"), D18.
- Templates render with 317's `packages/core/src/webhooks/template.ts` over `{ body, thread }`, where `thread` is the root's view (`thread.claim.profile` is used by 332); the reply goes through the same decision as `POST /messages` (`packages/core/src/messages/post.ts`) under the endpoint's principal and `can`.
- `core/inbound/actions.ts` maps each action to board commands; this ticket handles `reply`, and the others answer 400 `invalid_rule` at creation until their ticket lands (326's parse plan).
