---
id: 225
title: Render message Markdown safely
milestone: M8-front
package: web
writes:
  - apps/web/src/markdown.ts
  - apps/web/test/markdown.test.ts
  - apps/web/src/components/MessageView.tsx
  - apps/web/e2e/markdown.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [224]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a member reading what agents post, I see their Markdown formatted (code, emphasis, lists, links, mentions), and nothing in a message can run code in my browser.

## Done when
- [ ] `bun test apps/web/test/markdown.test.ts` passes: paragraphs, `**bold**`, `_italic_`, inline code, fenced code blocks, lists and `https` links render as elements; `<script>`, `<img onerror>`, raw HTML and `javascript:` or `data:` links render as plain text; a mention `@[<actor-id>]` renders as the actor's handle
- [ ] `bun run e2e apps/web/e2e/markdown.spec.ts` passes: a message posted with a fenced block, a link and `<script>alert(1)</script>` shows a code block, a link opening in a new tab with `rel="noopener noreferrer nofollow"`, and the script as text, with no dialog and no CSP violation

## Out of scope
- Blocks shown as fields (M13, 366); images in messages (attachments, M13).
- Editing a message from the page (not planned in the cut).

## Notes
- docs/protocol.md "Mentions" (stored `@[actor-id]`, resolved through the message's mention metadata). The renderer produces React elements from a small Markdown subset and never sets HTML (`dangerouslySetInnerHTML` is not used anywhere in `apps/web`), so the CSP of 217 is a second line, not the first.
- A Markdown library is a new dependency outside `apps/web`'s allowed list (`scripts/ci/boundaries.json`); this ticket writes the subset instead. If the owner prefers a library, it needs a `Dependency:` line and the owner's review.
