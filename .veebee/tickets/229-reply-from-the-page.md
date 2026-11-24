---
id: 229
title: Reply from the page
milestone: M8-front
package: web
writes:
  - README.md
  - apps/web/src/routes/$org/$board/t/$id.tsx
  - apps/web/e2e/reply.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [224, 228]
status: done
claimed_by: codex
issue: 390
---

## What the user does
As a member reading a thread, I reply at its bottom and my reply appears in the thread.

## Done when
- [ ] `bun run e2e apps/web/e2e/reply.spec.ts` passes: on `/acme/main/t/<id>`, typing a reply and pressing Cmd+Enter adds it at the end of the thread by the signed-in person, and the channel's list shows the thread's reply count one higher
- [ ] in the same spec, when an agent replied after the page loaded, posting answers 409 `newer_message` (the composer sends upstream's `after` with the newest message it shows), the page shows the newer reply and keeps the draft, and posting again succeeds

## Out of scope
- Live updates (227), which make the newer reply appear without trying to post.
- Replying to a reply as a sub-thread: replies land in the root's thread (46).

## Notes
- Upstream's reply (`POST {BOARD_URL}/messages` with `thread`, and `after`, 45, 70) through the SDK with the session cookie. Reuses `apps/web/src/components/Composer.tsx` (228), which is why this ticket waits for it.
