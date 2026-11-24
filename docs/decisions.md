# Decisions

Numbered, append-only. Each entry: context, decision, consequence. D1 to D7
were made by Stan before the technical strategy; D8 to D30 are the
architect's first design (single tenant, SQLite). Stan then added high
availability and a hosted multi-tenant SaaS (his N1 to N9); D31 onward record
them and the architect's choices under them. A later decision that changes an
earlier one adds a new entry; the earlier entry gets a **Status** line naming
what superseded it, and is otherwise left as written.

## Given

### D1. In-house rewrite

- **Context.** Upstream `@vercel/board` (Apache-2.0, v0.54.0) is tied to
  Vercel's platform for identity, hosting, and blob storage.
- **Decision.** Rewrite. No upstream code at runtime. Upstream's `SPEC.md`,
  docs, and source are the behavioural reference.
- **Consequence.** We own every line; behaviour is pinned by the conformance
  kit, not by sharing code. Data we copy (built-in schema definitions) carries
  upstream's license notice (D27).

### D2. Wire-compatible with upstream's protocol; conformance is the oracle

- **Context.** Upstream ships `vb conformance`, which checks a board through
  its public client.
- **Decision.** Every route the kit covers behaves as upstream's reference.
  `BOARD_URL=<ours> BOARD_TOKEN=<ours> vb conformance` runs in CI with
  `@vercel/board` pinned as a dev-only dependency.
- **Consequence.** Upstream's `vb` CLI and client work against OpenBoard.
  Discovery must answer `url`, `audience` (equal to `BOARD_URL`), and `sync`
  (an array), and the API must never look like Vercel Deployment Protection
  (D8). Groups we do not keep must be skipped, not failed (D19).

### D3. Bun + TypeScript, one process, one binary; SQLite via `bun:sqlite`

**Status: superseded in part by D31.** Bun, TypeScript, one binary, and the
event log stand; SQLite is now the local-mode driver, Postgres the hosted one.

- **Context.** Lowest footprint, simplest operations.
- **Decision.** `bun build --compile`; one SQLite file on a volume; an
  append-only event log as source of truth plus derived tables. No external
  database, no Redis.
- **Consequence.** One writer (D10); horizontal scaling is a non-goal.

### D4. Railway: one service, one volume; sleep if it can

**Status: superseded by D31 and D38 for the hosted service** (several
stateless instances, Postgres, no sleep). Still valid for a single-node
self-host on SQLite.

- **Context.** Near-zero idle cost.
- **Decision.** One Railway service, one volume at `/data`, one replica.
- **Consequence.** Deploys with a volume stop the old instance first (seconds
  of downtime, unverified). Sleep is allowed only where it does not break
  schedules and webhooks (D24).

### D5. Efficiency is a product requirement

**Status: updated by D41** (budgets per mode; targets until measured).

