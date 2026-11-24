---
id: 305
title: Refuse a private or loopback webhook URL
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/server/src/webhooks/target.ts
  - packages/server/src/webhooks/send.ts
  - packages/server/test/webhooks/target.test.ts
  - packages/server/src/deps.ts
  - apps/openboard/src/config.ts
  - apps/openboard/src/compose.ts
  - apps/openboard/test/config.test.ts
  - docs/auth.md
  - docs/decisions.md
conformance: []
modes: [local, hosted]
depends_on: [282, 304]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the operator of a shared instance, no tenant can make the board call an address inside our network, at creation or at any later attempt, while a tenant's public HTTPS receiver works.

## Done when
- [ ] `bun test packages/server/test/webhooks/target.test.ts` passes in hosted mode: creating a webhook on `https://10.0.0.5/`, `https://169.254.169.254/`, `https://[::1]/`, `https://[::ffff:127.0.0.1]/`, `https://100.64.0.1/`, `https://x.internal/`, `https://x.railway.internal/`, the service's own public host, `http://` anything, a port other than 443, or a URL with credentials answers 400 `invalid_url` with the reason; `https://receiver.example/` whose fake DNS answers a public address is created and delivered to that address with TLS verified for the host name; a name that later resolves to `10.0.0.5` makes that attempt fail without connecting, and a `3xx` answer is not followed
- [ ] the same file: `OPENBOARD_WEBHOOK_ALLOWED_HOSTS=hooks.corp` lets a private address through for that host only, `OPENBOARD_WEBHOOK_ALLOWED_PORTS=8443` allows that port, no request field can loosen the guard; in local mode a loopback `http` target still works and a private (RFC 1918) one is refused; a response body over 8 KB is read only to 8 KB
- [ ] `openboard serve` with `OPENBOARD_WEBHOOK_ALLOWED_HOSTS=not a host` exits 2 naming the variable

## Out of scope
- Per-organization delivery caps (324); anything about redirects of the board's own API (D8).

## Notes
- docs/auth.md "SSRF on webhook URLs" (every rule above), D15, docs/codebase.md 4.5 ("SSRF guard on webhook targets, no tenant override"). The check runs at creation and before each attempt in `target.ts`, the function 304 wrote for this; host resolution comes from a new `deps.resolve` so tests fake DNS.
- Connect to the checked address, so no DNS rebinding window: docs/auth.md says it is unverified whether Bun's `fetch` can pin an address while verifying TLS for the host name. Measure it first; if it cannot, `webhooks/send.ts` uses `Bun.connect` with TLS and a minimal HTTP/1.1 client. Say which in the PR, with the measurement.
- **Proposal for the owner (record in docs/decisions.md and docs/auth.md):** in local mode (`ob serve`), loopback targets over `http` are allowed with no setting, so a receiver on the same machine (338) works out of the box; private and link-local addresses stay refused there too. Hosted mode allows nothing private unless `OPENBOARD_WEBHOOK_ALLOWED_HOSTS` names the host. Until the owner agrees, stop with `needs-decision`. Depends on 282, the last ticket before it to change docs/decisions.md.
