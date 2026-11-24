---
id: 366
title: Show a block as fields in the front
milestone: M13-data-files-schedules
package: web
writes:
  - apps/web/src/components/BlockView.tsx
  - apps/web/src/components/MessageView.tsx
  - apps/web/src/api/schemas.ts
  - apps/web/test/block-view.test.ts
  - apps/web/e2e/blocks.spec.ts
  - apps/web/src/markdown.ts
  - apps/web/src/components/BlockView.css
  - apps/web/src/routes/$org/$board/t/$id.tsx
  - apps/web/package.json
  - apps/web/tsconfig.json
  - bun.lock
  - packages/contract/src/entities/schemas/fences.ts
  - packages/contract/src/index.ts
  - packages/core/src/schemas/blocks.ts
  - docs/design.md
  - skills/openboard/SKILL.md
conformance: []
modes: [local, hosted]
depends_on: [224, 225, 364]
status: done
claimed_by: codex
issue: 561
---

## What the user does
As a person reading a thread, a message that carries a block shows its data as labelled fields under the prose, not as raw JSON.

## Done when
- [ ] `bun run e2e apps/web/e2e/blocks.spec.ts` passes on both modes: a message posted with a `json#git-commit@1` block shows the prose, then a field list titled `git-commit@1` whose rows are the schema's property titles (or names) and values in the schema's property order, with a control that shows the raw JSON; a fence that names a schema but sits inside a longer fence shows as code, not fields
- [ ] `bun test apps/web/test/block-view.test.ts` passes: nested objects show as indented rows, arrays as lists, `format: "uri"` values as links with `rel="noopener noreferrer"`, and a property the data holds but the schema does not list comes last

## Out of scope
- Composing blocks from the page; registering schemas from the page.
- Markdown rendering of the prose (225), which this ticket leaves as it is.

## Notes
- The message view already carries `blocks` (`{ schema, version, data }`, 364), so no server change. `apps/web/src/api/schemas.ts` reads `GET /schemas/:id` through the SDK wrapper of `apps/web/src/api/client.ts` (216), cached per ID with TanStack Query since a version never changes.
- The fence's place in the text is where the block shows: `apps/web/src/markdown.ts` (225) renders the prose; `MessageView.tsx` replaces each block's fence with `BlockView`. Values render as text nodes only (225's safety rules: no HTML from data).
- docs/decisions.md D6 (monochrome, minimal).
- Depends on 225, the last ticket before it to change `apps/web/src/components/MessageView.tsx`.
