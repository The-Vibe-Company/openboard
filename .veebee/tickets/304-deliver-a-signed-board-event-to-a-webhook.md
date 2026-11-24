---
id: 304
title: Deliver a signed board event to a webhook
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/contract/src/operations/webhooks.ts
  - packages/contract/src/entities/webhooks.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/webhooks/validate.ts
  - packages/core/src/webhooks/filter.ts
  - packages/core/src/webhooks/signing.ts
  - packages/core/src/webhooks/payload.ts
  - packages/core/src/webhooks/outcome.ts
  - packages/core/test/webhooks/filter.test.ts
  - packages/core/test/webhooks/payload.test.ts
  - packages/core/src/orgs/quotas.ts
  - packages/core/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/webhooks.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sql/migrations/*-webhooks.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/webhooks.ts
  - packages/driver-sql/src/views/deliveries.ts
  - packages/server/src/operations/webhooks.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/jobs/webhooks.ts
  - packages/server/src/jobs/sign.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/src/webhooks/request.ts
  - packages/server/src/webhooks/target.ts
  - packages/server/src/webhooks/send.ts
  - packages/server/src/webhooks/secret-box.ts
  - packages/server/src/deps.ts
  - packages/server/test/webhooks/deliver.test.ts
  - packages/server/test/isolation/seed.ts
  - packages/cli/src/commands/webhooks.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/test/webhooks.test.ts
  - apps/openboard/src/config.ts
  - apps/openboard/test/config.test.ts
conformance: []
modes: [local, hosted]
depends_on: [181, 213, 286, 300]
status: draft
claimed_by: null
issue: 489
---

## What the user does
As a board admin, I subscribe a URL to the board's events with `ob webhooks create --file dev-ready.json --secret-file hook.secret`, and when someone sets `status=ready` on a thread in `dev`, my receiver gets one signed POST it can verify with the secret.

## Done when
- [ ] `bun test packages/server/test/webhooks/deliver.test.ts` passes: `POST /x/webhooks` with `{ "name": "dev-ready", "url": "http://127.0.0.1:9000/hook", "filter": { "tail": "dev --label status=ready", "types": ["labels.changed"] } }` answers 201 `{ webhook: { id: "wh_…", … }, secret: "whsec_…" }`; labelling a thread in `dev` `status=ready` (`POST /messages/:id/labels`) then makes the job runner send one POST (through the injected `fetch`) whose body is the version 1 payload of docs/protocol.md "Delivery payload" and whose `webhook-id`, `webhook-timestamp` and `webhook-signature` verify against that secret; a post in `ops`, a label set in a thread without `status=ready`, and a reply in the labelled thread (a `message.posted`) send nothing; a non-2xx answer marks the delivery `dead` with its status
- [ ] in the same file: creating needs `manage` throughout the tail's channel (a member capped by role gets 403 `forbidden`), the 21st webhook on a board answers 429 `quota_exceeded` with reason `webhooks`, `GET /x/webhooks` and `GET /x/webhooks/:id` never show the secret, `POST /x/webhooks/:id/delete` stops deliveries, and in hosted mode every URL answers 400 `invalid_url` (the address guard arrives with 305)
- [ ] `bun test packages/cli/test/webhooks.test.ts` passes: `ob webhooks create --file <spec.json> --secret-file <path>` writes the generated secret to `<path>` with mode 0600 and prints only the webhook's ID, uses the file's content as `signing.secret` when `<path>` already exists, and `ob webhooks`, `ob webhooks show <id>`, `ob webhooks delete <id>` print what the board answers without any secret

## Out of scope
- The SSRF guard and hosted targets (305); test pings (306); retries, dead letters, re-sends, disabling (307-311); every preset but `standard-webhooks` (312-316); body templates (317, 318); `became` (319); per-thread order (320); re-checking the creator's read access (321); key handling beyond encrypting with a configured key (323); delivery caps (324).
- Updating a webhook (`POST /x/webhooks/:id`, 310).

## Notes
- docs/protocol.md "Outbound webhooks" (subscription, payload version 1, standard-webhooks preset), D15, D16, D29, docs/data-model.md `webhooks` and `webhook_deliveries`, docs/architecture.md "Jobs any instance can take" (deliveries row). `packages/contract/src/entities/webhooks.ts` lands the whole wire shape of docs/protocol.md (filter with `tail`, `types`, `became`; the signing scheme object and its five presets; `headers`; `body`) so later tickets change behaviour, not the contract; `packages/core/src/webhooks/validate.ts` calls one validator per part (`filter.ts` for the filter, `signing.ts` for the scheme and static headers, its own body check) and refuses what is not built yet with 400 `invalid_signing` or `invalid_request` saying it is not available yet. Static headers are already stored (encrypted) and sent by `request.ts`, and views show their names with `"…"` as values, so 316 only lifts the refusal.
- The filter reuses 300's tail parser and match rule (`packages/core/src/events/tail.ts`): an event goes out when its message matched before or after it, `types` narrows. Deliveries are inserted in the writing transaction, beside the watcher matches 300 inserts, from the message before and after each event (so 319 can add `became` in `filter.ts` alone); a board without subscriptions adds no statement (the `lockBoard` flag of 300).
- Who may create: `manage` throughout every channel the tail can match (D15; a tail with no channel needs it everywhere), checked like `allowedThroughout` in `packages/server/src/auth/access.ts`. The webhook keeps its creator (`owner_actor`, `owner`) for 321.
- Sending: `packages/server/src/jobs/webhooks.ts` leases due rows (registered in `jobs/registry.ts` of 181), builds the request in `webhooks/request.ts` (payload or body, static headers, signature from `jobs/sign.ts`), and sends it through `webhooks/send.ts`, the one place that calls out: `deps.fetch` with redirects refused, a 10 s timeout from `deps`, the answer's body read to 8 KB at most. 305 changes how `send.ts` connects; nothing else calls `fetch`. One attempt here: 2xx is `done`, anything else `dead` (`core/webhooks/outcome.ts`, which 307 extends).
- Targets: `webhooks/target.ts` checks a URL at creation and before each attempt. Here it accepts only loopback (`127.0.0.1`, `[::1]`, `localhost`, `http` or `https`) in local mode and refuses everything in hosted mode with 400 `invalid_url`, so no merge opens an SSRF hole before 305 writes the guard into the same function.
- Secrets: the signing secret is stored AES-256-GCM under `OPENBOARD_SECRET_KEY` (D29) by `webhooks/secret-box.ts` (`node:crypto`); the key reaches the server as `ServerConfig.secretKey` (32 bytes, base64 or base64url; anything else exits 2, `apps/openboard/src/config.ts`). With no key configured, creating a webhook answers 501 `not_supported` with the hint to set `OPENBOARD_SECRET_KEY`. The secret is answered once, never logged (the logger already drops `secret` keys, docs/codebase.md 5.4) and never in an `ob.webhook.*` audit event.
- `ob webhooks create` is hand-written because the answer holds a secret, as `ob connections create` is (`packages/cli/src/commands/connections.ts`): a secret never reaches argv or standard output. The other `ob webhooks` commands derive from the contract's `cli` blocks.
- A webhook and a delivery are new `Ref` kinds (`wh_`, `dl_`; docs/codebase.md 6.5 seeds a webhook).
- Depends on 300 for the tail parser and the write-path hook; on 213 and 245, the last tickets before it to change `apps/openboard/src/config.ts` and `packages/server/src/jobs/registry.ts`; on 286, the last to change `packages/server/src/deps.ts`. The webhook count quota is the `webhooks` key of 196's `packages/core/src/orgs/quotas.ts` (20 per board, docs/architecture.md "SaaS seams").

No longer waits for 245 (orchestrator, 2026-11-24): it only ordered edits to `apps/openboard/src/config.ts` and `packages/server/src/jobs/registry.ts`, which take one entry per ticket; whichever lands second rebases.
