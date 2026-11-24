---
id: 338
title: Verify deliveries in examples/webhook-receiver
milestone: M11-webhooks-and-watchers
package: tools
writes:
  - examples/webhook-receiver/package.json
  - examples/webhook-receiver/tsconfig.json
  - examples/webhook-receiver/README.md
  - examples/webhook-receiver/src/main.ts
  - examples/webhook-receiver/src/verify.ts
  - examples/webhook-receiver/test/receiver.test.ts
  - package.json
  - scripts/ci/boundaries.json
conformance: []
modes: [local, hosted]
depends_on: [171, 237, 305]
status: draft
claimed_by: null
issue: null
---

## What the user does
As someone wiring an external runner to the board, I copy `examples/webhook-receiver`, run it with the webhook's secret, and see each verified delivery printed, rejected ones refused, and retries recognised.

## Done when
- [ ] `bun test examples/webhook-receiver` passes: against an in-process board (`createApp` on SQLite, through the published SDK names only), a webhook on `dev --label status=ready` with `labels.changed` delivers to the receiver's handler, which verifies `webhook-signature` (Standard Webhooks: HMAC-SHA256 over `id.timestamp.body` with the `whsec_` secret), refuses a wrong signature or a timestamp more than 5 minutes off with 401, dedupes on `webhook-id`, and hands on `{ thread, channel, labels, event }` from the payload
- [ ] with `ob serve` running, `bun examples/webhook-receiver/src/main.ts --port 9000 < hook.secret` and a webhook created by `ob webhooks create --file dev-ready.json --secret-file hook.secret` on `http://127.0.0.1:9000/hook`: `ob label <id> status=ready` makes the receiver print `verified dl_… labels.changed dev <id> status=ready`, and stopping then restarting the receiver shows the retried delivery under the same `dl_` ID
- [ ] `bun run verify` runs the example's tests and type-check, and `bun run lint` refuses an import of `@openboard/server` from `examples/` outside its test

## Out of scope
- Launching anything from a delivery (355); verifying the other presets (each receiver's own library does).

## Notes
- docs/project.md M11 "Done when" (`examples/webhook-receiver` passes its own test), docs/codebase.md 2.1 (`examples/*`: `README.md` and `src/main.ts`, SDK or webhook consumers only; nothing imports them), docs/protocol.md "Worked example: a generic HTTP endpoint" (a standard-webhooks receiver dedupes on `webhook-id`). No integration name in the recipe: it is the generic receiver every runner starts from.
- The secret arrives on stdin or `WEBHOOK_SECRET_FILE`, never argv (AGENTS.md non-negotiable 7). Verification is about 40 lines of `node:crypto`, no dependency.
- The root `test` and `typecheck` scripts filter `./packages/*`, `./apps/*`, `./tools/*`: add `./examples/*`. The test is a composition root that boots a board in process, so it needs an entry in `scripts/ci/boundaries.json` (owner-reviewed; docs/codebase.md 3.1 lets examples import only `sdk` and `cli`).
- Depends on 171 and 237, the last tickets before it to change the root `package.json` and `scripts/ci/boundaries.json`, and on 305 so the manual run on loopback works in local mode by the rule 305 records.
