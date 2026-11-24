---
id: 312
title: Sign deliveries with the github preset
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/core/src/webhooks/signing.ts
  - packages/core/test/webhooks/signing.test.ts
  - packages/server/src/jobs/sign.ts
  - packages/server/test/webhooks/sign-github.test.ts
conformance: []
modes: [local, hosted]
depends_on: [304]
status: draft
claimed_by: null
issue: 497
---

## What the user does
As a board admin whose receiver already verifies GitHub-style webhooks, I set `"signing": { "preset": "github", "secret": … }` and the receiver accepts the board's deliveries unchanged.

## Done when
- [ ] `bun test packages/server/test/webhooks/sign-github.test.ts` passes: with the secret `It's a Secret to Everybody` and the body `Hello, World!`, `jobs/sign.ts` produces `x-hub-signature-256: sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17` (GitHub's published example) and `x-github-delivery: <dl_ ID>`; a webhook created with the github preset and a receiver-chosen secret delivers with those headers over its real body, and the create answer holds no `secret` since the receiver chose it
- [ ] `bun test packages/core/test/webhooks/signing.test.ts` passes: the github preset without a `secret` answers 400 `invalid_signing`, as does an unknown preset

## Out of scope
- The other presets (313-316).

## Notes
docs/protocol.md "Signing (receiver-dictated)" (github: `x-hub-signature-256: sha256=<hex HMAC of body>`, `x-github-delivery`), D16. A preset expands to the scheme object of the same section, so `jobs/sign.ts` computes one thing: the scheme. A receiver-chosen secret arrives in the create body, from `--secret-file` in the CLI (304), and is stored encrypted like a generated one. Constant-time comparison is the receiver's job; ours is to sign the exact bytes sent.
