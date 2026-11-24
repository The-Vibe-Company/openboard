---
id: 327
title: Refuse an inbound event with a bad signature
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/contract/src/operations/inbound-events.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operation.ts
  - packages/server/src/inbound/verify.ts
  - packages/server/src/inbound/receive.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/test/inbound/signature.test.ts
conformance: []
modes: [local, hosted]
depends_on: [326]
status: draft
claimed_by: null
issue: 512
---

## What the user does
As a board admin, only the runner that holds the endpoint's secret can make the board act: a forged, altered or replayed event is refused before anything is read or written.

## Done when
- [ ] `bun test packages/server/test/inbound/signature.test.ts` passes: `POST /x/inbound/:id/events` signed with the endpoint's scheme over the raw body answers 200 `{ ok: true, matched: [], results: [] }` (no rule matches yet); a wrong signature, a changed byte of the body, a missing header, or a timestamp more than `tolerance` seconds away answers 401 `bad_signature` and writes nothing; an unknown, deleted or disabled endpoint answers 404 `not_found`; a bearer token is neither needed nor looked at; the same scheme verifies for `standard-webhooks` and every preset 312-315 have built
- [ ] in the same file, the comparison is constant-time (`timingSafeEqual`), a body over 1 MB answers 413 `too_large` before verifying, and no log line holds the body, the signature or the secret

## Out of scope
- What the event does (328 onward); duplicates (333).

## Notes
- docs/protocol.md "Inbound endpoints" ("Verification with the same scheme object as outbound signing, over the raw body; timestamp within `tolerance`"), D16, D18, docs/auth.md "Webhook forgery (inbound)".
- The receiving route is a board operation that takes a signature instead of a credential: add that to `defineOperation` (`packages/contract/src/operation.ts`, for example `auth: "signature"`) so the pipeline (`packages/server/src/http/pipeline.ts`) resolves the board from the path, skips the verifier chain and `keepInsideCan`, keeps the raw body for the handler, and still applies rate limits. Nothing else may use it; a test walks the contract and fails if another operation does.
- Depends on 287, the last ticket before it to change `packages/server/src/http/pipeline.ts`.
- `inbound/verify.ts` computes the expected signature with `packages/server/src/jobs/sign.ts` (304, 312-315), so outbound and inbound never disagree on a scheme.

No longer waits for 287 (orchestrator, 2026-11-24): that dependency only ordered edits to a shared file; whichever ticket lands second rebases.
