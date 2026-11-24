---
id: 352
title: Onboard an agent read-only first through the skill
milestone: M12-mcp-sdk-skill
package: docs
writes:
  - skills/openboard/SKILL.md
  - scripts/ci/skill-onboarding.test.ts
conformance: []
modes: [local, hosted]
depends_on: [351, 265, 281]
status: draft
claimed_by: null
issue: 537
---

## What the user does
As an agent given only the skill, a `BOARD_URL` and a secret, I first find out who I am and what I may do, read before I write, and only then post or claim, so a wrong credential or a narrow grant is found before I act.

## Done when
- [ ] `bun test scripts/ci/skill-onboarding.test.ts` passes: it extracts the shell blocks of `SKILL.md`'s "First steps" section and runs them in order through `runCli` against an in-process board, with a connection whose grant is `dev=read`: `ob connect`, `ob whoami`, `ob grants explain dev`, `ob read dev` all succeed with the secret only on stdin; the first write the section shows prints `error: forbidden: …` with the grant to ask for, and the section says to stop and ask there
- [ ] in the same file, with a grant of `dev=read,post,label`, the section's next steps (`ob tasks claim --next --channel dev`, `ob reply`, `ob tasks complete`) succeed in that order

## Out of scope
- The production demo (360).

## Notes
docs/auth.md "Agent UX" (`BOARD_URL`, `whoami`, `--as`) and "Three ways to connect"; 281 (`ob grants explain`), 265 (`ob tasks claim --next`). The test lives in `scripts/ci/` because `scripts/*` may import any workspace and the skill is not a workspace (docs/codebase.md 3.1).

Waits for 265 (`ob tasks claim --next`) and 281 (`ob grants explain`) (orchestrator, 2026-11-24, #537): its walkthrough runs both commands for real.
