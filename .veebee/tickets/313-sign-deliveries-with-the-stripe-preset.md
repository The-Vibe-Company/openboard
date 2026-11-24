---
id: 313
title: Sign deliveries with the stripe preset
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/core/src/webhooks/signing.ts
  - packages/core/test/webhooks/signing.test.ts
  - packages/server/src/jobs/sign.ts
  - packages/server/test/webhooks/sign-stripe.test.ts
  - packages/cli/src/commands/webhooks/create.ts
  - packages/cli/test/webhooks.test.ts
  - skills/openboard/references/webhooks.md
  - docs/protocol.md
conformance: []
modes: [local, hosted]
depends_on: [312]
status: done
claimed_by: Codex
issue: 498
---

## What the user does
As a board admin whose receiver verifies Stripe-style signatures, I set `"preset": "stripe"` and the receiver's existing check accepts the deliveries.

## Done when
- [x] `bun test packages/server/test/webhooks/sign-stripe.test.ts` passes: a delivery carries `stripe-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, the value `printf '%s' "$t.$body" | openssl dgst -sha256 -hmac "$secret"` prints for the same `t`, body and secret; `t` is the attempt's time on the fake clock, so a retry carries a new `t` and a new signature over the same body

## Out of scope
- Stripe's multiple `v1` values during secret rotation (no rotation of signing secrets in the cut).

## Notes
docs/protocol.md "Signing" (stripe: `stripe-signature: t={ts},v1=<hex HMAC of "{ts}.{body}">`). Expressed as the scheme `{ algorithm: hmac-sha256, signatureHeader: "stripe-signature", signatureFormat: "t={ts},v1={sig}", encoding: hex, signedPayload: "{ts}.{body}", timestampFormat: unix }`, which 315 then opens to everyone.
