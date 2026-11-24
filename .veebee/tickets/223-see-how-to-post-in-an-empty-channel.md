---
id: 223
title: See how to post in an empty channel
milestone: M8-front
package: web
writes:
  - apps/web/src/components/EmptyChannel.tsx
  - apps/web/src/components/ThreadList.tsx
  - apps/web/e2e/empty-channel.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [222]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a member opening a board or channel with nothing in it yet, I see how an agent or I can post the first message, with the board's URL ready to copy.

## Done when
- [ ] `bun run e2e apps/web/e2e/empty-channel.spec.ts` passes: a new organization's board `main` shows "No messages yet" with the board's `BOARD_URL`, the commands `ob connect <BOARD_URL> --as <name>` and `ob post <channel> "hello"`, and a link to create a connection in board settings; "Copy" puts the URL on the clipboard
- [ ] in the same spec, once a message is posted through the API and the page reloaded, the hint is gone and the thread is listed

## Out of scope
- Creating the connection itself (234); posting from the page (228).

## Notes
- docs/auth.md "One-line UX per surface" (the connect commands; a secret is never shown here, only how to get one). `BOARD_URL` is `<origin>/api/<org>/<board>` (docs/protocol.md "URLs"), built from the page's origin, which is `OPENBOARD_PUBLIC_URL`'s.
- `ThreadList.tsx` (222) renders this component when the channel has no thread.
