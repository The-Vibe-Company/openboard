---
id: 216
title: Serve the front from the binary outside /api
milestone: M8-front
package: web
writes:
  - apps/web/package.json
  - apps/web/tsconfig.json
  - apps/web/vite.config.ts
  - apps/web/index.html
  - apps/web/src/main.tsx
  - apps/web/src/styles.css
  - apps/web/src/routes/__root.tsx
  - apps/web/src/routes/index.tsx
  - apps/web/src/api/client.ts
  - apps/web/test/client.test.ts
  - apps/web/playwright.config.ts
  - apps/web/e2e/support/serve.ts
  - apps/web/e2e/support/sign-in.ts
  - apps/web/e2e/shell.spec.ts
  - packages/sdk/src/client.ts
  - packages/sdk/test/client.test.ts
  - packages/server/src/web/assets.ts
  - packages/server/src/http/static.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/deps.ts
  - packages/server/test/static.test.ts
  - scripts/build/index.ts
  - scripts/build/build.test.ts
  - scripts/ci/boundaries.json
  - package.json
  - bun.lock
  - .gitignore
conformance: []
modes: [local, hosted]
depends_on: [187, 199]
status: draft
claimed_by: null
issue: 377
---

## What the user does
As a person opening my board's address in a browser, the OpenBoard page loads from the same binary that serves the API, fast and cached, while every `/api` path still answers JSON.

## Done when
- [ ] `bun run build`, then `./dist/ob-<target> serve`: `curl -si http://127.0.0.1:8787/acme/main` answers 200 `text/html` with `cache-control: no-cache`, a hashed file it references under `/assets/` answers with `cache-control: public, max-age=31536000, immutable` and, asked with `accept-encoding: br`, `content-encoding: br`; `curl -si http://127.0.0.1:8787/api/nope` still answers JSON 404 `not_found`, and `/mcp/x`, `/auth/x`, `/healthz` never answer the page
- [ ] `bun test packages/server/test/static.test.ts` passes against a fixture asset directory, and `bun run dev` serves the front on 5173 with `/api` and `/auth` proxied to the server on 8787
- [ ] `bun run e2e apps/web/e2e/shell.spec.ts` passes: Playwright opens `/` on a server started by `apps/web/e2e/support/serve.ts` and the page renders with no console error

## Out of scope
- Security headers on the front's answers (217); every page (218 onward).
- Running Playwright in CI on both modes (237): `Verify` never runs a browser (docs/codebase.md 6.7).

## Notes
- docs/architecture.md "What the server provides for the front" (assets, `index.html` for every path outside `/api`, `/mcp`, `/auth`, `/assets`, `/healthz`, `/readyz`), docs/codebase.md 7.1 steps 1 and 2 (`vite build` into `apps/web/dist/`, every file embedded with `bun build --compile`; `packages/server/src/web/assets.ts` serves `Bun.embeddedFiles` when compiled, or a directory named in `ServerConfig` otherwise), D6, D8, D21 (no server framework).
- Only tests and the e2e harness name a directory: `bun apps/openboard/src/main.ts serve` run from source has no front and says so in a plain-text answer, since `bun run dev` serves the front from Vite. So `apps/openboard/src/compose.ts` does not change.
- The SPA: React, TanStack Router (file routes, the generated route tree is exempt from size limits), TanStack Query, Vite, Geist, monochrome (D6; Vercel-like and minimal). `apps/web/src/api/client.ts` wraps the SDK with the browser's session (`credentials: "same-origin"`) and the CSRF value from `GET /api/x/session`; every page after this one uses it. The SDK today sends `x-ob-csrf` only on account and organization writes; a cookie-authenticated board write needs it too (docs/auth.md "Sessions and CSRF"), so `packages/sdk/src/client.ts` sends it on every non-GET when configured.
- Brotli and gzip copies are made at build time (`scripts/build/index.ts`), never per request.
- Playwright lands here so every later front ticket can check itself in a browser on a laptop: `apps/web/e2e/support/serve.ts` starts an app on SQLite with `OPENBOARD_SIGNUP=open` and a fake GitHub (as `packages/server/test/support/browser-session.ts` does: GitHub's token and user calls answered by the injected `fetch`, the authorize redirect routed back to the callback by Playwright), and `e2e/support/sign-in.ts` signs a named person in. The harness exports `serve({ signup?, dataDir?, port? })` returning `{ url, drain, stop }`, so later specs choose sign-up mode (220) or restart a server on the same data (231) without editing it. Its public URL is `http://localhost:<port>` so the `__Host-` cookies are accepted. That file is a composition root: it needs an entry in `scripts/ci/boundaries.json` (owner-reviewed), as do Vite, its React plugin, the TanStack router plugin and Playwright as `apps/web` dev dependencies. Each needs a `Dependency:` line in the PR (AGENTS.md non-negotiable 5).
- Depends on 199, the last ticket before it to change `packages/server/src/http/pipeline.ts`.
