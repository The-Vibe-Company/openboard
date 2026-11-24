---
id: 296
title: Post from GitHub Actions with no secret
milestone: M10-access
package: server
writes:
  - packages/server/src/auth/oidc.ts
  - packages/server/src/auth/chain.ts
  - packages/server/src/app.ts
  - AGENTS.md
  - docs/auth.md
  - docs/protocol.md
  - packages/contract/src/entities/actors.ts
  - packages/ports/src/grants.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/server/src/operations/actors.ts
  - packages/server/src/operations/grants/create.ts
  - packages/server/src/operations/grants/revoke.ts
  - packages/server/src/operations/grants/update.ts
  - packages/server/openapi.json
  - skills/openboard/SKILL.md
  - packages/core/src/access/workloads.ts
  - packages/core/test/access/workloads.test.ts
  - packages/core/src/index.ts
  - packages/server/src/auth/providers/index.ts
  - packages/server/src/auth/providers/github/oidc.ts
  - packages/server/src/auth/author.ts
  - packages/server/src/deps.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/test/auth/github-oidc.test.ts
conformance: []
modes: [local, hosted]
depends_on: [276, 200, 210]
status: done
claimed_by: codex
issue: 471
---

## What the user does
As a repository's CI, my workflow posts to the board with its GitHub OIDC token and a grant naming the repository, with no secret stored anywhere.

## Done when
- [ ] `ob grants create --github acme/web --workflow ci.yml --git-branch main --can 'ci/=post'` makes the grant; `bun test packages/server/test/auth/github-oidc.test.ts` passes with a test issuer whose keys the injected `fetch` serves: a token for `acme/web`'s `ci.yml` on `refs/heads/main` with `aud` this `BOARD_URL` posts to `ci/nightly` as `github:repo:<repository id>`, while another branch or workflow answers 403 and an `aud` of another board 401
- [ ] a pull request's run (`refs/pull/7/merge`) matches no `--git-branch main` grant; an expired token or one signed by an unknown key answers 401 `unauthorized`; keys are fetched over https only, with no redirect and no private host

## Out of scope
- Other issuers (297).

## Notes
- docs/auth.md "The verifier chain" 5 and "CI: GitHub Actions and other OIDC issuers"; D11; upstream `src/server/tokens.ts` and `githubActionsToken` (`src/client/node.ts`). Issuer `https://token.actions.githubusercontent.com`; mapping `repository`, `workflow_ref`, `ref` and `event_name` in the provider and matching the resulting principal in core; signatures through WebCrypto, no dependency.
- Keys are cached per app (an object `createApp` makes, never module state, AGENTS.md non-negotiable 8); a miss refetches. Say in the PR whether a grant by repository name also pins the `repository_id` it first matched. Depends on 200 (`chain.ts`) and 210 (`app.ts`), the last tickets before it to change those files.
