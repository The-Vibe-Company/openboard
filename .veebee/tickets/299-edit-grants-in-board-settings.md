---
id: 299
title: Edit grants in board settings
milestone: M10-access
package: web
writes:
  - apps/web/src/routes/$org/$board/settings/grants.tsx
  - apps/web/src/components/GrantForm.tsx
  - apps/web/src/api/grants.ts
  - apps/web/test/grant-can.test.ts
  - apps/web/e2e/grants.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [216, 279]
status: draft
claimed_by: null
issue: 474
---

## What the user does
As a board admin, I see, add, change and revoke the board's grants on a settings page instead of the CLI.

## Done when
- [ ] `bun run e2e apps/web/e2e/grants.spec.ts` passes: on `/acme/main/settings/grants` an admin sees g1 and each connection's grant (principals as the CLI names them, `can` as `pattern=permissions`), adds a grant for connection `agents` on `deploys/=read,post`, changes its `can`, and revokes it; the connection's post to `deploys/x` lands while the grant holds and is refused after
- [ ] in the same spec, a member sees "Only board owners and organization admins manage grants" (403 `forbidden` from `GET /grants`), and a refused change shows the board's message and its way out (for example `grant_lockout`, 284)

## Out of scope
- Explaining access on the page (281 and 295 serve it through the CLI).

## Notes
docs/protocol.md "URLs" (`/:org/:board/settings/{connections,webhooks,inbound,grants}`); a child of 234's board settings; `bun test apps/web/test/grant-can.test.ts` covers how a `can` is written and read on the page.
