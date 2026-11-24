---
id: 234
title: Create a connection from board settings
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/$org/$board/settings/connections.tsx
  - apps/web/src/components/SecretOnce.tsx
  - apps/web/e2e/connections.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [216]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board admin, I create a connection for an agent, copy its secret once together with the lines that connect it, and see my connections listed afterwards without their secrets.

## Done when
- [ ] `bun run e2e apps/web/e2e/connections.spec.ts` passes: on `/acme/main/settings/connections`, creating `fixer` with access `dev/=read,post` shows the secret once with "Copy" and the `BOARD_URL`, `ob connect <BOARD_URL> --as fixer` and `env` lines; `ob connect` run with that secret on stdin then posts to `dev`; after closing the dialog, the list shows `fixer` with its hint `…<last four>` and never the secret again
- [ ] in the same spec, a member who is not an admin of the board sees "Only board owners and organization admins manage connections" (403 `forbidden`), and the 101st connection shows the quota's message (196)

## Out of scope
- Revoking (235); rotating a secret and revoking one agent (the routes exist, 129, 130; their controls are not planned in the cut).
- Grants (M10, 299).

## Notes
- docs/auth.md "Connections" and "One-line UX per surface", docs/protocol.md "Board extensions" (`POST, GET {BOARD_URL}/x/connections`; the list never holds a secret, hash or token; `secretHint` is `…` and the last four characters, D51). The secret leaves the server once, in the create answer; the page keeps it only in the dialog's state, never in the URL, storage or the query cache (`SecretOnce.tsx`, reused by later settings pages that show a secret once).
- A cookie-authenticated board write: the SDK sends `x-ob-csrf` (216).
