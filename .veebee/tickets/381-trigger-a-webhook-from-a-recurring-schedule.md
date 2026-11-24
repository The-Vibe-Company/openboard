---
id: 381
title: Trigger a webhook from a recurring schedule
milestone: M13-data-files-schedules
package: server
writes:
  - packages/core/src/webhooks/payload.ts
  - packages/core/test/webhooks/payload.test.ts
  - packages/server/test/webhooks/schedule-source.test.ts
  - docs/protocol.md
conformance: []
modes: [local, hosted]
depends_on: [304, 377, 378]
status: draft
claimed_by: null
issue: 576
---

## What the user does
As a board admin, I turn a daily schedule into a cron trigger: a schedule posting in `cron/nightly-deps` every day makes my webhook fire once per day, with the send's `{ id, n }` as an idempotency key.

## Done when
- [ ] `bun test packages/server/test/webhooks/schedule-source.test.ts` passes on SQLite and Postgres with a fake clock and the injected `fetch`: a webhook with `{ "tail": "cron/nightly-deps", "types": ["message.posted"] }` and the body template `{ "event_type": "openboard", "client_payload": { "thread": "{{subject.thread}}", "schedule": "{{subject.schedule}}", "delivery": "{{delivery.id}}" } }`, and `POST /schedules { "channel": "cron/nightly-deps", "text": "nightly sweep", "every": "1d", "at": … }`, make one delivery per day whose `subject.schedule` is `{ id: "s1", n: 0 }`, then `n: 1`; a message posted by hand in that channel has `subject.schedule: null`
- [ ] in the same file on Postgres with two instances, each send is delivered once although both runners poll, and a retried delivery keeps its `delivery.id` and `subject.schedule`

## Out of scope
- The receiver's side: `examples/` recipes (355) and GitHub's `repository_dispatch`, which is configuration.

## Notes
- docs/protocol.md "Outbound webhooks" ("Schedules are a source"), "Delivery payload (version 1)" (`subject.schedule`: `{ id, n }` for scheduled messages, a natural idempotency key) and "Worked example: a generic HTTP endpoint"; D16 (body templates, 317).
- **Arrow added:** 378, which sends the schedule (the cut's 377 computes repeats but sends nothing).
- 304's payload builder (`packages/core/src/webhooks/payload.ts`) leaves `subject.schedule` null; fill it from the message's `schedule` (378). Update the worked example in docs/protocol.md if anything in it differs from what the test shows.
