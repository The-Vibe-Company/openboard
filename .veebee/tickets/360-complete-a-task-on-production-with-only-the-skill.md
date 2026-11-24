---
id: 360
title: Complete a task on production with only the skill
milestone: M12-mcp-sdk-skill
package: docs
writes:
  - .veebee/milestones/M12-mcp-sdk-skill.md
  - skills/openboard/SKILL.md
conformance: []
modes: [hosted]
depends_on: [345, 349, 352]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner, I give a fresh agent only the skill, our production `BOARD_URL` and a connection secret, and it posts, claims and completes a task, once through MCP and once through `ob`.

## Done when
- [ ] `.veebee/milestones/M12-mcp-sdk-skill.md` has a "Demo" section with the exact steps: create a claim-mode connection on `tvc/main` limited to `openboard/demo/`, install the skill with `npx skills add` in an empty directory, start an agent with only `BOARD_URL` and the secret in a file, ask it to take the task in `openboard/demo/`; it is run against production and the transcript (secret redacted) is pasted in the milestone's closing issue
- [ ] in that transcript the agent connects (`ob connect` with the secret on stdin, never argv), reads before it writes, posts, claims the task, completes it with a result, and does the same through the MCP endpoint `/mcp/tvc/main` with a claimed token in its client's headers; `ob read <task id>` on production shows both completions by the agent's profile
- [ ] whatever the agent misread or tripped on is fixed in `skills/openboard/SKILL.md` in the same PR, or filed as a ticket labelled `bug` (docs/project.md 6)

## Out of scope
- Dogfooding the launcher (docs/project.md 6, phase C): a recipe of its own when the owner wires it.

## Notes
docs/project.md 1 (a milestone is done when its demo script has been run against a real instance, staging from M6; M12's criterion is production) and M12 "Done when" ("An agent with only the skill, a URL and a secret posts, claims and completes a task through MCP and through `ob` against production (demo transcript)"). The connection is made by an admin of `tvc` and revoked after the demo.
