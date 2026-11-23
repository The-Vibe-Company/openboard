# OpenBoard: rules for coding agents

OpenBoard is a self-hosted message board and task queue for people and agents, wire-compatible with Vercel Board's HTTP protocol. One binary, two modes: local (SQLite, one process, `ob serve`) and hosted (Postgres, two or more stateless instances, multi-tenant: organizations -> boards -> everything). Clients: `ob` CLI, SDK, MCP, web UI, agent skill.

## Where truth lives
| Topic | Authority |
|---|---|
| Layout, dependency rules, conventions, tests, build | `docs/codebase.md` |
| Milestones, tickets, PRs, labels, dogfooding | `docs/project.md` |
| System design | `docs/architecture.md` |
| Storage, events, tables | `docs/data-model.md` |
| Identity, tenancy, connections, grants | `docs/auth.md` |
| Wire protocol, compatibility | `docs/protocol.md` |
| Recorded choices | `docs/decisions.md` |
| Your ticket | `.veebee/tickets/NN-slug.md` |

## Layout
| Path | Holds |
|---|---|
| `packages/contract` | every operation, schema, event and error code, defined once |
| `packages/core` | pure rules: no I/O, no clock, no randomness |
| `packages/ports` | interfaces for storage, broadcaster, jobs, blobs, SaaS seams; shared driver test kit |
| `packages/driver-sql` | the shared SQL: scoped views, statement registry, one migration source; drivers only |
| `packages/driver-sqlite`, `packages/driver-postgres` | one driver per mode: dialect, fan-out, jobs, blobs |
| `packages/server` | HTTP pipeline, scoping, auth, SSE, jobs, webhooks, MCP; sees ports only |
| `apps/openboard` | composition root: config, driver choice, the `openboard`/`ob` executable |
| `packages/sdk`, `packages/cli` | API-only clients (`@the-vibe-company/openboard`, `ob`) |
| `apps/web` | React SPA, embedded in the binary |
| `tools/conformance`, `tools/bench` | upstream's conformance kit as oracle; benchmark and budgets |
| `skills/openboard` | the agent skill |
| `examples/` | integrations and recipes; SDK consumers only |

## Pick a ticket
1. Take a `status: ready` ticket whose `depends_on` are done and whose `writes` overlap no claimed ticket. From phase B in `docs/project.md`, claim it with `ob tasks claim --next --channel openboard/tickets` and renew the lease while you work.
2. Set `status: claimed` and `claimed_by`, create branch `t/NN-slug`. One branch, one agent: never push to a branch you did not create.
3. Build only what the ticket asks. Touch only its `writes`. If a rule blocks it or it cannot fit 600 changed lines per workspace, stop and say so on the issue.

