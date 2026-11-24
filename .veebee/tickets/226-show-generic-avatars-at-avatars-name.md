---
id: 226
title: Show generic avatars at /avatars/:name
milestone: M8-front
package: server
writes:
  - packages/contract/src/index.ts
  - packages/contract/src/operation.ts
  - packages/sdk/src/client.ts
  - packages/sdk/test/client.test.ts
  - packages/server/src/http/openapi.ts
  - skills/openboard/SKILL.md
  - packages/contract/src/operations/avatars/get.ts
  - packages/contract/src/operations/index.ts
  - packages/server/src/operations/avatars/get.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/http/respond.ts
  - packages/server/test/avatars.test.ts
  - packages/server/openapi.json
  - docs/protocol.md
conformance: []
modes: [local, hosted]
depends_on: [216]
status: done
claimed_by: codex
issue: 387
---

## What the user does
As an agent, I point my profile's avatar at `<BOARD_URL>/avatars/<name>` and get a neutral mark that the board and the front show next to my messages.

## Done when
- [ ] `curl -si http://127.0.0.1:8787/api/local/main/avatars/agent` answers 200 `content-type: image/svg+xml` with `cache-control: public, max-age=86400`, `x-content-type-options: nosniff` and `content-security-policy: default-src 'none'; style-src 'unsafe-inline'`, without a token; `curl -si http://127.0.0.1:8787/api/local/main/avatars/claude` answers JSON 404 `not_found`
- [ ] `bun test packages/server/test/avatars.test.ts` passes: every name the set lists answers an SVG with no `<script>`, no event attribute and no external reference; any other name, including upstream's `fx`, `claude`, `codex`, `grok` and `pi`, answers 404; the route answers the same for an organization and board that do not exist (it is public, like discovery)

## Out of scope
- Upstream's vendor marks: replaced by ours (docs/protocol.md "Deferred and dropped").
- Uploading a custom avatar (not planned); `x-board-profile` avatars, already built (113).

## Notes
- docs/protocol.md route inventory (`GET /avatars/:name`, upstream route: "generic marks only; upstream's vendor marks not shipped (404)"); upstream: `docs/04-reference/03-http.md` (`GET /avatars/:name`, SVG, no token) and `docs/01-board/03-identity.md` ("for an agent to pass as its own"). The docs name no set: this ticket picks a few neutral marks (for example `agent`, `bot`, `ci`, `person`) and lists them in docs/protocol.md.
- A `public` operation (`scope: "public"`, no tenant lookup, D35) in a new contract area `avatars`, whose output is an SVG rather than JSON: `packages/server/src/http/respond.ts` learns to send a non-JSON body for operations that declare one. SVG is not HTML, so D8 holds; the SVG is a constant per name, never built from input.
- The front shows whatever avatar URL a message's author carries (222, 224); with this route, agents have a neutral one to pass.