- **Decision.** Budgets in [architecture.md](./architecture.md#efficiency-budgets)
  (idle RSS ≤ 45 MB, write p50 ≤ 0.25 ms in-process, 50-message read p50 ≤
  0.3 ms, fan-out to 1,000 streams ≤ 5 ms), enforced by a benchmark in CI
  against upstream's measured baseline.
- **Consequence.** No ORM, no web framework, prepared statements, single
  writer, in-process broadcaster (D10, D21).

### D6. A simple React SPA embedded in the binary

- **Decision.** TanStack Router, Query, Virtual; Vite; Geist, monochrome;
  embedded and served by the binary; consumes the same API and SSE.
- **Consequence.** The server provides cookie sessions, CSRF protection, and
  immutable asset caching ([architecture.md](./architecture.md#what-the-server-provides-for-the-front)).

### D7. One contract, projected into REST, OpenAPI, SDK, CLI, MCP

- **Decision.** Each operation is defined once; every surface is generated or
  derived from that definition. CLI `ob`, SDK `@the-vibe-company/openboard`
  (fetch-based), an agent skill, a remote MCP endpoint.
- **Consequence.** Upstream `operationId`s are kept for upstream routes, so
  the generated OpenAPI matches upstream's naming (D20).

## Architect's decisions

### D8. API mounted at `/api`; under it, never HTML and never a redirect

**Status: refined by D35.** The rule stands; the mount becomes
`/api/<org>/<board>` (local: `/api/local/main`, with `/api` as an alias).

- **Context.** Upstream's Node transport treats any `text/html` 2xx/401/403
  answer, a 401 with `x-vercel-error`, or a redirect to `/sso-api` as Vercel
  Deployment Protection and fails (`src/client/node.ts`, `through()`). An SPA
  fallback on the API path would break every upstream client.
- **Decision.** `BOARD_URL = <origin>/api`; SPA served only outside `/api`,
  `/mcp`, `/auth`; unknown API paths answer JSON 404; no redirects (both `/api`
  and `/api/` answer discovery).
- **Consequence.** Browser login lives at `/auth/*`, outside the mount.

### D9. IDs and cursors are log positions in decimal

**Status: superseded by D33** (positions in each board's own log).

- **Context.** Conformance needs strings of 1 to 128 characters; upstream's
  local board uses log positions and lets a message ID act as a cursor.
- **Decision.** `events.id` is the cursor; a message's ID is the cursor of its
  `message.posted`; `version` is the last event ID that changed it.
- **Consequence.** Cheap, ordered, self-describing; cursors reveal board
  activity volume, as upstream's do (accepted).

### D10. Synchronous folds in the write transaction; one writer

**Status: superseded in part by D33.** Folds in the write transaction stand;
"one writer" becomes one writer per board at a time, across instances.

- **Context.** Upstream uses `experimental-a2` with asynchronous consumers
  (`board_positions` in `src/store/sql.ts`). Every conditional write in the
  protocol (claims, `label if`, reply `after`, `revision`) must be race-free.
- **Decision.** Each command runs in one `BEGIN IMMEDIATE` transaction on one
  connection: decide, append events, fold them into derived tables, insert
  outbox rows, commit. Reads use a second, read-only connection.
- **Consequence.** Read-your-writes everywhere; "of three racing claims
  exactly one wins" holds by construction; no consumer lag or positions to
  manage. Throughput is bounded by one core, far above our budgets.

### D11. The board issues credentials (deliberate difference from upstream)

- **Context.** Upstream has no board-specific secret, account, or login: an
  agent borrows an identity a platform verified (a person's Vercel login
  exchanged for a 12-hour OIDC token, a GitHub Actions token, a deployment's
  OIDC token), audience-bound to the board, and "the board issues no
  credentials" (`docs/01-board/09-access.md`, FAQ;
  `docs/01-board/03-identity.md`). We run off Vercel, with no platform to
  vouch for laptops, sandboxes, or orchestrators.
- **Decision.** OpenBoard issues opaque credentials: connection secrets
  (`obc_`), claimed agent tokens (`obt_`), personal tokens (`obp_`), session
  cookies. It keeps upstream's zero-secret path for CI (GitHub Actions and any
  OIDC issuer a grant names, verified locally).
- **Consequence.** A shared secret exists at all, which upstream avoids. We
  contain it: secrets are hashed, prefixed for scanning, scoped by a grant,
  expirable, rotatable, revocable with cascade, and the sandbox path does not
  need the long-lived secret inside the VM (D12). Everything after
  verification (profiles, grants, `x-board-can`, who-edits-what) is
  upstream's.

### D12. Connections are principals; agents are their profiles; three modes

**Status: amended by D34** (a connection belongs to one board of one
organization; its secret is rejected at any other `BOARD_URL`).

- **Context.** Agents must connect with `BOARD_URL` and one secret; many
  agents may share one secret yet each write as itself and be revocable.
  Upstream models an agent as a profile of a principal (`x-board-profile`,
  "claude via julian"), and sandboxes through a proxy that pins profile and
  `can` (`docs/03-guides/06-sandboxed-agents.md`).
- **Decision.** A connection is a principal `ob:conn:cn_…` holding one grant
  and one secret. Mode 1 (direct): the secret is the bearer, profile from
  `x-board-profile`. Mode 2 (claim): the secret is exchanged for a short-lived
  token with the profile and a narrowed `can` pinned server-side, returned as
  a plain `env` object, refreshable to a hard cap, with a fixed list of routes
  it can never reach (mirroring upstream's sandbox policy). Mode 3 (proxy or
  MCP gateway): the secret stays outside the VM and the proxy injects
  headers, as upstream.
- **Consequence.** The upstream client works in all modes with only env vars;
  "fixer-2 via armada-fixers" falls out of upstream's profile rules; a
  claimed agent edits only what it wrote and owns only tasks it made.

### D13. Opaque 256-bit tokens, SHA-256 at rest, fixed prefixes

- **Decision.** `ob[ctp]_<id>_<43 chars base64url>`; the ID selects the row,
  the SHA-256 is compared in constant time; 60 s auth cache invalidated on
  revoke.
- **Consequence.** No JWT/JWKS to run; a token is meaningful only to the board
  that issued it (our audience binding); secret scanners can match the prefix.

### D14. People: a pluggable verifier chain; GitHub OAuth first

**Status: superseded by D34.** The verifier chain and provider seam stand;
"GitHub organizations allowed" and `OPENBOARD_OWNERS` become self-host
options; people now have accounts, organizations, memberships, invitations.

- **Decision.** Ordered credential verifiers plus a `LoginProvider`
  interface. GitHub OAuth restricted to configured orgs is the first provider
  (env-configured, nothing TVC-specific). People are `ob:user:u_…`,
  provider-agnostic, linked through an `identities` table. CLI login is a
  board-run device flow that yields a personal token.
- **Consequence.** A second provider is one file; principals do not change if
  a provider is added or a login is renamed.

### D15. Outbound webhooks (deliberate difference from upstream)

- **Context.** Upstream: "The board never calls a URL it was handed at
  runtime: only code you deployed runs" (`docs/01-board/06-watchers.md`).
  Requirement C needs the board to wake external code.
- **Decision.** Webhook subscriptions call URLs configured at runtime, with:
  `manage` required at every pattern the filter can match, per-delivery
  re-check of the creator's read access, an SSRF policy (https, public
  addresses only, checked per attempt, no redirects), and a transactional
  outbox with at-least-once delivery, per-thread ordering, backoff, dead
  letters.
- **Consequence.** A new attack surface we own (SSRF, exfiltration) and
  mitigate in [auth.md](./auth.md#ssrf-on-webhook-urls).

### D16. Receiver-dictated signing and body templates

- **Context.** The receiver (an orchestrator's trigger, GitHub
  `repository_dispatch`, a small service) decides how it verifies and what
  body it accepts; Stan wants zero glue code and no hardcoded receiver.
- **Decision.** A signing scheme is a small closed set of fields (algorithm,
  header names, format, encoding, signed-payload template with `{ts}`, `{id}`,
  `{body}`, timestamp format) with presets (`standard-webhooks` default,
  `github`, `stripe`, `ts-id-body`, `none`); bodies may be JSON templates with
  `{{path}}` placeholders over a stable, versioned payload.
- **Consequence.** Armada's trigger, GitHub, and generic receivers are
  configuration. The same scheme object verifies inbound endpoints (D18).

### D17. Watcher registrations keyed by actor, not principal

- **Context.** Upstream keeps one registration per principal. Many agents
  share one connection principal and would replace each other's registration.
- **Decision.** Key registrations by actor (principal or principal+profile);
  `owner` in views is the actor ID.
- **Consequence.** Identical to upstream when no profile is used (conformance
  registers as the principal). Narrowed callers, including claimed tokens,
  still cannot register (upstream rule).

### D18. Inbound endpoints with declarative rules

- **Context.** The return path from an orchestrator (turn finished, sandbox
  expired) must map to board writes without orchestrator-named code.
- **Decision.** A signed `POST /x/inbound/:id/events` verified with a D16
  scheme, deduplicated by the sender's event ID, finds the board thread from
  a templated field and a regex, then runs a closed list of actions (`reply`,
  `label`, `react`, `task.block`, `task.unblock`, `task.cancel`,
  `task.expire`, `agents.revoke`). The endpoint is its own principal with its
  own grant.
- **Consequence.** `task.expire` ends a claim early by appending upstream's
  `task.expired`, so the wire stays upstream's. Fenced task writes
  (`complete`, `fail`, `release`) stay with the agent that holds the claim.

### D19. Platform sync deferred; registration answers 403

- **Context.** Sync is most of upstream's code and not needed for v1.
- **Decision.** Discovery `sync: []`; `POST /watchers` with `sync` entries and
  sync's record routes answer 403 `forbidden`; the conformance kit then skips
  every sync check ("this token can't register a sync here",
  `registerSync()` in `src/conformance/index.ts`) except `noSync` read-back,
  which passes.
- **Consequence.** The task check "an edit of the root by someone else blocks
  it" is skipped by the kit (it imports via sync); we implement and test the
  behaviour ourselves.

### D20. Contract in TypeBox (JSON Schema native)

- **Decision.** Operations are described with TypeBox schemas: static types
  for handlers and SDK, JSON Schema for OpenAPI and MCP tool schemas, compiled
  validators for speed. One table holds method, path, schemas, permission,
  errors, and projection hints (CLI flags, MCP exposure).
- **Consequence.** No Zod at runtime; OpenAPI needs no conversion step.
  Alternative considered: Zod 4 with its JSON Schema export (heavier,
  interpreted).

### D21. No web framework, no ORM

- **Decision.** `Bun.serve` with a static route table and our own dispatch;
  `bun:sqlite` prepared statements.
- **Consequence.** Smallest memory and latency; a few hundred lines of
  routing we own. Revisit only if routing code grows past that.

### D22. Search is `LIKE` on a lowercased column first

- **Decision.** `text_lower LIKE` with escaping, as upstream's SQL store;
  FTS5 trigram only if the 25 ms budget at 100k messages is missed (and only
  after confirming Bun's Linux SQLite has FTS5).
- **Consequence.** Exact upstream semantics (`%` and `_` literal, any case)
  with no index to keep consistent.

### D23. Extensions under `/x/`; `ob.*` events never on `/events`

- **Decision.** Every OpenBoard route lives under `/x/`; configuration and
  audit events are `ob.*`, stored in the log, served only by `/x/audit`.
- **Consequence.** No collision with future upstream routes; upstream clients
  never see an event type they do not know.

### D24. Sleep: lazy expiry everywhere; recommend always-on with schedules

**Status: superseded for the hosted service by D36 and D38** (always-on,
jobs on any instance). Lazy expiry stands in both modes.

- **Context.** A sleeping process fires no timers.
- **Decision.** Lease and match expiry are lazy (computed from stored times on
  every read and write); schedules, retries, and sweeps are persisted and
  re-armed on boot; overdue schedules send once, as upstream's "downtime
  doesn't replay". Recommend always-on when the board has schedules or
  webhooks.
- **Consequence.** Correctness never depends on being awake; punctuality of
  schedules does. Open question Q1.

### D25. Backups: `VACUUM INTO` snapshots plus log shipping, not Litestream

**Status: local mode only; hosted backups in D38** (provider PITR where
available, per-organization log shipping, daily `pg_dump`).

- **Decision.** 6-hourly local snapshots; when S3-compatible storage is
  configured, upload snapshots, ship new log events every 10 s as compressed
  segments, upload attachments content-addressed, all with Bun's built-in S3
  client. Restore = snapshot + replay.
- **Consequence.** One process, RPO about 10 s, restore uses our normal fold.
  Litestream stays a fallback since the database is a plain SQLite file.

### D26. Attachments on the volume, ≤ 4 MB, content-addressed

**Status: superseded by D39** (blob port: filesystem locally, S3-compatible
storage hosted, per-organization keys).

- **Decision.** Files under `blobs/sha256/`, rows in `attachments`; direct
  uploads answer 501 `no_direct_uploads`, as upstream's `local()`.
- **Consequence.** Volume size bounds attachments; offsite copy rides on D25.

### D27. Upstream built-in schemas shipped as data, with notice

- **Decision.** `git-commit@1` and `vercel-deployment@1` definitions are
  copied from upstream's `src/contract/data-schemas.ts` (Apache-2.0), listed
  first with `builtIn: true`, their names reserved.
- **Consequence.** Conformance's schema checks pass; the repository keeps
  upstream's license notice for the copied data.

### D28. MCP: stateless Streamable HTTP with bearer auth

- **Decision.** `POST /mcp`, JSON responses, tools generated from the
  contract, auth through the same chain (bearer, profile, `can` headers).
  Long waits capped at 25 s per tool call.
- **Consequence.** Works with MCP clients that accept custom headers and with
  gateways that inject them; clients that require OAuth discovery do not work
  yet (Q4).

### D29. Recoverable secrets encrypted with `OPENBOARD_SECRET_KEY`

- **Decision.** Webhook signing secrets, receiver headers, and inbound verify
  secrets are stored AES-256-GCM encrypted under a key held only in the
  service's environment; bearer credentials are only ever hashed.
- **Consequence.** A stolen volume or backup does not yield usable secrets;
  losing the key means re-entering those secrets.

### D30. A claimed token refuses a different profile instead of overwriting it

- **Context.** Upstream's sandbox proxy overwrites `x-board-profile`, so
  `vb --as` in the sandbox "changes nothing".
- **Decision.** The server pins the profile; a request naming another profile
  gets 403 with the pinned name in the message.
- **Consequence.** Same security property; a misconfigured agent finds out
  instead of silently writing under a name it did not ask for.

## High availability and multi-tenant SaaS

Stan's N1 to N9 (given), with the architect's choices inside them.

### D31. One codebase, two deployment modes (given, N1)

- **Context.** Stan wants high availability and a hosted multi-tenant SaaS,
  while `ob serve` on SQLite stays ideal for testing.
- **Decision.** Local / single-node: `ob serve` or `openboard serve` on SQLite,
  zero setup, the D8 to D30 design. Hosted: Postgres, two or more stateless
  instances behind a load balancer, rolling deploys with no downtime, no state
  that lives only in one process.
- **Consequence.** Supersedes D3 in part and D4 for the hosted service.
  Everything above the store and blob ports is shared code.

### D32. Store port: shared SQL with a thin dialect layer; Bun's SQL client (N2)

- **Context.** Two engines must pass one store test suite and the conformance
  kit without an ORM and without doubling the work.
- **Decision.** Core sees only the `Store` port's scoped views (domain
  operations bound to a tenant). Both drivers implement them from one shared
  SQL module, written once through a tagged template that renders per engine; the schema avoids what the engines disagree on (64-bit
  integers, millisecond `BIGINT` times, JSON as text, `ON CONFLICT`,
  `RETURNING`). Drivers own DDL, placeholders, the board lock, notify, and
  engine-only indexes. Drift is caught by the shared store suite, an `EXPLAIN`
  of every registered statement on both engines, a schema-parity test, and the
  conformance kit on both modes. Postgres client: Bun's built-in SQL.
- **Evidence.** Measured on Bun 1.4.2 against Postgres 17.11: transactions,
  `listen`/`notify`, re-listen after a server restart, pipelining of
  statements awaited together inside `sql.begin` (with a ~10 ms injected round
  trip: `begin` + 1 query took 35 ms, `begin` + 3 sequential 59 ms, `begin` +
  3 with `Promise.all` 35 ms), `BIGINT` decoded as strings, rollback leaving
  the board head unchanged on a failed statement. Rejected: each driver
  implementing the views with its own SQL (doubles every query, invites
  drift); `pg`
  (older design). Fallback: `postgres` (porsager), untested on Bun 1.4.2.
- **Consequence.** One implementation of every command and query; a write on
  Postgres is 4 round trips (`BEGIN`, lock + load, pipelined writes, `COMMIT`).

### D33. Tenancy keys everywhere; per-board serialization by row lock (N3)

- **Context.** Every row and ID resolution must be scoped by organization and
  board; on Postgres several instances write; the protocol needs a strict
  per-board order and race-free claims.
- **Decision.**
  - Shared tables keyed by `org_id` and `board_id`, primary keys led by
    `board_id`; not schema- or database-per-tenant (migration and pool cost
    at thousands of small tenants).
  - No Postgres RLS in v1: setting the tenant per transaction costs three
    more round trips on every read (measured in D56). Isolation by construction (only the tenant
    resolver mints a `BoardScope`; store functions take it; a static check
    that every statement filters on `board_id` or `org_id`; a tenant
    isolation test suite). `org_id` on every row keeps RLS a later option.
  - Every board write starts with `SELECT … FROM boards WHERE id = $1 FOR UPDATE`;
    event IDs are `head + 1…` under that lock, so they are gap-free and commit
    in ID order, which makes `id > cursor` reads complete. Sequences rejected
    (IDs out of commit order); advisory locks would work but give no counter.
  - IDs and cursors are decimal positions in each board's log.
- **Evidence.** Three connection pools racing one claim on Postgres 17
  produced exactly one winner (`["won", "task_claimed", "task_claimed"]`).
- **Consequence.** Supersedes D9 and D10 in part. Writes to one board are
  serialized across instances (≥ 300/s per board at a 0.5 ms round trip);
  boards write in parallel.

### D34. Accounts, organizations, memberships, invitations (N4)

- **Decision.** Users with pluggable sign-in identities (GitHub built; Google
  and email magic link designed as `LoginProvider`s, not built);
  organizations; memberships many-to-many with roles `owner`, `admin`,
  `member`; link and email invitations (single use, 7 days, optional verified
  email binding); sign-up creates the person's organization (with board
  `main`) or joins one through an invitation. v1 enforces one organization per
  person (409 `already_in_org`). Members are capped to read/post/react/label on
  boards unless a grant gives more; admins and owners are uncapped. Sessions
  are per person; personal tokens per organization; connections, grants,
  webhooks, inbound endpoints, schedules, and agent tokens per board. CLI
  sign-in is a board-run device flow that picks the organization; `ob use`
  picks the board; `whoami` shows person, organization, role, board,
  credential. No automatic account linking by email.
- **Consequence.** Supersedes D14; amends D12. An org switcher later needs
  only UI and lifting the one-membership rule (URLs, sessions, and tokens are
  already shaped for it).
- **Last owner (ticket 150, issue #151).** Demoting or removing the last owner
  returns 409 `last_owner` with message “an organization keeps at least one
  owner” and hint “promote another member to owner first”. Check for another
  owner inside the same organization write transaction as the membership change.

- **Email-bound invitations (ticket 148):** accept only when the signed-in
  person's verified provider email matches the invitation, case-insensitively.
  A missing or different verified email returns 403 `invitation_email_mismatch`
  without consuming the invitation.

### D35. Board URLs are paths: `/api/<org>/<board>` (N5)

- **Context.** Upstream's client requires discovery `url` and `audience` to
  equal `BOARD_URL` exactly and treats HTML or certain redirects under the
  API as Vercel Deployment Protection (`src/client/node.ts`).
- **Decision.** Hosted `BOARD_URL = https://<host>/api/<org>/<board>`; local
  `http://127.0.0.1:<port>/api/local/main` (alias `/api`). Account and
  organization API at `/api/x/…`, board extensions at `{BOARD_URL}/x/…`, MCP at
  `/mcp/<org>/<board>`. Slugs immutable in v1, reserved list. Discovery
  answers from the URL alone (no existence oracle). Subdomains per
  organization rejected for v1: wildcard certificates and DNS on Railway
  (unverified support), split sessions, for an origin-isolation benefit that
  one-organization-per-person and CSP mostly cover.
- **Consequence.** Refines D8. `BOARD_URL` plus one secret is still a full
  connection; GitHub Actions OIDC audiences are per board.

### D36. Cross-instance fan-out and jobs on Postgres (N6)

- **Decision.** Fan-out: `pg_notify` inside each write as a wake-up, events
  read by cursor per board per instance, a 2 s safety poll of board heads,
  and a full re-read on listener reconnect. Jobs (schedule sends, lease
  expiry, webhook deliveries, retention, GC, rollups, log shipping): picked by
  any instance with `FOR UPDATE SKIP LOCKED`, executed as board writes with
  unique keys (exactly-once effects); webhook sends at-least-once with stable
  delivery IDs; inbound events processed in the request in one transaction
  with their dedupe row. Migrations expand/contract under an advisory lock,
  run before start; `/healthz` and `/readyz`; drain on `SIGTERM`.
- **Evidence.** `listen` re-subscribed after a Postgres restart (measured).
- **Consequence.** Any instance serves SSE and long-polls; no sticky
  sessions; a lost notification costs at most 2 s.

### D37. Failover must not reuse cursors

- **Context.** With asynchronous replication, a failover can lose the last
  commits; the new primary's board head would be lower than cursors clients
  hold, and reused IDs would be skipped by those clients. The v1 database is a
  single node (D38), so this applies from the day `OPENBOARD_DATABASE_URL`
  points at a failover cluster.
- **Decision.** Ship a timeline guard before that day: each write compares
  the server timeline with `boards.timeline` and, on change, advances `head`
  by 1,000,000 before allocating IDs. Synchronous replication to one replica is
  the stronger alternative if the chosen cluster allows it.
- **Consequence.** No client skips new events after a failover; lost events
  stay lost. The lock statement reads the timeline in the same round trip, and
  a board whose recorded timeline is `0` (never written by the guard) records
  it without advancing. On Postgres 17 a plain non-superuser role may call
  `pg_control_checkpoint()` (checked in ticket 185), so the app role needs no
  grant unless the provider revoked it. Unverified: the same on Railway's role
  (staging, ticket 189); whether Railway's HA cluster allows
  `synchronous_mode` without becoming self-managed.

### D38. Railway Postgres, one node; failover-ready code (given, N7)

- **Context.** Stan chose Railway's Postgres with a single node ("postgres de
  railway et un noeud"), while wanting high availability for the app.
- **Decision.** Hosted database: Railway Postgres, one node, on the app's
  private network. The app tier is redundant; the database is the one single
  point of failure, stated as such. The code is failover-ready from the first
  hosted release (reconnect with backoff, fail-fast 503 `unavailable`,
  idempotent retries only, listener re-subscription and catch-up by cursor, no
  session-pinned state, timeline guard, a kill-the-database drill in CI), so
  moving to Railway's HA conversion or any failover Postgres is a change of
  `OPENBOARD_DATABASE_URL` only. Backups: Railway's scheduled volume backups
  (daily kept 6 days, weekly 27, monthly 89; no PITR described) plus our
  per-organization log shipping to a bucket every 10 s and a daily `pg_dump`.
- **Evidence (vendor pages, 2026-11-23).** Railway backups docs (schedules,
  retention, restore into a new volume, "Wiping a volume deletes all
  backups"); Railway HA docs (Patroni, etcd, HAProxy; failover "within
  seconds"; no published SLA). Alternatives considered: Neon (failover and
  PITR, but off Railway's private network, and every write is 4 round trips);
  Supabase (PITR paid add-on, SLA Enterprise only).
- **Consequence.** Supersedes D4, D24, D25 for the hosted service. Honest
  objective 99.5% monthly in this topology (99.9% after moving to a failover
  database). A database restart means fast 503s and no acknowledged loss;
  losing the volume means up to ~10 s of events lost (log shipping) and a
  restore measured in hours.

### D39. Blob port: filesystem locally, Postgres `bytea` hosted, object storage by threshold

- **Decision.** Attachments behind a blob port; hosted v1 stores them in a
  Postgres `blobs` table (`bytea`, ≤ 4 MB each, keyed by organization and
  SHA-256, no dedupe across organizations), streamed through the app. Move to
  an S3-compatible driver when blob bytes pass about 20 GB or half the
  database, or when files over 4 MB are wanted.
- **Consequence.** Supersedes D26. Instances stay stateless with no second
  storage service for files; blobs share the database's transactions, export,
  deletion, and backups (and make dumps bigger, hence the threshold).

### D40. SaaS seams with v1 minimums; billing out of scope (N8)

- **Decision.** Designed seams: quotas, per-organization rate limits, usage
  metering (daily rollups), organization export (the log-shipping format,
  importable into `ob serve`), organization deletion (soft, then hard after 30
  days), audit of administrative actions, webhook abuse controls, tenant
  isolation tests, operator access audit. v1 must enforce: the SSRF guard
  with no tenant override, count and size quotas, per-organization rate
  limits, audit, deletion, and the isolation suite in CI. Billing is out of
  scope.

### D41. Budgets per mode, targets until measured (N9)

- **Decision.** [architecture.md](./architecture.md#efficiency-budgets) is the
  single source of the numbers, per mode, and they are targets until
  measured baselines replace them: the local (SQLite) baseline at milestone M1,
  the hosted (Postgres) baseline at milestone M5. Hosted writes: one transaction, 4
  round trips, loads read with the lock, fold statements pipelined.
- **Consequence.** Updates D5.

### D42. Names: server binary `openboard`, CLI `ob`; secrets never in argv

- **Decision.** `openboard serve|migrate|restore|reproject|version`; `ob` is
  the CLI, and `ob serve` starts the same server locally on SQLite. A secret
  is never a command-line argument: `ob connect <url> --as <name>` reads it
  from stdin, `--secret-file`, or `OPENBOARD_SECRET`. Environment variables
  use the `OPENBOARD_` prefix.

### D43. The conformance credential is a direct connection with `*=all`

- **Context.** The kit changes grants, registers a schema and watchers; a
  claimed token cannot reach those routes; an owner run skips the lockout
  check.
- **Decision.** Run the kit with a mode-1 connection whose grant is
  `*=all`: on the local board (created with the local owner token) and on a
  board of a dedicated staging organization in hosted mode
  ([auth.md](./auth.md#the-credential-that-runs-conformance)).
- **Consequence.** The lockout check runs; app, viewer, sync, root-edit-blocks
  (via sync), and upstream's unspecified checks are skipped.

### D44. No CODEOWNERS; the orchestrator reviews and merges every pull request

- **Context.** Coding agents open pull requests under the owner's GitHub
  account, so GitHub can neither request the owner's review on them nor let
  anyone approve them. Routing guarded files to the owner (ticket 22) could
  never work, and holding guarded pull requests for him stalled the build.
- **Decision.** Stan, 2026-11-23: no CODEOWNERS file. Every pull request ships
  through the `ship-pr-dev` skill, whose `review-code-dev` pass is the
  independent review; the orchestrator re-runs the ticket's acceptance
  criteria, reviews the diff and merges, guarded files included. An agent
  never merges its own pull request.
- **Consequence.** Ticket 22 is dropped. A pull request that touches a guarded
  file says so in its body, and one that widens the import graph, adds a
  dependency, lowers a score, raises a budget or weakens isolation says why
  ([codebase.md](./codebase.md) section 3.3).

### D45. A connection's `/me` kind is upstream's `workflow`

- **Context.** Upstream's `/me` `kind` is one of `person`, `agent`,
  `deployment`, `workflow`, `external` (`@vercel/board` 0.54.0 `ActorKind`),
  and mode 1 must work with the stock `vb` CLI and `@vercel/board` client.
  A connection is to OpenBoard what a GitHub repository is to upstream, whose
  principal upstream reports as `workflow`.
- **Decision.** A connection's secret answers `kind: "workflow"` on `/me`;
  the OpenBoard credential kind stays in `openboard.credential`
  (`connection`), and `openboard.role` is null for a credential that is not a
  person's. Writing as a profile is upstream's `agent` (ticket 112).
- **Consequence.** No OpenBoard-only value enters upstream's `kind`; clients
  that need to tell a connection apart read `openboard.credential`.

### D46. A message's `author` is resolved when it is written

- **Context.** Upstream shows a profile through its principal, "fixer-2 via
  laptop", as the message's `author` (`{ id, kind, handle, name, avatar,
  via? }`). A connection's name lives in its record, which the verifier
  already reads; the message view is precomputed at write time.
- **Decision.** The server builds `author` from the verified credential
  (upstream's `ActorView`: `kind` `person`, `workflow`, or `agent` for a
  profile, with `via: { name, environment: null }`) and core stores it in
  the precomputed message view; it is kept out of upstream's
  `message.posted` payload on `/events`. Profile names are lowercased in
  `actor`, `profile` and the handle, and shown as sent in `author.name`; a
  connection's profile must match its `profiles` patterns (403 `forbidden`).
- **Consequence.** Reads need no join to show who wrote what. A renamed
  connection would keep its old name on old messages (names are immutable in
  v1). Avatars (113) add to the same `author`.

### D47. `actor.seen` takes the log position before the write it records

- **Context.** Upstream writes `actor.seen` on an actor's first write, or when
  its display details change, in the same commit and before the write's own
  event. Here every event takes the next log position and a message ID is
  its event's position (D9), so the event costs a position.
- **Decision.** Ticket 53: a write whose author the board does not yet show
  as it is appends `actor.seen` (visibility 1, bookkeeping) at `head + 1` and
  its own event after it, as upstream orders them. The board's record of the
  author is read at the start of the write (`BoardView.write(fn, actor)`): on
  SQLite by the head read itself, so a steady-state write runs no extra
  statement; on Postgres by a statement after the board's row lock, since a
  statement that waited on the lock re-reads only that row.
- **Consequence.** An actor's first message on a board is at position 2, not
  1, and later writes that record who writes (edits, reactions, tasks) use
  the same rule and the same lock read.

### D48. Browser sign-in: `/auth` routes, a pending-sign-in cookie, account routes under `/api/x`

- **Context.** GitHub sign-in (ticket 133) redirects, which nothing under
  `/api` may do (D8), and must hold its `state` and PKCE verifier between two
  requests that may reach different instances. Local mode has "no sign-up",
  yet M4's account tickets are checked on `ob serve`.
- **Decision.** `GET /auth/<provider>/start|callback` are browser routes
  outside the contract, run by `server/src/auth/providers/index.ts` before
  the `/api` router. The pending sign-in (provider, `state`, PKCE verifier)
  lives in the browser, in the cookie `__Host-ob_signin` (10 minutes), never
  in server memory; `LoginProvider.start`/`finish` take the verifier in
  their context. A signed-in person lands on `/new` until memberships exist.
  `account` operations declare paths relative to `/api/x`, are matched
  before the local `/api` alias, and see `ctx.platform` and `ctx.session`
  (the live `__Host-ob_session`, read only without `authorization`); their
  answers are `no-store`. In local mode `OPENBOARD_SIGNUP` defaults to
  `closed`, so it keeps "no sign-up" unless it is set. Verify M4 account
  tickets on local SQLite with `OPENBOARD_SIGNUP=open` and GitHub configured,
  using a fake provider in tests (issue #145). The hosted default (docs/auth.md,
  Q6) is decided with hosted mode.
- **Consequence.** Any instance finishes any sign-in. Ticket 134 and later
  account routes reuse the session and its CSRF check. In the SDK, an account
  operation with an explicit `/api/x` mount uses that mount and sends the
  configured CSRF value for writes. Invitation acceptance declares this mount.

### D49. `org` operations: members read, admins write, under the organization's lock

- **Context.** Ticket 143 added the first `org` operation (creating an
  invitation, admins only). Ticket 153 adds `listBoards`, which any member
  may call, and `createBoard`. Organization events need gap-free IDs per
  organization (docs/data-model.md `org_events`).
- **Decision.** An `org` operation whose `access.permission` is `read` is
  answered for any member (`tenants.memberOrg`); every other one needs an
  owner or an admin (`tenants.adminOrg`, 403 `forbidden` for a member). A
  non-member, like an unknown organization, gets 404, and claimed `obt_`
  tokens get 403. Each organization write starts with the same locking
  statement as invitations: the `orgs` row joined to the writer's admin
  membership, `FOR UPDATE`. It is scoped by `m.org_id`, so no statement is
  exempted from the scope check. The write then numbers its event
  `MAX(id) + 1`, and it writes nothing if the writer is no longer an admin.
- **Consequence.** Later organization writes (members, roles, deletion)
  take the same lock before numbering an organization event, and read
  operations declare `access: { permission: "read", … }` to be open to
  members.

### D50. A profile is held while its agent lives, checked under the board lock

- **Context.** docs/auth.md mode 2 answers 409 `profile_taken` for a profile
  a live agent holds. The data model sketched a unique index on
  `(connection, profile_key) WHERE revoked_at IS NULL`, which would keep a
  profile held after its agent's tokens expired, until someone revoked it;
  no partial index can say "not expired", since that depends on the clock.
- **Decision.** Ticket 125: an agent holds its profile on its connection
  while it is not revoked and its current token has not expired
  (`now < token_expires`, which never passes `hard_expires`). The claim reads
  the connection's unrevoked agent on that profile (any case) whose token
  expires last, inside its board-locked write, and core refuses it while that
  token lives. No unique index: the board lock serializes claims (D33);
  the comment in migration 0004 announcing one no longer holds. A refresh
  likewise checks its token's expiry under the lock, so it cannot revive an
  agent whose profile a claim took meanwhile.
- **Consequence.** Two racing claims of one profile: one 200, one 409. A
  sandbox relaunched after its agent expired claims the same profile again.
  A profile is per connection: another connection's agent never holds it.
  Ticket 126 lets a claim with the holder's `idempotencyKey` through; ticket
  129's revoke frees the profile by setting `revoked_at`.

### D51. A connection's last use is its latest event; its hint never shows a prefix

- **Context.** Ticket 131 lists connections with their last use, and no
  `obc_` or `obt_` value. `last_used_at` columns exist but nothing sets them,
  and stamping every authenticated request would add a write to every read.
  The hint was the secret's first and last four characters, so it began with
  `obc_`.
- **Decision.** Last use is the time of the latest event whose principal is
  the connection: a write by its secret or one of its agents, or a claim or
  refresh. Reads do not count. A partial index on `events`, limited to
  connection principals and built concurrently, finds it (SQLite names it with
  `INDEXED BY`, as it plans without statistics). The hint is `…` and the secret's last four
  characters; a rotation keeps the secret's ID, so its first characters never
  told two secrets apart.
- **Consequence.** A connection whose agents only read shows its last claim
  or refresh. A hint stored before this change, with the prefix, is shown in
  the new form. The listed agents are the live ones (D50): unrevoked, token
  unexpired.

### D52. Personal credential details on `GET /me`

- **Context.** The CLI sign-in example shows a personal token's name and expiry.
  The original response gave the CLI the kind and expiry but no token name.
- **Decision.** Issue #159 adds an optional top-level OpenBoard-only
  `credential` object with `kind`, `name?`, and `expiresAt?`.
- **Consequence.** `ob whoami` can show the recorded token name and expiry.
  Existing upstream fields and the OpenBoard kind remain available.

### D53. A subtree read needs read throughout the subtree

- **Context.** Ticket 88 lets `GET /threads` take `channel=dev/`, upstream's
  subtree pattern. A `can` may grant `dev/` and withhold a channel under it
  (`{ "dev/": ["read"], "dev/secret": ["post"] }`), and the list does not
  filter its threads by what the caller reads.
- **Decision.** An operation whose input channel is a subtree needs the
  permission at the pattern and at every pattern of the caller's `can` inside
  it (the channel itself included), as a board-wide read needs it at `*` and
  under every other pattern. Otherwise it is 403 `forbidden`.
- **Consequence.** A caller narrowed inside a subtree reads it channel by
  channel, or a smaller subtree it reads throughout. Later subtree filters
  (events, tasks) reuse the same check.

### D54. What an isolation ID case accepts

- **Context.** Ticket 135 generates the tenant isolation cases from the
  contract (docs/codebase.md 6.5). A `Ref` field does not always answer 404 for
  an ID its board lacks: `after` in `postMessage` answers 400 `invalid_after`,
  `after` in `readThread` 400 `invalid_request`, as they do for any ID that is no
  message of the thread.
- **Decision.** ID cases cover every `Ref` field of every `board`, `org` and
  `account` operation, called as A's owner on A's own URL. A case with B's ID
  passes when its answer carries none of B's names and has the same status and
  error code as the same call with an ID no board holds: B's ID must be
  indistinguishable from an unknown one. A message ID both boards hold is tried
  on read-only operations and must answer 200 with A's message; seeded messages
  carry their own ID as client ID, so `readPost` gets the same cases. Every
  case's input is checked against the contract first, so none passes by
  stopping at validation. Path cases send B's own IDs and input to B's board or
  organization and expect exactly 401 `unauthorized` (a board-bound credential
  off its board) or 404 `not_found` (a person outside the organization). B's
  digest is what B's owner reads through every read-only operation, plus `/me`
  with each of B's board-bound credentials and B's invitation preview. An
  invitation's token is a capability, not a tenant ID: the seed's `invitation`
  ID is its `inv_` ID. The storage twin types one case per `BoardView`,
  `BoardWriter` and `OrgView` member, so a port method without a case does not
  compile.
- **Consequence.** A new operation needs a sample input in
  `packages/server/test/isolation/cases.ts` only when its body or query has
  required fields (the suite says so), and a new `Ref` kind needs a seed. No
  case is ever excluded.

### D55. Postgres concurrent index migrations run outside a transaction

- **Status:** accepted ([issue #242](https://github.com/The-Vibe-Company/openboard/issues/242)).
- **Decision.** Run a Postgres migration containing `CREATE INDEX CONCURRENTLY`
  one statement at a time outside a transaction. Keep these migrations limited
  to concurrent index builds so every statement can be retried. Keep valid
  indexes from previous attempts and remove invalid indexes before rebuilding.
  Record the version in `schema_migrations` after every statement succeeds.
- **Consequence.** Other migrations and their version records commit together
  in one transaction. SQLite renders away `CONCURRENTLY` and applies all
  migrations inside transactions.

### D56. What Postgres row-level security costs, measured

- **Status:** proposed; the owner decides ([issue #255](https://github.com/The-Vibe-Company/openboard/issues/255)).
  Until then D33 stands: no RLS in v1.
- **Context.** D33 kept RLS out of v1 because the tenant must be set per
  transaction, which turns every single-statement read into a transaction.
  M5 measures what that costs before the choice is final.
- **Measurement.** `packages/driver-postgres/bench/rls.ts` (run with
  `OPENBOARD_TEST_DATABASE_URL`) seeds a scratch database cloned from the
  migrated template with the bench workload: 2,000 posts and 2,000 replies on
  the measured board, 400 posts on each of nine other organizations' boards.
  It then adds `org_id = current_setting('app.org_id')::bigint` policies to
  the 13 tables that carry `org_id`, on that database only, and checks that
  they apply: the RLS store, set to organization 1, reads 0 of 50 messages on
  organization 2's board. It times the store's channel read (the latest 50)
  and its post, 1,000 of each per variant after 100 warm-up runs. The three
  variants alternate operation by operation, and the one that goes first
  rotates. `plain` is the driver's views and statement runner as they ship.
  `tenant` runs every statement in a transaction that first calls
  `set_config('app.org_id', $1, true)`, as a superuser, so the policies are
  bypassed: its cost is the extra round trips alone. `rls` is `tenant`
  connected as a role the policies apply to. Before timing, the bench checks
  that `tenant` and `rls` read the same 50 messages as `plain` on their own
  board. Round trips are the statements the driver's counter saw, `BEGIN` and
  `COMMIT` included.

  | Operation | Variant | p50 ms | p99 ms | Round trips |
  |---|---|---|---|---|
  | channel read | plain | 0.15 | 0.24 | 1 |
  | channel read | tenant | 0.29 | 0.42 | 4 |
  | channel read | rls | 0.30 | 0.86 | 4 |
  | post | plain | 0.49 | 0.96 | 7 |
  | post | tenant | 0.53 | 0.86 | 8 |
  | post | rls | 0.56 | 0.85 | 8 |

  Taken on 2026-11-24 on PostgreSQL 17.12 (PGDG build for Debian 12, UTF8,
  default settings, no Docker) over loopback TCP, on a VM with an AMD EPYC
  9654, 17 threads and 2.2 GiB. The client was Bun 1.4.2, with one operation
  in flight. Across three runs the round trips were identical, and the p50s
  ranged as follows:

  | Operation | plain | tenant | rls |
  |---|---|---|---|
  | channel read | 0.13 to 0.15 | 0.26 to 0.29 | 0.29 to 0.30 |
  | post | 0.48 to 0.50 | 0.51 to 0.53 | 0.52 to 0.57 |

  The p99s varied more: a read took 0.21 to 0.24 ms plain, 0.40 to 0.81 ms
  with the tenant set, and 0.38 to 0.86 ms with RLS. The extra round trips
  are the cost. Setting the tenant doubles a read's p50; evaluating the
  policies on top (`rls` minus `tenant`) is within run-to-run noise, at most
  about 0.05 ms at p50. All three pools are opened alike, without the
  shipped pool's timeout settings, which do not change latency. On
  loopback a round trip costs about 0.05 ms. On a network round trip of
  0.5 ms (D33's figure), three extra round trips would add about 1.5 ms to
  every read statement, and one extra round trip about 0.5 ms to every
  write. That is an estimate, not a measurement.
- **What turning it on would also take.** The tenant has to reach the
  driver's `Db` with each transaction; today the views pass only SQL and
  values. The platform statements (a board by its slugs, a person's
  memberships, an invitation by its hash, device codes) run before a tenant is
  known, on tables the policies cover, so they would need a second role or a
  policy exception. Each would be one more place where isolation can break.
- **Recommendation.** Keep RLS off in v1, as D33 decided. Isolation is
  already enforced by construction (only the resolver mints a scope), by the
  statement scope check, and by both isolation suites on both engines. RLS
  would double the cost of the most frequent operation, a read. If the owner
  wants defense in depth later, set the tenant once per request instead of
  once per statement: one transaction around the request's reads costs 3
  round trips per request, not per statement. That variant is not measured
  here. The bench would measure it before any ticket turns RLS on.

## Hard blockers found

None. Limits worth knowing:

- **The single-node database is the availability ceiling** (D38): 99.5%
  monthly is the honest objective until it is replaced by a failover cluster.
- **Write latency on Postgres** is 4 round trips with Bun's SQL client; fewer
  would need one SQL statement per command, which duplicates fold logic.
- **`NOTIFY` serializes notifying commits** database-wide; the safety poll is
  the fallback if it bites.
- **SSE and long-polls on Bun:** `idleTimeout` is capped at 255 s;
  `server.timeout(req, 0)` exists in Bun 1.4.2 (measured) and is used for
  long-lived requests.

## Open questions for Stan

Only product choices; each has a recommendation.

- **Q1. How should a sandbox get its board credential?** (a) the orchestrator
  claims before launch and injects `env` (secret never in the VM); (b) the
  agent claims a single-use secret itself; (c) the board mints a token per
  webhook delivery inside the delivery body. *Recommendation:* (a), else (b);
  not (c) for now. If Armada's MCP gateway can set a different
  `x-board-profile` per lease (unverified), mode 3 is better still.
- **Q2. Which S3-compatible bucket for log shipping, dumps, and exports?**
  *Recommendation:* Cloudflare R2 (no egress fees). Without a bucket, the RPO
  on volume loss is Railway's last daily backup (up to 24 h).
- **Q3. What availability do we tell tenants?** *Recommendation:* 99.5%
  monthly as an internal objective, no contractual SLA while the database is
  one node and Railway offers no SLA.
- **Q4. Email provider for email invitations (and magic links later)?**
  *Recommendation:* ship link invitations first; add email through Resend or
  Postmark once the sending domain is set up (neither evaluated here).
- **Q5. OAuth for MCP clients in v1?** *Recommendation:* no; bearer headers
  first, OAuth when a client we need requires it.
- **Q6. Sign-up open, or invite-only at launch?** *Recommendation:*
  invite-only beta (`OPENBOARD_SIGNUP=invite`), opened after quotas and abuse
  controls have run for a few weeks.
- **Q7. Are immutable organization and board slugs acceptable for v1?**
  Renaming would break every agent's `BOARD_URL`, and the API may not
  redirect. *Recommendation:* yes; display names stay editable.
- **Q8. Platform sync (Slack, GitHub) in the first release?**
  *Recommendation:* no.
