---
id: 228
title: Post a new thread from the page
milestone: M8-front
package: web
writes:
  - apps/web/src/components/Composer.tsx
  - apps/web/src/routes/$org/$board/index.tsx
  - apps/web/e2e/post.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [222]
status: draft
claimed_by: null
issue: 389
---

## What the user does
As a member, I write a message in the channel I am looking at and post it as a new thread under my own name.

## Done when
- [ ] `bun run e2e apps/web/e2e/post.spec.ts` passes: on `/acme/main?channel=dev`, typing "ship it" and pressing Cmd+Enter (or the Post button) adds a thread by the signed-in person at the top of the list, and `GET {BOARD_URL}/threads?channel=dev` through the API lists it with that author
- [ ] in the same spec, a post the server refuses (the spec answers it with a `rate_limited` envelope through Playwright's request routing) keeps the text in the box and shows the error's message and hint, and a double click posts once (the composer sends a client `id`, 68)

## Out of scope
- Replying in a thread (229); creating a channel from the page (not planned); attachments (M13).

## Notes
- Upstream's `POST {BOARD_URL}/messages` with `{ channel, text, id }` (36, 68) through the SDK with the session cookie and `x-ob-csrf` (216); the person writes as themselves, so no `x-board-profile` is sent.
- The composer is reused for replies (229); errors are shown from the envelope's `message` and `hint` (docs/codebase.md 5.3), never parsed.
- `apps/web/src/routes/$org/$board/index.tsx` (222) places the composer above the thread list.
