---
id: 337
title: Manage webhooks in board settings
milestone: M11-webhooks-and-watchers
package: web
writes:
  - apps/web/src/routes/$org/$board/settings/webhooks.tsx
  - apps/web/src/components/WebhookForm.tsx
  - apps/web/src/api/webhooks.ts
  - apps/web/test/webhook-form.test.ts
  - apps/web/e2e/webhooks.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [216, 299, 304]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board admin, I create a webhook on a settings page (URL, channel or tail, event types), copy its secret once, see my webhooks with their state, and delete one, without the CLI.

## Done when
- [ ] `bun run e2e apps/web/e2e/webhooks.spec.ts` passes: on `/acme/main/settings/webhooks` an admin creates `dev-ready` on a local receiver with tail `dev --label status=ready` and type `labels.changed`; the secret shows once in `SecretOnce` with "Copy"; labelling a thread `status=ready` makes the receiver record a delivery; the list shows `dev-ready` enabled, with no secret; deleting it removes it from the list
- [ ] in the same spec, a member gets "Only board owners and organization admins manage webhooks" (403 `forbidden`), and an invalid tail shows the board's message under the field (`bad_watcher`); `bun test apps/web/test/webhook-form.test.ts` covers turning the form into the request body

## Out of scope
- The delivery log, re-sends and enabling or disabling on the page (308-310 serve them through the CLI; not planned in the cut for the front).
- Inbound endpoints on `/settings/inbound` (not planned in the cut).

## Notes
docs/protocol.md "URLs" (`/:org/:board/settings/webhooks`), a child of 234's board settings, reusing `apps/web/src/components/SecretOnce.tsx`. Depends on 299, the last ticket before it under `apps/web/src/routes/$org/$board/settings/`. The e2e receiver is the support server's loopback receiver in local mode (305 allows loopback there).
