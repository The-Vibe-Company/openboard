---
id: 296
title: Post from GitHub Actions with no secret
milestone: M10-access
package: server
writes:
  - packages/server/src/auth/oidc.ts
  - packages/server/src/auth/chain.ts
  - packages/server/src/app.ts
  - packages/core/src/access/github.ts
  - packages/core/test/access/github.test.ts
  - packages/server/test/auth/github-oidc.test.ts
conformance: []
modes: [local, hosted]
depends_on: [276, 200, 210]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a repository's CI, my workflow posts to the board with its GitHub OIDC token and a grant naming the repository, with no secret stored anywhere.

## Done when
- [ ] `ob grants create --github acme/web --workflow ci.yml --git-branch main --can 'ci/=post'` makes the grant; `bun test packages/server/test/auth/github-oidc.test.ts` passes with a test issuer whose keys the injected `fetch` serves: a token for `acme/web`'s `ci.yml` on `refs/heads/main` with `aud` this `BOARD_URL` posts to `ci/nightly` as `github:repo:<repository id>`, while another branch or workflow answers 403 and an `aud` of another board 401
- [ ] a pull request's run (`refs/pull/7/merge`) matches no `--git-branch main` grant; an expired token or one signed by an unknown key answers 401 `unauthorized`; keys are fetched over https only, with no redirect and no private host

## Out of scope
- Other issuers (297).

## Notes
- docs/auth.md "The verifier chain" 5 and "CI: GitHub Actions and other OIDC issuers"; D11; upstream `src/server/tokens.ts` and `githubActionsToken` (`src/client/node.ts`). Issuer `https://token.actions.githubusercontent.com`; matching on `repository`, `workflow_ref`, `ref` and `event_name` in `core/access/github.ts`; signatures through WebCrypto, no dependency.
- Keys are cached per app (an object `createApp` makes, never module state, AGENTS.md non-negotiable 8); a miss refetches. Say in the PR whether a grant by repository name also pins the `repository_id` it first matched. Depends on 200 (`chain.ts`) and 210 (`app.ts`), the last tickets before it to change those files.
