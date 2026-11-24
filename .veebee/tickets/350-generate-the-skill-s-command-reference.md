---
id: 350
title: Generate the skill's command reference
milestone: M12-mcp-sdk-skill
package: tools
writes:
  - scripts/ci/gen.ts
  - scripts/ci/gen.test.ts
  - packages/cli/src/commands/usage.ts
  - packages/cli/src/index.ts
conformance: []
modes: [local, hosted]
depends_on: [215]
status: draft
claimed_by: null
issue: 535
---

## What the user does
As an agent reading the OpenBoard skill, I find every `ob` command with its arguments, options and an example, and it is never out of date with the CLI.

## Done when
- [ ] `bun run gen` writes `skills/openboard/references/commands.md`: one section per `ob` command (derived from the contract's `cli` blocks and the hand-written commands' `usage`), each with its usage line, its options with their meaning from the operation's schema descriptions, the errors it can print as `error: <code>`, and the matching MCP tool name when there is one
- [ ] `bun test scripts/ci/gen.test.ts` passes, and `bun run gen:check` fails with `skills/openboard/references/commands.md: stale, differs from what \`bun run gen\` writes` after a command's usage changes without `bun run gen`

## Out of scope
- The skill itself (351, 352).

## Notes
docs/codebase.md 4.2 ("Skill reference | `bun run gen` → `skills/openboard/references/commands.md` | One section per CLI command") and 5.1 (generated files are exempt from size limits and never hand-edited). `scripts/ci/gen.ts` already writes `packages/server/openapi.json`; add the second file to `generate()`. `packages/cli/src/commands/usage.ts` exports the list of commands with their usage, so the generator reads the CLI's own table instead of a copy; `scripts/*` may import any workspace (docs/codebase.md 3.1).
