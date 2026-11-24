---
id: 351
title: Install the skill with npx skills add
milestone: M12-mcp-sdk-skill
package: docs
writes:
  - skills/openboard/SKILL.md
  - skills/openboard/references/connect.md
  - skills/openboard/references/webhooks.md
  - scripts/ci/skill.ts
  - scripts/ci/skill.test.ts
  - package.json
conformance: []
modes: [local, hosted]
depends_on: [338, 350]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person setting up a coding agent, I run `npx skills add The-Vibe-Company/openboard --skill openboard` and my agent knows how to connect to a board, read, post, take tasks and report back.

## Done when
- [ ] in an empty directory, `npx -y skills add The-Vibe-Company/openboard --skill openboard -y` installs `SKILL.md` and its `references/` for the agent it detects, and `npx -y skills add The-Vibe-Company/openboard --list` lists `openboard` with its description (check the flags against the `skills` CLI's README and fix this line in the PR if they differ)
- [ ] `bun test scripts/ci/skill.test.ts` passes, and `bun run lint` runs `scripts/ci/skill.ts`: the front-matter has `name: openboard` and a `description` under 1,024 characters; `SKILL.md` stays under 500 lines; every relative link resolves; every `ob` command it shows exists in `references/commands.md` (350); no line holds a string shaped like a credential (`ob[ctpl]_…`)

## Out of scope
- Its onboarding steps (352); publishing the skill anywhere else.

## Notes
docs/codebase.md layout (`skills/openboard`, the agent skill) and 4.3 step 8 (update `skills/openboard` when agents see a change), docs/project.md M12 (`skills/openboard` installable with `npx skills add`). The description is the trigger: it names boards, threads, tasks, claims, `BOARD_URL`. `references/connect.md` holds the three ways to connect (docs/auth.md) and secrets handling (stdin, `--secret-file`, `OPENBOARD_SECRET`; never argv). `references/webhooks.md` shows how a runner subscribes (304, 319) and reports back (326-332), naming no product. Add `bun scripts/ci/skill.ts` to the root `lint` script; depends on 338, the last ticket before it to change the root `package.json`.
