# Codebase

How the OpenBoard repository is laid out, what may import what, and the conventions every change follows. This file is the authority on structure. The system design is in [architecture.md](architecture.md), storage in [data-model.md](data-model.md), identity and tenancy in [auth.md](auth.md), the wire protocol in [protocol.md](protocol.md), and recorded choices in [decisions.md](decisions.md). Where this file assumes something those documents own, it says "Assumption:" in one line; if they disagree, they win and this file is corrected.

Sources of borrowed rules are named inline: `armada:` means the sibling project `The-Vibe-Company/armada`, `upstream:` means `vercel/board` v0.54.0 (Apache-2.0), read as reference only.

## 1. Principles that shape the tree

1. **One codebase, two deployment modes, one binary.** *Local*: SQLite on a data directory, one process, zero setup (`ob serve`, or `openboard serve`). *Hosted*: Postgres, two or more stateless instances, rolling deploys without downtime. The mode is configuration, never a build flag or a fork in handler code.
2. **Ports and drivers.** Everything that differs between the modes (storage, live fan-out, background jobs, blobs) sits behind a port in `packages/ports`. Each mode is a driver package that implements every port. Handlers and rules only ever see ports. Only the composition root picks a driver.
3. **Tenancy from the first table.** Organization -> boards -> everything else. Every tenant row carries `org_id` and, below the organization, `board_id`. Local mode has one implicit organization and board. Scoping is applied once, by the router, and handlers cannot reach unscoped storage (section 4.4).
4. **One contract, many projections.** Every operation is defined once in `packages/contract` and reaches REST, OpenAPI, SDK, CLI, MCP and the tenant isolation suite from that definition (armada: `docs/architecture.md` target 7).
5. **Pure domain in the middle.** Rules (threads, revisions, labels, tasks, claims, needs, grants, memberships, schemas) are pure functions with no I/O, no clock and no randomness.
6. **Nothing lives only in one process.** Any state another request might need (a waiter to wake, a job to run, a lease to expire, a rate counter) goes through a port. A single instance is a cluster of one, not a special case. The two-instance test suite proves it (section 6.4).
7. **Clients are API-only.** The SDK, the CLI's client commands and the web app never import server, driver or core code (armada: `AGENTS.md` non-negotiable 3).
8. **Integrations are consumers.** Anything named after a product we integrate with (Armada, Slack, Linear, a CI vendor) lives in `examples/` and uses the published SDK, the CLI, MCP or webhooks. CI rejects those names in core source.
9. **Few packages, hard edges.** A package exists only when its boundary is enforced by CI and buys something: purity, a published artifact, isolation of a foreign dependency, or the port/driver split. Upstream's single package grew files of 1,300 to 4,000 lines (`server/backend-vercel.ts` 4,082, `cli/main.ts` 2,967, `conformance/index.ts` 2,553, `server/a2.ts` 1,444, `api/routes.ts` 1,332); the size rules in section 5 exist to stop that.

## 2. The tree

```
openboard/
  AGENTS.md  CLAUDE.md  README.md  LICENSE  NOTICE
  package.json               Bun workspaces root, scripts only, one shared version
  bun.lock
  biome.json                 formatter + lint (armada: biome.json)
  .oxlintrc.json             per-package restricted imports and globals
  tsconfig.json              strict, erasableSyntaxOnly, project references
  release-please-config.json one version for every manifest (armada)
  Dockerfile  railway.json
  .github/
    workflows/ci.yml         the one required check: "Verify"
    workflows/web.yml        Playwright, not required
    workflows/nightly.yml    full bench both modes, Playwright, conformance against staging
    workflows/release.yml    release-please, binaries, image, npm, Railway
    pull_request_template.md
  .veebee/
    cut.md                   every ticket of every milestone, one line each
    milestones/Mn-slug.md    milestone definition and demo script
    tickets/NN-slug.md       one ticket per file (docs/project.md)
  docs/
  packages/
    contract/                @openboard/contract
    core/                    @openboard/core
    ports/                   @openboard/ports         (+ subpath @openboard/ports/testkit)
    driver-sql/              @openboard/driver-sql    (shared SQL: views, statements, DDL source; drivers only)
    driver-sqlite/           @openboard/driver-sqlite
    driver-postgres/         @openboard/driver-postgres
    server/                  @openboard/server
    sdk/                     @the-vibe-company/openboard          (published)
    cli/                     @the-vibe-company/openboard-cli      (published, client only)
  apps/
    openboard/               @openboard/app: composition root; compiles to the `openboard` executable (also shipped as `ob`)
    web/                     @openboard/web: React SPA, embedded in the binary
  tools/
    conformance/             runs upstream's kit against one or two instances
    bench/                   workloads and budgets, per mode
  skills/
    openboard/               the agent skill (`npx skills add The-Vibe-Company/openboard`)
  examples/
    <recipe>/                integrations and recipes; SDK/CLI consumers only
  scripts/
    ci/                      boundaries, sizes, migrations, module state, agents guard, PR size, gen check
    build/  release/  tickets/
```

Workspaces are `packages/*`, `apps/*`, `tools/*`, `examples/*`. Everything under `packages/` and `apps/` except `sdk` and `cli` is private.

### 2.1 Packages and why each exists