## Non-negotiables
1. **Nothing integration-specific in core.** No product we integrate with (Armada, Slack, Linear, any CI vendor) appears in `packages/` or `apps/`. Integrations live in `examples/` and use the SDK, CLI, MCP or webhooks. GitHub sign-in lives only in `packages/server/src/auth/providers/github/`.
2. **Respect the import graph** in `docs/codebase.md` section 3. Never edit `scripts/ci/boundaries.json` to make your change pass; ask.
3. **One contract.** Add or change an operation in `packages/contract` and let REST, OpenAPI, SDK, CLI and MCP follow (`docs/codebase.md` section 4). No hand-written route, SDK method or tool that bypasses it.
4. **Upstream compatibility.** Upstream paths, codes, headers and event names are kept verbatim. Never weaken, skip, patch or pin around a conformance check. Never remove an entry from `tools/conformance/score.json`. Raising the `@vercel/board` pin is the owner's call.
5. **No dependency without justification.** A new package needs a `Dependency:` line in the PR (size, why Bun or the standard library cannot do it, alternatives) and owner review of `boundaries.json`.
6. **Size limits.** Source file 400 lines, test file 600, function 80, 600 changed lines per workspace per PR. Split; never excuse.
7. **Secrets.** Never print, log, commit or pass a secret as an argument. Values arrive on stdin, from a file, or from `OPENBOARD_*`/`*_FILE` env (`ob connect <url> --as <name>` reads stdin, `--secret-file` or `OPENBOARD_SECRET`). Fixtures hold no string that looks like a real token.
8. **No global state, no single-process state.** No module-level mutable state. Time, IDs, randomness, fetch and timers come from `deps`. Anything another request or instance may need (wake-ups, due work, leases, counters) goes through a port (`Broadcaster`, `Jobs`, `Store`), never memory. Code that only works in one process is a bug even if SQLite tests pass.
9. **No compatibility layers** for OpenBoard-only surfaces: replace, delete the old one, update every caller in the same PR.
10. **Fix the cause.** Name the root cause with evidence before changing code; fix its siblings or list them.
11. **Never state as verified what you did not run.**
12. **English** in code, output, comments and docs.
13. **No SQL outside a driver.** SQL lives only in `packages/driver-*`: written once in `driver-sql` (views, statements, one migration source), with `bun:sqlite` only in `driver-sqlite` and Bun's `SQL` only in `driver-postgres`. Only the two drivers import `driver-sql`; only composition roots import a driver. Migrations are expand-only during a deploy.
14. **Every operation is scoped once.** Each operation declares `scope` and marks tenant IDs with `Ref`. The organization and board come from the path (`/api/<org>/<board>`); the pipeline checks them against the credential and mints the scope before the handler. Handlers use `ctx.board`/`ctx.org` only, never an unscoped store and never an `orgId` from input. Another organization's resource is a 404.
15. **Never weaken tenant isolation.** Never remove, skip, relax or add exceptions to the isolation suites (adding seeds for a new `Ref` kind is expected) (`packages/server/test/isolation/`, `packages/ports/testkit/isolation.test-suite.ts`) or the statement scope check in `driver-sql`. A failing isolation case is a security bug: stop and report it.

## Errors, logs, config
- Expected failures throw `BoardError` with a catalogued `code`, optional `reason`, and at most two `next` ways out. Anything else is a bug and a 500.
- Log through `ctx.log` only. Never log bodies, message text, tokens or secrets.
- Env is read only in `apps/openboard/src/config.ts` and `packages/cli/src/config.ts`.

## Tests
- One test per behaviour, at the cheapest layer: core unit, driver test kit, HTTP in-process through `app.fetch`. No network beyond the test database, no sleep, no wall clock.
- HTTP and isolation tests run unchanged on SQLite and on two Postgres instances. If you touch ports, drivers, `server/src/http`, `live` or `jobs`, run `bun run verify:pg` before pushing.
- A test over one second is rewritten. A flaky test is deleted the day it is seen. A bug fix carries a test that fails without it.
- No auth bypass in tests.

## Commands
- `bun install`
- `bun run verify`: lint, boundaries, sizes, typecheck, `gen:check`, tests on SQLite. Run before every push. `bun run verify:pg`: the same suites on Postgres with two instances (needs Docker).
- `bun run conformance [--driver postgres --instances 2]`: upstream kit; `--update` records new passes.
- `bun run bench --quick`: counters and quick budgets.
- `bun run gen`: regenerate `openapi.json` and the skill's command reference. Never hand-edit generated files.
- `bun run format`, `bun run dev` (server on 8787, Vite on 5173), `bun run ob -- <args>`, `bun run e2e`, `bun run build`.

## Definition of done
- Every acceptance criterion checked by using the product; transcript or screenshot in the PR.
- `bun run verify`, `bun run conformance` and `bun run bench --quick` green locally; `Verify` green on the PR.
- Conformance score not lowered in either mode; raised and recorded if the ticket targets checks; from M5, both modes pass the same checks.
- Docs and `skills/openboard` updated if people or agents see the change.
- Ticket file set to `status: done` in the same PR.

## Pull requests
- Title: `feat(server): reply in a thread`. Body: the template's Users, Protocol, Conformance, Performance, Tests, Dependency lines, plus `Ticket:` and `Closes #N`.
- Enqueue with `gh pr merge <n> --squash` once `Verify` is green and reviewed. Never `--admin`.
- Adding a CI job, a required check or a gate, or raising a budget, is the owner's decision.

## Decisions
- A choice that binds later tickets goes in `docs/decisions.md` in the same PR.
- A question only the owner can answer: stop, label `needs-decision`, ask it in one sentence on the issue. Do not build around it.
