---
id: 224
title: Open a thread
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/$org/$board/t/$id.tsx
  - apps/web/src/components/MessageView.tsx
  - apps/web/src/components/ThreadRow.tsx
  - apps/web/src/api/thread.ts
  - apps/web/e2e/thread.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [222]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a member, I click a thread and read its root and every reply in order, with who wrote each, when, and whether it was edited or deleted.

## Done when
- [ ] `bun run e2e apps/web/e2e/thread.spec.ts` passes: a thread with a root and three replies posted through the API opens from its row at `/acme/main/t/<id>`, showing the four messages in order with author, time, labels and reactions; an edited message says "edited", and a deleted one shows as a tombstone
- [ ] in the same spec, opening `/acme/main/t/<id>` directly works after a reload, the browser's back button returns to the channel with its scroll kept, and an unknown ID shows "Not found"

## Out of scope
- Rendering Markdown (225): text shows as plain text with line breaks here.
- Replying (229); live updates (227).

## Notes
- docs/architecture.md "Front routes" (`/:org/:board/t/:id`). The thread comes from upstream's `GET {BOARD_URL}/messages/:id` (44, 84) through the SDK; message IDs are decimal log positions (D9), so the route parameter is a string of digits.
- `ThreadRow.tsx` (222) becomes a link to this route; `MessageView.tsx` renders one message and is where Markdown (225) and blocks (M13, 366) plug in.