| Workspace | Responsibility (one sentence) | Public entry points | Why it is separate |
|---|---|---|---|
| `packages/contract` | Declares every operation, entity schema, event type and error code, as TypeBox schemas plus metadata (scope, access, projections). | `src/index.ts`: `operations`, `defineOperation`, entities, `BoardError`, `ERRORS`, `EVENT_TYPES`, `UPSTREAM_VERSION` | Browser-safe, shared by the server and every client. TypeBox per `docs/decisions.md` D20. |
| `packages/core` | The rules as pure functions: given state, a command and `now`, return events and a result, or throw a `BoardError`. | `src/index.ts` per area: `messages`, `tasks`, `access`, `orgs`, `schemas`, `events` | Purity is enforced by import rules and banned globals; every rule is testable in microseconds. |
| `packages/ports` | Interfaces for everything mode-specific (`Store` and its scoped views, `Broadcaster`, `Jobs`, `Blobs`, and the SaaS seams `Quotas`, `RateLimits`, `Meter`), plus the shared suites every driver must pass. | `src/index.ts` (types only), `testkit/index.ts` (`runStoreSuite(driver)`, `runBroadcasterSuite`, `runJobsSuite`, `runBlobsSuite`) | Lets the server depend on behaviour, not on a database; one suite defines "correct" for both drivers. No SQL, no I/O. |
| `packages/driver-sql` | The one shared SQL module (D32): the scoped views written once with a tagged template over an engine-neutral `Db` interface, the statement registry, and the migrations in Postgres syntax. | `src/index.ts`: `createViews(db, dialect)`, `Dialect` type, `statements`, `migrations` | One implementation of every query for both engines, without letting SQL leak out of the driver layer; importable only by the two drivers. |
| `packages/driver-sqlite` | Local mode: the SQLite dialect (placeholders, `BEGIN IMMEDIATE` plus a process mutex as the board lock, DDL rendering), in-process fan-out and jobs, blobs on the filesystem. | `src/index.ts`: `sqliteDriver({ dir } \| { memory: true })` | Isolates `bun:sqlite`. |
| `packages/driver-postgres` | Hosted mode: the Postgres dialect (Bun's built-in `SQL` client, the `boards` row lock, `pg_notify`), `LISTEN` wake-ups with catch-up by cursor, `SKIP LOCKED` jobs, blobs as `bytea`, the timeline guard (D37). | `src/index.ts`: `postgresDriver({ url, instanceId })` | Isolates the Postgres client; the only code that knows there are several instances. |
| `packages/server` | The HTTP edge: router generated from the contract, scope resolution, auth verifier chain, accounts and organizations, connections, SSE and long-poll, job handlers, webhook signing, MCP facade, SPA serving. | `src/index.ts`: `createApp(config, ports, deps)` -> `{ fetch, drain, close }` | All request behaviour, written once against ports; it never imports a driver, so it cannot depend on one mode. |
| `packages/sdk` | Typed HTTP client for every contract operation, plus the live tail (SSE with long-poll fallback and cursor resume). | `src/index.ts` (`createClient`, `BoardError`, types), `src/live.ts` (`tail`) | Published; small and runtime-agnostic (Bun, Node 22, browser). |
| `packages/cli` | `ob`'s client commands: derived from contract metadata, plus hand-written `connect`, `login`, `tail`, `whoami`, `org`. | `src/main.ts` (`runCli(argv, env)`), `src/output.ts` | Published to npm as a Node-compatible client; agents use it with `npx` and never download server code. |
| `apps/openboard` | The composition root and the executable: reads config, picks the driver, wires ports into `createApp`, runs the server commands (`openboard serve`, `migrate`, `restore`, `reproject`, `version`, D42), and hands every other command to `runCli`. The same executable is shipped as `ob`, where `ob serve` starts the same server locally on SQLite. | `src/main.ts` (binary entry), `src/compose.ts`, `src/config.ts` | The one place that knows which driver runs; keeping it out of `server` makes "handler depends on a driver" impossible to write. |
| `apps/web` | The browser UI: sign-up and sign-in, create or join an organization, organization settings, boards, channels, threads, tasks, live updates. | `src/main.tsx`, `src/routes/` (TanStack Router file routes) | React and its toolchain stay out of the server and client graphs. |
| `tools/conformance` | Boots one instance (SQLite) or two instances sharing one Postgres, runs upstream's conformance kit, scores per group, ratchets the score per mode. | `src/run.ts` (`bun run conformance [--driver postgres --instances 2]`) | The only workspace allowed to depend on `@vercel/board` (dev-only, exact pin). |
| `tools/bench` | Fixed workloads in both modes, compared with per-mode budgets. | `src/run.ts` (`bun run bench`), `budgets.json` | Measurement code stays out of shipped packages. |
| `examples/*` | Recipes: one integration or use case each, as an SDK/CLI/webhook consumer. | `README.md` + `src/main.ts` per recipe | Integration code physically outside core, so CI can forbid core from importing it. |

Why not fewer: merging the two drivers would let SQLite-only assumptions leak into the Postgres path, while `driver-sql` keeps their shared SQL in one place (D32); putting ports in `core` would mix pure rules with a test kit that does I/O; putting composition in `server` would let any server file import a driver. Why not more: auth, MCP, jobs and live are edges of the server with no independent consumer; provider-specific identity code is isolated by a directory rule (section 3.2), not a package.

### 2.2 Inside the main packages

```
packages/contract/src/
  operation.ts             defineOperation(), Operation type, scope + projection metadata
  operations/index.ts      the registry, sorted
  operations/<area>.ts     discovery messages threads events channels actors tasks grants schemas
                           files schedules watchers sync connections webhooks inbound
                           accounts orgs memberships invitations boards audit
  entities/<area>.ts       Message, Thread, Task, Claim, Grant, Org, Membership, Event, ...
  errors.ts  events.ts  headers.ts  protocol.ts

packages/core/src/
  messages/  threads/  tasks/  access/  orgs/  schemas/  events/  ids.ts

packages/ports/src/
  store.ts                 Store -> platform() | org(scope) | board(scope); BoardView.write(fn) = one board-locked transaction
  broadcaster.ts           publish(scope, position) after commit; subscribe(scope, fromPosition)
  jobs.ts                  enqueue(kind, dueAt, payload) inside a write; claim(kinds, instanceId) -> leased job
  blobs.ts                 put/get/delete by content hash, scoped to an org
  seams.ts                 Quotas, RateLimits, Meter (no-op implementations included)
packages/ports/testkit/
  store/<area>.test-suite.ts  broadcaster.test-suite.ts  jobs.test-suite.ts  blobs.test-suite.ts
  isolation.test-suite.ts     two organizations, no read or write crosses

packages/driver-sql/src/
  db.ts                    Db interface (query, pipeline, begin) and Dialect type
  sql.ts                   the tagged template: renders $1… or ? per dialect
  views/<area>.ts          BoardView, OrgView, PlatformView methods, written once
  statements.ts            registry of every statement (used by EXPLAIN and scope tests)
  migrations/NNNN-slug.sql one DDL source, Postgres syntax (data-model.md "DDL")

packages/driver-sqlite/src/
  index.ts  open.ts  dialect.ts  migrate.ts
  ddl.ts                   renders driver-sql migrations to SQLite (the mechanical table in data-model.md)
  broadcaster.ts           in-process bus (one process is the whole cluster in this mode)
  jobs.ts                  jobs table + one timer to the next due job
  blobs.ts                 content-addressed files under <dir>/blobs
  counters.ts              statement counter for tests and bench

packages/driver-postgres/src/
  index.ts  pool.ts  dialect.ts  migrate.ts
  lock.ts                  SELECT … FROM boards WHERE id = $1 FOR UPDATE at the start of every board write
  timeline.ts              D37 timeline guard
  broadcaster.ts           pg_notify in the write as a wake-up, LISTEN per instance, read by cursor, 2 s safety poll
  jobs.ts                  FOR UPDATE SKIP LOCKED, any instance
  blobs.ts                 bytea table, at most 4 MB per file (D39)
  counters.ts              statement and round-trip counter

packages/server/src/
  index.ts  app.ts  deps.ts  log.ts
  http/       router.ts  pipeline.ts  scope.ts  respond.ts  errors.ts  static.ts
  operations/<area>.ts     handlers, one file per contract area
  auth/       chain.ts  connections.ts  tokens.ts  sessions.ts
              providers/index.ts  providers/github/*.ts
  live/       sse.ts  long-poll.ts
  jobs/       registry.ts  schedules.ts  webhooks.ts  sign.ts
  mcp/        facade.ts  tools.ts
  web/        assets.ts

apps/openboard/src/
  main.ts  config.ts  compose.ts  serve.ts  migrate.ts  restore.ts  reproject.ts
```

One write is one transaction (decide, append events, fold, insert outbox and job rows, commit, D10); on Postgres every board write starts by locking the board's row, so log positions are gap-free and commit in order within a board (D33).

URLs follow `docs/protocol.md` "URLs" (D35): the board API is `BOARD_URL = <origin>/api/<org>/<board>`, locally `/api/local/main` with bare `/api` as an alias of it; board extensions at `{BOARD_URL}/x/…`; the account and organization API at `/api/x/…`; MCP at `/mcp/<org>/<board>`; browser sign-in at `/auth`; the SPA everywhere else; `/healthz` and `/readyz` unauthenticated. The organization and board of a request come from its path, never from its credential. Nothing under `/api` ever answers HTML or redirects (D8).

## 3. Dependency rules

### 3.1 The allow-list graph

An entry means "may import". Anything not listed is forbidden. The table lists direct imports; a dependency arriving through an allowed workspace (TypeBox through `contract`) is not listed again.

| From | May import (workspaces) | May import (external) |
|---|---|---|
| `packages/contract` | nothing | `@sinclair/typebox` |
| `packages/core` | `contract` | nothing |
| `packages/ports` (`src`) | `contract`, `core` (types) | nothing |
| `packages/ports` (`testkit`) | `contract`, `core`, `ports` | `bun:test` |
| `packages/driver-sql` | `contract`, `core`, `ports` | nothing (no engine client: it talks to the `Db` interface) |
| `packages/driver-sqlite` | `driver-sql`, `contract`, `core`, `ports` | `bun:sqlite`, `node:fs`, `node:path` |
| `packages/driver-postgres` | `driver-sql`, `contract`, `core`, `ports` | `bun` (`SQL`, Bun's built-in client, which handles `LISTEN`; D32) |
| `packages/server` | `contract`, `core`, `ports` | `bun`, `node:crypto`, `node:path` |
| `packages/sdk` | `contract` | nothing (global `fetch`) |
| `packages/cli` | `sdk`, `contract` | `node:*` |
| `apps/openboard` | `server`, `cli`, `ports`, `driver-sqlite`, `driver-postgres`, `contract` | `bun`, `node:*` |
| `apps/web` | `sdk`, `contract` | `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `@tanstack/react-virtual`, `geist` |
| `tools/conformance` | `server`, `ports`, `driver-sqlite`, `driver-postgres`, `contract` | `@vercel/board` (exact pin), `node:*` |
| `tools/bench` | `server`, `ports`, `driver-sqlite`, `driver-postgres`, `sdk`, `contract` | `node:*` |
| `examples/*` | `sdk`, `cli` by published names | whatever the recipe declares in its own `package.json` |
| `scripts/*` | any workspace except `examples/*` | root dev dependencies |

Universal rules:
- **`driver-sql` is imported only by `driver-sqlite` and `driver-postgres`.**
- **Drivers are imported only by composition roots**: `apps/openboard/src/compose.ts`, `packages/server/test/support/drivers.ts`, `tools/conformance/src/drivers.ts`, `tools/bench/src/drivers.ts`, and each driver's own tests. Any other file importing `@openboard/driver-*` fails CI.
- **CI renderer exception:** `scripts/ci/migrations.ts` can import the pure `@openboard/driver-sqlite/ddl` subpath.
- **No SQL outside a driver** (section 3.2).
- Nothing imports `examples/*`. Only `tools/conformance` imports `@vercel/board`, never at runtime.
- No workspace imports another workspace's files by relative path; only package names and declared entry points.
- Test files follow their package's graph, plus `bun:test`, `@openboard/ports/testkit`, and their own `test/support/`.
- Type-only imports count.

### 3.2 Rules inside packages

| Rule | Scope |
|---|---|
| SQL only in the `packages/driver-*` workspaces (`driver-sql`, `driver-sqlite`, `driver-postgres`): no `.sql` file elsewhere, and no string or template literal elsewhere starting with an uppercase SQL statement head (`SELECT … FROM`, `INSERT INTO`, `UPDATE … SET`, `DELETE FROM`, `CREATE `, `ALTER `, `DROP `, `BEGIN`, `LISTEN`, `NOTIFY`, `PRAGMA`) | all workspaces except `driver-*` and `scripts/ci` fixtures |
| `bun:sqlite` only in `driver-sqlite`; `SQL` from `bun` only in `driver-postgres`; `driver-sql` imports neither | everywhere |
| Every registered statement filters on `board_id` or `org_id`, except those listed as platform statements (accounts, sign-in) | `driver-sql` (statement registry test) |
| `process.env` / `Bun.env` only in `apps/openboard/src/config.ts` and `packages/cli/src/config.ts` | `packages/` and `apps/` (CI scripts and tools read their own environment) |
| No `setTimeout`, `setInterval`, `queueMicrotask`, `Date`, `Math.random`, `crypto.randomUUID` (time, timers and IDs come from `deps`) | `contract`, `core`, `ports`, `server` |
| No module-level `let`/`var`, no module-level mutable object (`new Map()`, `new Set()`, `[]`, `{}` assigned and later mutated), no `static` mutable class fields | all `packages/*/src`, `apps/openboard/src` |
| `server/src/auth/providers/<name>/**` imported only by `server/src/auth/providers/index.ts` | server |
| Store access in server only through `ctx.board`, `ctx.org` or `ctx.platform` (section 4.4); `Store` itself only in `server/src/app.ts` and `server/src/http/scope.ts` | server |
| `console.*` only in `server/src/log.ts` and `cli/src/output.ts` | packages, apps |
| Deny terms, whole word, case-insensitive: `armada`, `slack`, `linear`, `notion`, `discord`, `granite` | `packages/*`, `apps/*` |

GitHub is the only people sign-in provider, under `server/src/auth/providers/github/` and `apps/web/src/auth/`. The upstream `github` grant principal is part of the board protocol. It can match a locally linked GitHub identity. Core makes no calls to GitHub. Adding a provider integration means adding its name to the deny list in the PR that adds its recipe.

### 3.3 How CI enforces it

All of it runs in `bun run lint`, inside the required check.

1. **`scripts/ci/boundaries.ts`**, data in **`scripts/ci/boundaries.json`** (workspace `may`/`external` lists, composition roots, path rules, deny terms). It extracts imports with `Bun.Transpiler#scanImports` and string/template tokens with the TypeScript scanner, then fails on: an edge not allowed; a `package.json` whose dependencies disagree with its imports; a driver imported outside a composition root; `driver-sql` imported outside the two drivers; a forbidden module outside its package; a `.sql` file or SQL statement head outside a driver; a deny term. Unit tests: `scripts/ci/boundaries.test.ts`, one fixture per rule. Borrowed from armada: `scripts/ci/import-boundaries.ts`.
2. **`.oxlintrc.json` overrides** for in-file AST rules: `no-restricted-globals` (timers, clock, randomness), `no-restricted-imports`, `no-console`, `max-lines-per-function`. Armada runs oxlint already (root `package.json`).
3. **TypeScript** makes the scoped-store rule structural: handler types receive `BoardView`/`OrgView` views, which have no `orgId` or `boardId` parameters, and only the tenant resolver can mint the `BoardScope` a view is opened with (section 4.4, D33).
5. **Drift between engines** (D32, data-model.md "The store port"): the shared store suite on both drivers, an `EXPLAIN` of every registered statement on both engines, and a schema-parity test comparing both catalogs. These run in the `unit-sqlite` and `postgres` jobs.
4. **`scripts/ci/migrations.ts`** over the single migration source `packages/driver-sql/migrations/`: numbers are unique and newer than `main`'s, applied files are never edited, every file renders to SQLite through `driver-sqlite/src/ddl.ts` (the mechanical differences of `docs/data-model.md` "DDL"), and no migration contains a destructive statement (`DROP`, `RENAME`, `ALTER … TYPE`, `SET NOT NULL` without default) unless marked `-- contract-phase` and preceded by a release that stopped using the object (section 7.6).
6. **`scripts/ci/module-state.ts`** parses every file under `packages/*/src` and `apps/openboard/src` with the TypeScript API and fails on a module-level `let`/`var`, a module-level `new …()`, array or object that the module or a file importing it changes in place, and a `static` class field that is not `readonly` or holds a container that is changed in place (section 3.2, 5.6). Names are resolved lexically; aliases (`const c = cache`) are not followed. Unit tests: `scripts/ci/module-state.test.ts`, fixtures in `scripts/ci/fixtures/module-state/`.

There is no CODEOWNERS file (D44): agents open pull requests under the owner's GitHub account, so GitHub could not route their review to the owner. The orchestrator reviews and merges every pull request. A change to `scripts/ci/boundaries.json`, `.oxlintrc.json`, `biome.json`, `tools/conformance/score.json`, `tools/bench/budgets.json`, `packages/driver-sql/migrations/`, `packages/ports/testkit/isolation.test-suite.ts`, `packages/server/test/isolation/**` or `.github/` says so in its PR body, and one that widens the graph, adds a dependency, lowers a score, raises a budget or weakens isolation says why.

## 4. One operation, defined once

### 4.1 The definition

```ts
// packages/contract/src/operations/tasks.ts
export const claimTask = defineOperation({
  name: "claimTask",                                    // camelCase, unique, stable
  summary: "Claim a ready task with a lease.",
  route: { method: "POST", path: "/tasks/:id/claim" },  // relative to BOARD_URL (/api/<org>/<board>); upstream path where one exists
  scope: "board",                                       // public | account | org | board
  input: {
    params: Type.Object({ id: Ref("message") }),        // Ref marks an ID of a tenant resource
    body: Type.Object({ seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })) }),
  },
  output: ClaimResult,
  errors: ["task_not_found", "task_claimed", "task_finished", "forbidden"],
  access: { permission: "post", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: false, emits: ["task.claimed"], meter: "task_claims" },
  cli: { command: ["tasks", "claim"], args: ["id"] },
  mcp: { tool: "claim_task" },
  upstream: true,
});
```

- `scope` is mandatory. `board` routes are relative to `BOARD_URL` (`/api/<org>/<board>`; OpenBoard-only ones under `{BOARD_URL}/x/`). `org` routes (members, boards, invitations) live under `/api/x/orgs/<org>/…` and `account` routes (the signed-in person) under `/api/x/…`. `public` covers discovery, health and sign-up start. Connections, webhooks, grants, inbound endpoints and schedules are per board (D34), so they are `board` scope.
- `Ref(kind)` marks every input field that names a tenant resource. The isolation suite and the router use it.
- `cli: false` / `mcp: false` need a `why`. `upstream: false` operations live under an `/x/` prefix (D23, D35).
- `effects.meter` names the usage counter the operation feeds (seam, section 4.5).

### 4.2 Where each projection comes from

| Surface | Produced by | How |
|---|---|---|
| REST | `packages/server/src/http/router.ts` | Static route table from `operations`; the pipeline (4.4) runs every request. |
| OpenAPI | `bun run gen` -> `packages/server/openapi.json` (committed), served at `GET {BOARD_URL}/openapi.json` | TypeBox schemas are JSON Schema already. |
| SDK | `packages/sdk/src/client.ts` | Mapped types over `operations`: `client.claimTask({ id, seconds })`; contract inlined in the bundle. |
| CLI | `packages/cli/src/commands/derived.ts` | `ob <command…>` from each `cli` block; `--json` prints the raw output. |
| MCP | `packages/server/src/mcp/tools.ts` | One tool per `mcp` block; schema from `input`; annotations from `effects`; same pipeline as REST. |
| Isolation suite | `packages/server/test/isolation/isolation.test.ts` | One cross-tenant case per operation and `Ref` field (6.5). |
| Skill reference | `bun run gen` -> `skills/openboard/references/commands.md` | One section per CLI command. |

`bun run gen:check` fails if a committed generated file differs. It runs in the required check.

### 4.3 Adding an operation, step by step

1. **Contract.** `defineOperation` in `packages/contract/src/operations/<area>.ts` with `scope`, `Ref` fields and errors; entities in `entities/<area>.ts`; new codes in `errors.ts`. New area files go in `operations/index.ts`, sorted.
2. **Rule.** Pure function in `packages/core/src/<area>/<verb>.ts`, tests in `packages/core/test/<area>/`.
3. **Port.** If it needs new storage, add the method to the scoped view in `packages/ports/src/store.ts` and its behaviour cases to `packages/ports/testkit/store/<area>.test-suite.ts`.
4. **Shared SQL.** Implement the method once in `packages/driver-sql/src/views/<area>.ts`, register its statements, and add a migration `packages/driver-sql/migrations/NNNN-slug.sql` (Postgres syntax, expand-only) if the schema changes. Both drivers pick it up; touch a driver's `dialect.ts` only for a mechanical difference. Both must pass the testkit, `EXPLAIN` and schema parity.
5. **Handler.** `handlers.claimTask = async (ctx, input) => …` in `packages/server/src/operations/<area>.ts`. `Handler<typeof claimTask>` makes a missing or mistyped handler a compile error; `packages/server/test/registry.test.ts` fails on an operation without one.
6. **HTTP test.** `packages/server/test/<area>.test.ts`: happy path and each declared error, through `app.fetch`. It runs on SQLite locally and on two Postgres instances in CI without changes.
7. **Isolation seed.** If the operation introduces a new `Ref` kind, add its seeding to `packages/server/test/isolation/seed.ts`; the suite fails on a `Ref` kind it cannot seed.
8. **Generate, conform, document.** `bun run gen`; `bun run conformance` (and `--update` if checks now pass); update `skills/openboard` or docs if people or agents see the change.

### 4.4 Scoping is applied once

Every request goes through one pipeline in `packages/server/src/http/pipeline.ts`, shared by REST and MCP; handlers never run outside it:

1. **Resolve the tenant from the path** (`http/scope.ts`): `/api/<org>/<board>` (or `/api` locally, an alias of `/api/local/main`) and `/api/x/orgs/<org>/…` give the organization slug and, for `board` operations, the board slug. Unknown slugs answer 404 without saying which part is unknown; discovery answers from the URL alone (D35).
2. **Authenticate**: the verifier chain returns a principal (session, personal token, connection, agent token, OIDC, local owner token) with the organization and, for board-bound credentials, the board it belongs to.
3. **Match credential and path**: on an authenticated route of an existing board, a connection secret (`obc_`) or agent token (`obt_`) issued for a different board or organization gets 401 `unauthorized`. A person's session or personal token (`obp_`) outside its organization answers 404 `not_found`. Both checks precede handler code. Only this step mints the `BoardScope`/`OrgScope` (D33).
4. **Rate limit** (`RateLimits` port) per organization and credential.
5. **Authorize**: membership role and grants for the operation's `access` (members capped as D34 says).
6. **Quota** (`Quotas` port) when the operation creates or stores something countable.
7. **Run the handler** with `ctx`. `ctx.board` is `store.board(scope)`, `ctx.org` is `store.org(scope)`, `ctx.platform` exists only for `account` and `public` operations. These views take no `orgId`/`boardId` arguments: the shared SQL binds them into every statement. A handler has no way to name another tenant.
8. **Meter** (`Meter` port) after commit, from `effects.meter`.

What enforces isolation, in v1 (D33): only step 3 can create a scope; every view method takes one; the statement-registry test in `driver-sql` fails on any statement that does not filter on `board_id` or `org_id` (outside the listed platform statements); the storage-level isolation suite runs on both engines; and the contract-generated isolation suite (6.5) runs every operation across two organizations. Postgres row-level security is not used in v1 because it costs a round trip on every read to set the tenant; `org_id` on every row keeps it available, and M5 measures its cost and records a decision.

### 4.5 SaaS seams (D40)

| Seam | Where it plugs in | v1 |
|---|---|---|
| Count and size quotas per organization | `Quotas` port, pipeline step 6; error `quota_exceeded` with `next` | enforced (M7) |
| Rate limits per organization and credential | `RateLimits` port, pipeline step 4; error `rate_limited` with `Retry-After` | enforced (M7); the hosted implementation is shared across instances through Postgres, never an in-memory counter |
| Usage metering | `Meter` port, pipeline step 8, keyed by `effects.meter`, daily rollups as a job | designed; rollups after v1 |
| Organization export | the log-shipping format, importable into `ob serve` | designed; built with backups (M15) |
| Organization deletion | soft delete, hard delete by a job after 30 days | enforced (M7) |
| Audit of administrative actions | `ob.*` events in the log, read at `{BOARD_URL}/x/audit` and `/api/x/orgs/:org/audit` (D23) | enforced (M4) |
| SSRF guard on webhook targets, no tenant override | webhook dispatcher | enforced (M11) |
| Tenant isolation suite in CI | 6.5 | enforced (M4) |

Billing is out of scope. Each seam that holds state has an implementation in each driver.

## 5. Conventions

### 5.1 Size limits

| Limit | Value | Enforced by |
|---|---|---|
| Source file | 400 lines | `scripts/ci/sizes.ts` |
| Test file | 600 lines | `scripts/ci/sizes.ts` |
| Function | 80 lines | oxlint `max-lines-per-function` |
| Source files per directory | 15; split into subdirectories past that | `scripts/ci/sizes.ts` |
| Changed lines per PR, per workspace | 600, excluding generated files, lockfile, pure deletions and renames | `scripts/ci/pr-size.ts` on `pull_request` (armada: `AGENTS.md` "Pull requests") |
| `AGENTS.md` | 9,216 bytes, no issue numbers or dates | `scripts/ci/agents-guard.ts` (armada: same script and budget) |

Generated files (`*.gen.ts`, `openapi.json`, `commands.md`) are exempt and never hand-edited. There is no allowlist: a file over the limit is split. Only the owner applies the `size-exception` label.

### 5.2 Naming

- Files and directories `kebab-case.ts`; React components `PascalCase.tsx` under `apps/web/src/components/`.
- Operations `camelCase`, verb first; MCP tools `snake_case` of the same; CLI `ob <noun> <verb>`, with upstream's short forms (`ob post`, `ob read`, `ob tail`).
- Error codes, reasons, SQL tables (plural) and columns: `snake_case`. Upstream codes and event names verbatim. OpenBoard-only events `ob.<noun>.<past_tense>`.
- Migrations `NNNN-slug.sql`, one source in `packages/driver-sql/migrations/`, rendered for SQLite.
- Tests `<subject>.test.ts`, named as a sentence about the product; shared driver suites `<area>.test-suite.ts`.

### 5.3 Errors

Every expected failure is a `BoardError` from `packages/contract/src/errors.ts`. Anything else escaping a handler is a bug: `500 internal` with the request ID, logged with its stack.

`ERRORS` maps each `code` to its HTTP status and allowed `reason` values. The wire shape is upstream's `{ "error": { "code", "message", "hint" } }` (upstream: `docs/04-reference/03-http.md` "Errors") plus two additive fields:

```json
{
  "error": {
    "code": "task_claimed",
    "reason": "lease_active",
    "message": "task 812 is claimed by agent-3 until 14:05:10Z",
    "hint": "Wait for the lease to end or claim another ready task.",
    "next": [
      { "kind": "run", "argv": ["ob", "tasks", "claim", "--next", "--channel", "dev"] },
      { "kind": "wait", "seconds": 120 }
    ]
  }
}
```

- `code` is stable forever. `reason` is a stable finer cause an agent can branch on. `message` is for people and never parsed (armada: `docs/api-error-codes.md`).
- `next` holds at most two ways out (upstream: `AGENTS.md` "cli design"): `{ kind: "run", argv }`, `{ kind: "call", operation, input }`, `{ kind: "wait", seconds }`, `{ kind: "read", url }`.
- A resource of another organization is always `404` with the resource's ordinary not-found code, never `403`: the answer must not reveal that it exists.
- Core throws `BoardError`; the server catches only at an edge (pipeline, MCP, job runner, webhook delivery). No empty `catch`.
- CLI exit codes: 0 success, 1 error, 2 misuse, 130 interrupted (upstream).

### 5.4 Logging

- One logger from `deps`, passed as `ctx.log`. JSON lines on stdout: `{ "t", "level", "msg", "request_id", "req", "op", "org", "actor", "instance", "ms" }`.
- `OPENBOARD_LOG_LEVEL` (`debug|info|warn|error`, default `info`). One `info` line per request and per job run.
- Never log bodies, message text, tokens, secrets, cookies or signing keys; the logger drops keys matching `token|secret|authorization|cookie|password|signature`, and a test pins it.
- `core` and `ports` never log; drivers log only slow statements and connection state, through the logger they are given.

### 5.5 Configuration

`apps/openboard/src/config.ts` is the single typed config module: a TypeBox schema over the environment, parsed once at startup into a frozen `Config`. Invalid config exits 2 naming every bad variable. `createApp` receives `Config`; tests build `Config` objects directly.

| Variable | Meaning |
|---|---|
| `OPENBOARD_DATABASE_URL` | set: hosted mode on Postgres (`postgres://…`), with organizations and sign-up; unset: local mode on SQLite, with the implicit organization `local` and board `main` |
| `OPENBOARD_DATA_DIR` | SQLite mode: database, blobs, backups (default `./.openboard`) |
| `OPENBOARD_SIGNUP` | `open`, `invite` or `closed` (docs/auth.md); local mode defaults to `closed`, no sign-up unless set (D48) |
| `OPENBOARD_PUBLIC_URL` | canonical origin, never derived from `Host` |
| `OPENBOARD_SECRET_KEY` | encrypts recoverable secrets (D29) |
| `OPENBOARD_INSTANCE_ID` | Optional job log label. Each runner uses a generated lease owner ID and uses that ID as its default log label. |
| `OPENBOARD_DEPLOYMENT_TAG` | Optional deployment tag reported by `/healthz` alongside the instance ID, when configured. |
| `OPENBOARD_GITHUB_CLIENT_ID`, `OPENBOARD_GITHUB_CLIENT_SECRET` | GitHub sign-in |
| `OPENBOARD_LOG_LEVEL` | log level |
| `PORT` | listening port (Railway sets it), default `8787`; the only unprefixed variable |

- Pattern: `OPENBOARD_<AREA>_<NAME>`. Any secret may instead be given as `OPENBOARD_<NAME>_FILE` (a path); setting both is an error. Secrets never come from argv.
- Clients read upstream's `BOARD_URL` and `BOARD_TOKEN`, plus `OPENBOARD_SECRET` for `ob connect` (only in `packages/cli/src/config.ts`), so `vb` and `ob` share one setup. The SDK reads nothing.
- A secret is never an argv value. `ob connect <url> --as <name>` reads the connection secret from stdin, `--secret-file <path>`, or `OPENBOARD_SECRET` (armada: `AGENTS.md` non-negotiable 4).
- The authoritative list is the `Config` schema, printed by `openboard serve --help`.

### 5.6 No global state, no single-process state

- No module-level mutable state, singletons or caches filled at import. Everything hangs off `createApp`, so two apps in one process share nothing; the test suites rely on this to run two instances in one process.
- Time, IDs, randomness, outbound HTTP and timers come from `deps`.
- Per-connection state (an open SSE stream, a parked long-poll) is allowed; what wakes it comes from the `Broadcaster` port, never from a write in the same process.
- Anything due later (schedule sends, webhook deliveries and retries, blob GC, backups) is a row enqueued through `Jobs` in the write transaction; any instance may run it. Lease and match expiry are lazy, computed from stored times (D24), so nothing depends on a timer in a particular process.
- Caches are allowed only if they are correct when stale or are invalidated through the `Broadcaster` (for example the auth chain's credential cache keyed by hash, invalidated on revoke events).

### 5.7 TypeScript and style

- `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly` (upstream: `AGENTS.md` "invariants").
- Biome 2.5: two spaces, line width 120, double quotes (armada: `biome.json`).
- Inline lint suppressions give their reason on the same line (armada: `docs/lint-policy.md`).
- English everywhere.
- No compatibility layers for OpenBoard-only surfaces: replace, delete the old, update every caller in the same PR (armada: non-negotiable 1). Two things keep an N/N-1 overlap because instances of two versions run side by side during a rolling deploy: the database schema (expand/contract, 7.6) and job payloads (a new job kind is handled by the release before the one that enqueues it). The upstream wire protocol is not ours to change.

## 6. Testing

### 6.1 Layers

| Layer | What | Where | Runs on | Speed target |
|---|---|---|---|---|
| Domain unit | every rule and error reason | `packages/core/test/**` | no driver | < 5 ms/test |
| Contract | schemas, headers, `Ref` coverage | `packages/contract/test/**` | no driver | < 5 ms |
| Driver suites | `@openboard/ports/testkit` per port, isolation at storage level | `packages/driver-*/test/testkit.test.ts` (one file each, calls `runStoreSuite(driver)` etc.) | SQLite `:memory:`; Postgres | < 20 ms SQLite, < 50 ms Postgres |
| HTTP | `app.fetch(request)`: pipeline, auth, errors, SSE framing, MCP | `packages/server/test/**` | SQLite single; Postgres two instances | < 50 ms |
| Tenant isolation | generated from the contract (6.5) | `packages/server/test/isolation/**` | both | < 2 s whole suite |
| Client | SDK and CLI against an in-process app via injected `fetch` | `packages/sdk/test/**`, `packages/cli/test/**` | SQLite | < 50 ms |
| Web unit | pure view state | `apps/web/test/**` | none | < 20 ms |
| Conformance | upstream's kit (6.3) | `tools/conformance` | SQLite one instance; Postgres two instances | < 60 s per run |
| Browser | Playwright journeys | `apps/web/e2e/**` | SQLite multi-tenant | < 3 min |
| Benchmark | workloads and budgets (6.6) | `tools/bench` | both | quick < 60 s per mode |

`packages/server/test/support/app.ts` exposes `makeApp()`. With `OPENBOARD_TEST_DRIVER` unset it returns one app on in-memory SQLite. With `OPENBOARD_TEST_DRIVER=postgres` it returns a two-instance cluster on a fresh Postgres database whose `fetch` alternates requests between the instances. Every HTTP and isolation test runs unchanged in both.

Rules (armada: `AGENTS.md` "Tests"): one test per behaviour at the cheapest layer; no network beyond the test database, no wall-clock waits, no sleeps (fake clock; jobs run by calling the runner); no child process when a function call proves the same thing; a test over one second is rewritten; a flaky test is deleted the day it is seen; a bug fix carries a test that fails without it; fixtures hold no token-shaped strings. From upstream (`AGENTS.md` "run it"): no auth bypass, real verification against test keys.

### 6.2 Postgres in tests

- **Real Postgres only.** Tests use the same major version as production (pinned in `.github/workflows/ci.yml` and `docker-compose.test.yml`). An embedded or WASM Postgres (PGlite) is not accepted: it runs one connection in one process, so it cannot exercise `SKIP LOCKED` contention, `LISTEN`/`NOTIFY` between connections, the `boards` row lock across pools, or two instances, which are exactly what the Postgres driver exists for. Armada uses PGlite for migration checks; our risk is concurrency, not SQL syntax.
- **Fresh database per test file**: the harness migrates a template database once per run, then `CREATE DATABASE t_<random> TEMPLATE openboard_template` per file (tens of milliseconds) and drops it after.
- **Locally**: `bun run verify` needs no Docker (SQLite only). `bun run verify:pg` starts Postgres with `docker compose -f docker-compose.test.yml up -d` (or uses `OPENBOARD_TEST_DATABASE_URL`) and runs the driver suite, HTTP, isolation and conformance on Postgres. Agents touching `ports`, `driver-postgres`, `server/src/http`, `server/src/live` or `server/src/jobs` run it before pushing.
- **In CI** a Postgres service container runs on every PR and in the merge queue, not only on paths that touch storage: workflow path filters do not apply to merge-queue runs (armada: `docs/merge-queue.md`), almost every feature touches a port, and a driver that is only tested sometimes drifts. This is a deliberate departure from armada's "no real PostgreSQL service in the required check" (`docs/ci-budget.md`): there Postgres is an external dependency; here it is one of the two products. If `OPENBOARD_TEST_DRIVER=postgres` is set and the database is unreachable, tests fail; they never skip.

### 6.3 Conformance as the oracle

`bun run conformance [--driver sqlite|postgres] [--instances 1|2]` (`tools/conformance/src/run.ts`):
1. Boots the server: SQLite on a temp directory (default), or N instances on one fresh Postgres database behind a local round-robin proxy, so consecutive requests of the kit (a write, then the long-poll that should see it) land on different instances.
2. Creates the credential `docs/auth.md` "The credential that runs conformance" specifies (D43): a direct (mode-1) connection whose grant is `*=all`, made with the local owner token on `local/main`, or on a board of a dedicated organization (`conformance-ci/main`) in hosted mode. Not the owner itself: an owner run skips the lockout check. Until connections exist (M4), the run uses the local owner token, which `docs/auth.md` allows, with the lockout check recorded as skipped for that period only. It runs the pinned kit: `BOARD_URL=http://127.0.0.1:<port>/api/local/main BOARD_TOKEN=<connection secret> vb conformance --json` (hosted: `…/api/conformance-ci/main`) (`@vercel/board` exact pin in `tools/conformance/package.json`, equal to `UPSTREAM_VERSION`; a test asserts it).
3. Prints passed / failed / skipped per group (`core`, `paging`, `search`, `schedules`, `tasks`, `grants`, `schemas`, `attachments`, `watchers`, `sync`).
4. Compares with `tools/conformance/score.json`, which lists passing checks per mode (`local`, `hosted`). Fails if a listed check no longer passes. `--update` adds new passes. From milestone M5 on, `scripts/ci/score.ts` also fails if `hosted` lists fewer checks than `local`: the modes stay equal.

"Skipped: not kept here" counts as not passing. Upstream says its local server passes all but four checks (team roles, apps, member lockout, cross-team grants: upstream `docs/04-reference/05-conformance.md`); those are listed under `expectedSkips` with that reason. With the D43 credential, the checks `docs/auth.md` lists as still skipped (the app and viewer checks, every sync check after registration because of D19, the root-edit-blocks task check, members shut out under a lock, grants across teams) are the complete `expectedSkips` list; the lockout check runs and must pass.

`bun run conformance --url <BOARD_URL>` runs against a deployed board using its direct connection secret on stdin. It compares with the hosted score by default. Add `--driver sqlite` for a deployed SQLite board. The deployed run does not boot or seed a server and rejects `--update` and `--instances`.

### 6.4 The two-instance HA test

High availability is proven by running the ordinary suites against two instances, not by a separate set of HA tests that could drift:
- the HTTP suite, the isolation suite and conformance run with two instances sharing one Postgres, requests alternating;
- `packages/server/test/ha/*.test.ts` adds the cases alternation cannot reach, including the database drill D38 asks for in CI (every backend connection killed with `pg_terminate_backend` mid-traffic: requests answer fast 503 `unavailable`, listeners re-subscribe, tails catch up by cursor, no acknowledged write is lost) and a lost notification (delivery still within the 2 s safety poll, D36); an SSE tail on instance 1 receives every event written through instance 2 in order; a long-poll parked on 1 wakes on a write via 2; a job enqueued via 1 runs exactly once when both runners poll; an instance draining (`app.drain()`) ends its streams with a resumable cursor and the client resumes on the other instance without a gap or a duplicate; a lease taken on 1 and expired is claimable on 2;
- on staging, `scripts/release/rolling-check.ts` keeps a tail open and posts a numbered message every 100 ms while Railway replaces every instance, then asserts each number arrived exactly once and in order. It runs on every staging deploy.

Because the SQLite driver's broadcaster and jobs are in-process, a server feature that bypassed the ports would still pass on SQLite and fail on the two-instance run; that is the point of running both in the required check.

### 6.5 The tenant isolation suite

The isolation suite uses `operations` to check that every operation declares a scope. Its planned generated cases cover the following behavior.
1. `seed.ts` creates two organizations, A and B, each with a board and one resource of every `Ref` kind (message, thread, task, grant, schema, file, schedule, webhook, connection, member, invitation, board), and records B's slugs and resource IDs.
2. **Path cases**: on authenticated board routes, present A's connection secret and agent token on A's other board and on B's board. Expect 401 `unauthorized`. Present A's session and personal token on B's board, and A's session on B's organization routes. Expect 404 `not_found`. Neither case may return 2xx or 403.
3. **ID cases**: for every `Ref` field in its input, it calls the operation on A's own URL with B's ID in that field. Since positions are per board, it also uses IDs that exist in both boards and checks the answer is A's resource, never B's. It expects A's data or a 404, never B's data.
4. For every list, search, feed or tail operation called as A, no B resource appears in the output. An upstream stub (`stub: true`, D57) answers A on A's board exactly as B on B's board instead of answering with A's data.
5. Before and after the whole run it takes B's digest (a digest of B's events and rows taken through the platform view: hash of B's events and derived rows); they must be equal.
6. The suite fails if an operation has a `Ref` kind `seed.ts` cannot create, or if `scope` is missing; adding an operation therefore adds its isolation cases automatically.

The storage-level twin, `packages/ports/testkit/isolation.test-suite.ts`, checks every scoped store method with two organizations, so a driver is isolated before any handler uses it. Both suites run on SQLite and on Postgres in the required check, from the first multi-tenant ticket. A PR that changes them says so in its body; an expected-failure list does not exist and must not be added.

### 6.6 Benchmark and budgets per mode

`bun run bench [--mode local|hosted] [--quick]` runs seeded workloads: boot to first request; 2,000 posts, 2,000 replies, 200 channel reads of 50, 500 task create/claim/complete cycles; 50 SSE tails receiving 1,000 events (in hosted mode, written through instance 1 and read through instance 2); an idle window.

`tools/bench/budgets.json` has one section per mode:
- **Deterministic counters, exact**, both modes: statements per operation, database round trips per operation (Postgres), response bytes for canonical requests, timers armed when idle. Any increase fails.
- **Measured values with headroom**: RSS idle and after load, p50/p99 latency per operation, cross-instance event delivery (hosted), cold start, idle wakeups, binary size. A measured value fails only when it exceeds its budget by more than 20% and by more than its noise floor, 0.5 ms at p50 and 1 ms at p99 (sub-millisecond timings jitter on shared CI runners).

The target numbers for each mode are set in one place, `docs/architecture.md` "Efficiency budgets"; this file does not restate them. `tools/bench/budgets.json` holds the values CI enforces: the architecture targets at first, replaced by measured baselines in M1 (local) and M5 (hosted) wherever the measurement is better, never looser than the target.

Raising a budget is the owner's decision. `--quick` runs counters and reduced workloads in the required check; the full bench runs nightly and on release. The nightly workflow uses the runner's Postgres service for the hosted benchmark. Results go to the project board's `openboard/ops` channel once dogfooding starts.

### 6.7 What runs where

| Gate | Runs | Required |
|---|---|---|
| `Verify` (`.github/workflows/ci.yml`), every PR and the merge queue | six parallel jobs, then an aggregate job named `Verify` that fails unless all succeeded: **`static`** (Biome, oxlint, boundaries, sizes, migrations check, module state, agents guard, typecheck, `gen:check`, PR size); **`unit-sqlite`** (`bun test`: core, contract, SQLite testkit, HTTP, isolation, clients, web unit); **`conformance-sqlite`**; **`postgres`** (Postgres service container; Postgres testkit, HTTP, isolation and HA tests with two instances); **`conformance-postgres`** (service container; two instances); **`bench`** (`--quick`, both modes' counters, local measured values) | yes, the only one |
| `web.yml`, PRs touching `apps/web/**`, `packages/sdk/**`, `packages/contract/**` | Vite build, Playwright on Chromium | no |
| `nightly.yml` | full bench both modes, conformance against staging when configured, `bun test --rerun-each 3` on both drivers to surface flakes | no; failing steps open an issue naming the job and linking the run |
| `release.yml` | binaries, image, npm, deploys, rolling check | not a PR gate |

Nightly staging conformance uses the repository variable `STAGING_URL` for the HTTPS origin and the `staging` environment secret `STAGING_CONFORMANCE_SECRET` for a direct connection to `conformance-ci/main`. With no URL GitHub skips the job. With a URL and no secret the job succeeds after reporting that it skipped conformance before checkout. Any protection rules on the `staging` environment apply before this check. Playwright and posting results to the board are separate milestones.

Keeping `Verify` under two minutes (armada: `docs/ci-budget.md`): the six jobs run in parallel; each caches Bun's install; each targets 90 s wall time including setup. The Postgres service container starts while dependencies install, and the template database makes per-file databases cheap. SQLite and Postgres work are in separate jobs, so Postgres adds no time to the critical path unless it is the slowest job. When `unit-sqlite` or `postgres` passes 60 s of test time it is sharded with a balance file (armada: `scripts/ci/unit-shards.ts`). CI never builds binaries or images, never runs a browser, never calls the internet, never retries. Going over two minutes is a defect with its own ticket. Adding a job, a required check or a gate is the owner's decision.

## 7. Build and release

### 7.1 One binary, two modes

`bun run build` (`scripts/build/index.ts`):
1. `vite build` in `apps/web` -> `apps/web/dist/`.
2. `bun build --compile --minify apps/openboard/src/main.ts` with every file of `apps/web/dist/` as an extra entrypoint, embedded in the executable. `packages/server/src/web/assets.ts` serves them from `Bun.embeddedFiles` when compiled and from disk in development. A build test runs the binary and fetches `/` and one hashed asset.
3. Targets `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-arm64`, `bun-darwin-x64` -> `dist/openboard-<target>`, copied as `dist/ob-<target>` (same bytes; the name only changes the default help). Both drivers are in every binary; `OPENBOARD_DATABASE_URL` selects one at startup.
4. `packages/cli` is also bundled for npm (`bun build --target=node`) as a client-only `ob`: `ob serve` there answers with a `next` hint to install the executable or run the image.
5. `packages/sdk` is bundled to ESM + `.d.ts` with the contract inlined.

### 7.2 Docker image

One image for both modes. Build stage `oven/bun:<pinned>`; runtime stage `debian:bookworm-slim` (D-level choice in `docs/architecture.md` "Topology"), non-root, copies only `dist/openboard-linux-<arch>` to `/usr/local/bin/openboard`, `ENV OPENBOARD_DATA_DIR=/data`, `VOLUME /data`, `EXPOSE 8787`, `ENTRYPOINT ["openboard"]`, `CMD ["serve"]`. Published as `ghcr.io/the-vibe-company/openboard:<version>` and `:main-<sha>`. In hosted mode the volume is simply unused.

### 7.3 Versions

- One version for every manifest, bumped by release-please from Conventional Commit titles; `release-please-config.json` lists every `package.json` and `packages/server/openapi.json` (`$.info.version`) (armada: `release-please-config.json`, `docs/releasing.md`).
- `UPSTREAM_VERSION` in `packages/contract/src/protocol.ts` equals the pinned `@vercel/board`; discovery (`GET {BOARD_URL}`, answered from the URL alone) reports both. Raising the pin is its own PR and needs the owner.
- Before 1.0.0, a breaking change of an OpenBoard-only surface bumps the minor; `feat!:` marks it.

### 7.4 Publishing

`.github/workflows/release.yml`: release-please opens `chore(release): <version>`; on merge it tags `v<version>`, builds binaries on native runners, attaches `openboard-*` and `ob-*` with SHA-256 sums to the GitHub release, pushes the multi-arch image to GHCR, publishes `@the-vibe-company/openboard` and `@the-vibe-company/openboard-cli` to npm with trusted publishing (OIDC, provenance; upstream: `AGENTS.md` "release it"), then deploys (7.5).

### 7.5 Railway: hosted service

- One Railway project, environments `staging` and `production`. Each has Railway Postgres, one node on the private network (D38), and one `openboard` service with **at least two replicas**, no volume, source = the GHCR image (never a Railway-side build, so every environment runs the bytes CI built). The staging deploy script sets the image, health check `/readyz` (liveness `/healthz`), health check timeout, two replicas in `europe-west4-drams3a`, restart on failure, and pre-deploy command `openboard migrate` in one `serviceInstanceUpdate` call through Railway’s GraphQL API.
- Config: `OPENBOARD_DATABASE_URL` (Railway reference variable), `OPENBOARD_SIGNUP`, `OPENBOARD_PUBLIC_URL`, `OPENBOARD_SECRET_KEY`, GitHub sign-in credentials.
- **Rolling deploy without downtime**: Railway starts new replicas, waits for `/readyz`, then sends `SIGTERM` to old ones. On `SIGTERM` an instance stops taking new requests, ends SSE streams with a retry hint and the last cursor, lets in-flight requests and its current job finish (10 s cap), releases its job leases, and exits. Clients resume on another replica by cursor. Unclaimed or released jobs are taken by the remaining instances.
- **Migrations on deploy**: `openboard migrate` runs as the pre-deploy command under a Postgres advisory lock, so only one runs. Migrations are expand-only during a deploy, since old and new versions serve together: add tables and nullable columns, backfill in jobs, never drop or rename. A contract step (drop, rename, `NOT NULL`) ships in a later release, marked `-- contract-phase`, once no running version uses the object; `scripts/ci/migrations.ts` enforces the marker (armada keeps the same N/N-1 overlap for database objects: `AGENTS.md` non-negotiable 1, `docs/architecture.md` "Deployment overlap").
- `scripts/release/railway-deploy.ts <environment> <tag>` points the service at the tag through Railway's API (`RAILWAY_TOKEN` in the GitHub environment secrets), waits until every replica's `/healthz` reports the version, and on staging runs `rolling-check.ts` (6.4). Every merge to `main` publishes `:main-<sha>` to GHCR. The staging job deploys that tag when the repository variable `STAGING_DEPLOY` is `on`. Set the staging-scoped Railway project token as the `RAILWAY_TOKEN` secret in the GitHub `staging` environment before enabling deploys. A release deploys `:<version>` to production after the same commit was healthy on staging.
- The database is the one single point of failure, stated as such (D38). The code is failover-ready (reconnect with backoff, fast 503 `unavailable`, re-listen and catch up by cursor, the D37 timeline guard), so moving to a failover Postgres is a change of `OPENBOARD_DATABASE_URL` only.
- Backups (D38): Railway's scheduled volume backups, per-organization log shipping to a bucket every 10 s, and a daily `pg_dump`. Attachments are `bytea` behind the `Blobs` port and move to an S3-compatible driver at about 20 GB of blobs or half the database (D39).

### 7.6 Self-host

- **Local, one command**: install the executable and run `ob serve` (the same as `openboard serve`) (SQLite in `./.openboard`, the implicit organization `local` and board `main`; the owner token is written to `~/.config/openboard/local/<port>.json` with mode 0600, never printed, and `ob` reads it for a loopback `BOARD_URL`), or `docker run -p 8787:8787 -v openboard:/data ghcr.io/the-vibe-company/openboard`.
- **Self-hosted server**: the same image as one container with one volume at `/data`, no Postgres. Deploys restart it in place with a few seconds of unavailability that clients absorb by reconnecting with their cursor. Snapshots are written by a scheduled job (`VACUUM INTO`, D25) and `openboard restore` reads them back.
- **Self-hosted HA**: the same image with `OPENBOARD_DATABASE_URL` and two or more containers, exactly like the hosted service; `OPENBOARD_SIGNUP` decides whether sign-up is open.
- Moving from local to Postgres is an organization export and import (seam in 4.5), not a database copy.
