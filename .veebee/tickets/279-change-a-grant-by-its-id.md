---
id: 279
title: Change a grant by its ID
milestone: M10-access
package: server
writes:
  - docs/data-model.md
  - docs/protocol.md
  - packages/cli/src/commands/grants.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/src/commands/usage.ts
  - packages/cli/src/grant-principals.ts
  - packages/cli/test/grants.test.ts
  - packages/contract/src/entities/grants.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/audit.ts
  - packages/contract/src/operations/grants/update.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/access/grant-events.ts
  - packages/core/src/access/principals.ts
  - packages/core/src/index.ts
  - packages/core/test/access/principals.test.ts
  - packages/driver-sql/migrations/0014-connection-grant-origin.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/driver-sql/src/views/grants.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/server/openapi.json
  - packages/server/src/operations/audit.ts
  - packages/server/src/operations/grants/create.ts
  - packages/server/src/operations/grants/revoke.ts
  - packages/server/src/operations/grants/update.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/grants/update.test.ts
  - packages/server/test/isolation/cases.ts
  - skills/openboard/references/commands.md
  - tools/conformance/score.json
conformance: ["grants/makes another grant for the same principals, and changes one by its ID"]
modes: [local, hosted]
depends_on: [278]
status: done
claimed_by: codex-t279
issue: 454
---

## What the user does
As a board owner, I change who a grant names or what it lets in, `ob grants update g5 --add-connection <id> --can 'deploys/=read'`, without remaking it.

## Done when
- [x] `ob grants update g5 --add-connection <second id> --can 'deploys/=read'` prints `updated g5` with both connections and `deploys/=read`; the first connection's post to `deploys/web` is then `error: forbidden: …`; `--add-project prj_x --environment production` on a grant naming `prj_x` in `preview` joins the environments
- [x] removing a principal the grant does not name prints `error: not_in_grant: …`, removing its last one `error: grant_empty: …`, and `ob grants update g99 --can 'x=read'` `error: grant_not_found: …`
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `grants/makes another grant for the same principals, and changes one by its ID`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Who may change which grant (283).

## Notes
Upstream `PATCH /grants/:id { add?, remove?, can?, lockMeOut? }` (remove by who they are; adding a project it names joins the environments); `ob.grant.updated`; `PATCH` is already a contract `Method`.
