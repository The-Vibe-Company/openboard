---
id: 316
title: Send static headers with no signature
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/core/src/webhooks/signing.ts
  - packages/core/test/webhooks/signing.test.ts
  - packages/server/src/jobs/sign.ts
  - packages/server/test/webhooks/static-headers.test.ts
conformance: []
modes: [local, hosted]
depends_on: [315]
status: draft
claimed_by: null
issue: 501
---

## What the user does
As a board admin calling an API that wants a bearer token instead of a signature (a CI dispatch endpoint), I set `"signing": { "preset": "none" }` and `"headers": { "authorization": "Bearer …" }`, and the token is sent but never shown again.

## Done when
- [ ] `bun test packages/server/test/webhooks/static-headers.test.ts` passes: deliveries of a `none` webhook carry its static headers and no signature headers; `GET /x/webhooks/:id` shows `"headers": { "authorization": "…" }`; a static header also works beside a signing preset; a header the board sets (`content-type`, `content-length`, `host`), one of the scheme's own headers, a name that is not a token, a value with a line break, or more than 20 headers answer 400 `invalid_request`
- [ ] in the same file, the stored row's `headers` column holds no header value in clear (D29), and a log line of a delivery names no header value

## Out of scope
- Encrypting with a generated local key and the hosted key requirement (323).

## Notes
docs/protocol.md "Signing" (`none`: "no signature; static `headers` (for example a bearer)") and "Worked example: a generic HTTP endpoint"; D29 (receiver headers are recoverable secrets). 304 already stores and sends static headers through `webhooks/secret-box.ts` and `webhooks/request.ts`; this ticket lifts the refusal in `core/webhooks/signing.ts` and adds the `none` algorithm to `jobs/sign.ts`.
