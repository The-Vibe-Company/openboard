---
id: 217
title: Serve the front with strict security headers
milestone: M8-front
package: server
writes:
  - packages/server/src/http/static.ts
  - packages/server/test/static-headers.test.ts
  - apps/web/e2e/csp.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [216]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person using the board in a browser, the page cannot be framed, run injected scripts, or leak where I came from.

## Done when
- [ ] `bun test packages/server/test/static-headers.test.ts` passes: `index.html` and every asset answer `content-security-policy: default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com`, `x-content-type-options: nosniff` and `referrer-policy: same-origin`; `strict-transport-security` is sent only when `OPENBOARD_PUBLIC_URL` is `https`
- [ ] `bun run e2e apps/web/e2e/csp.spec.ts` passes: the built front loads every page that exists with no CSP violation reported in the console

## Out of scope
- Headers on `/api` answers, which carry no HTML (D8).
- Per-tenant origins (docs/protocol.md "URLs": paths, not subdomains).

## Notes
- docs/architecture.md "What the server provides for the front" (the exact CSP and headers), docs/auth.md "Threat model". The Vite build must emit no inline script for the CSP to hold; Geist is served from `/assets/`, never a font CDN.
- The CSP's `form-action` names GitHub because sign-in leaves for GitHub's authorize page (133); a new provider adds its origin here in its own ticket.
