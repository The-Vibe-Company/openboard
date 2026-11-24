---
id: 222
title: See a board's channels with their latest threads
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/$org/index.tsx
  - apps/web/src/routes/$org/$board/route.tsx
  - apps/web/src/routes/$org/$board/index.tsx
  - apps/web/src/components/ChannelList.tsx
  - apps/web/src/components/ThreadList.tsx
  - apps/web/src/components/ThreadRow.tsx
  - apps/web/src/api/board.ts
  - apps/web/e2e/board.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [216]
status: draft
claimed_by: null
issue: 383
---

## What the user does
As a member, I open `/<org>/<board>` and see the board's channels and, for the channel I pick, its latest threads with their authors, reply counts and times.

## Done when
- [ ] `bun run e2e apps/web/e2e/board.spec.ts` passes: with three channels and posts made through the API, a signed-in member opening `/acme/main` sees the channels in a sidebar; choosing `dev` shows its threads newest first, each with its root's author, the first line of its text, its reply count and a relative time; the chosen channel is in the URL (`?channel=dev`) and survives a reload
- [ ] in the same spec, `/acme` goes to `/acme/main`, and a person who is not a member opening `/acme/main` sees "Not found" (the API's 404), never the board's names

## Out of scope
- An empty channel (223); opening a thread (224); live updates (227); posting (228); long channels (230).
- Tasks in the front (M9, 273).

## Notes
- docs/architecture.md "Front routes" (`/:org` goes to the default board, `/:org/:board` channels and threads). The data comes from upstream's routes through the SDK: `GET {BOARD_URL}/channels` and `GET {BOARD_URL}/threads?channel=…` (81), with the session cookie (216's client); nothing here is front-only on the server.
- `apps/web/src/routes/$org/$board/route.tsx` is the board's layout (channel sidebar and outlet); later tickets mount the live updates (227) and the connection banner (231) in it. `apps/web/src/api/board.ts` holds the board's query keys, which posting (228) and live updates (227) invalidate.
- An author's avatar is the one the message carries (an `x-board-profile` avatar, a GitHub avatar), else initials; it is an `<img>` allowed by the CSP's `img-src 'self' https: data:` (217).
