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
  OIDC issuer a grant names, verified locally). Grant-named issuers use a
  shared public-host guard, same-origin discovery and keys, and an
  organization-wide limit of eight distinct issuers. See [auth.md](auth.md#ci-github-actions-and-other-oidc-issuers)
  for the outbound request limits and remaining DNS rebinding risk.
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

- **Decision.** Local SQLite takes a snapshot at open and every six hours in
  the data directory's `backups/` folder. Keep the eight most recent
  UTC-named snapshots. Preserve a separate `pre-migrate-<version>.sqlite`
  before upgrading an existing database, using the first pending version.
  When S3-compatible storage is
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
  answers from the URL alone (no existence oracle). The organization slug
  supplies discovery's `team_id` (`local` for the local alias), and
  `project_id` is null. Subdomains per
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

The driver registers cross-board job discovery as a platform statement. The
picker returns only the job ID, kind, organization ID and board ID. The runner
uses those keys with the tenant resolver to enter the scoped board writer.
Lease consumption and the database effect commit together.

Issue #744 supersedes the periodic job poll. A committed enqueue publishes
the job's due time through an insert trigger so older writers notify as well.
Each runner keeps one timer for its earliest due job. Startup and re-LISTEN
reconcile the timer with the queue, including any outstanding lease expiries.

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
  it without advancing. The timeline is the WAL insert timeline
  (`pg_walfile_name(pg_current_wal_lsn())`), not `pg_control_checkpoint()`:
  on a promoted Postgres 17.11 standby the checkpoint timeline still read the
  old value seconds after promotion, so writes in that window would have
  reused IDs (ticket 185). Both functions are callable by a plain role, so the
  app role needs no grant. Unverified: the same on Railway's role (staging,
  ticket 189); whether Railway's HA cluster allows `synchronous_mode` without
  becoming self-managed.

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

- **Operator access.** The support role changes tenant state through
  `openboard admin` server commands in a trusted shell with database access.
  The first command is `admin quota <org> <quota>=<limit> --reason "<reason>"`.
  The actor is `ob:operator:<name>` from `OPENBOARD_OPERATOR` or the OS user.
  The action and its `ob.operator.*` event commit in the same transaction
  under the organization's row lock (D49). Owners and admins read the event
  through the existing organization audit route. A missing or blank reason
  or an unknown organization leaves no change or event.

- **Deletion rollout.** The purge handler and enqueue ship together under the job
  rollout rule in codebase.md §5.7. The enqueue is first due at `purgeAt`,
  30 days after soft deletion. A compatible runner can also lease an older
  deletion without a queue row once its original retention period has elapsed.

- **Write throttling.** Each instance admits up to 1,000 writes per organization
  in a burst and refills at 200 writes per second. The aggregate rate scales
  with the number of instances. Authorized writes debit the bucket after
  permission checks so unauthorized requests cannot exhaust it. Scoped reads
  skip the bucket.
- **Client IP.** Ticket 200 uses the socket peer by default and trusts a
  right-indexed `X-Forwarded-For` entry only with an explicit
  `OPENBOARD_TRUSTED_PROXIES` hop count. The same address reaches sign-in
  limits in ticket 205. See docs/auth.md "Rate limits".

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
- **Amendment (ticket 281).** Run the kit a second time on the test board
  with the local owner credential or a hosted organization owner's personal
  token. Use the owner result only for checks the connection skipped. The
  kit can name a person in a grant that keeps the runner inside a closed
  pattern, which lets it exercise grant precedence and related rules.
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
  their context. A signed-in member lands on `/<org>/main`, and a person
  without a membership lands on `/new`.
  Ticket 195 extends the pending cookie with the optional `invitation`
  parameter from the start route. The invitation page's GitHub link records
  the person's intent to join (#381). The start request requires the
  same-origin invitation page as its browser referrer.
  The callback redeems the invitation
  in the person and session transaction for new people, or after committing
  a returning person's session to preserve the redemption lock order.
  On redemption failure it opens a session where sign-up policy allows and
  redirects to `/invite/:token?error=<code>` so the page can show the reason.
  In `invite` mode new people still need a successful redemption. An expired,
  revoked or used invitation for a new person in that mode still produces
  a JSON 410 `invitation_used` at the callback. In `closed` mode only existing
  identities sign in.
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

  On issue #366 the owner chose one 30-attempt-per-minute IP budget shared
  by starts and callbacks across hosted replicas through Postgres, with the
  same counter in local SQLite. Browser routes use the same client IP
  resolution as the API rate limits (D40).

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
  take the same lock before numbering an organization event. Soft deletion
  needs an owner under that lock. The tenant resolver treats a deleted slug
  as unknown, with 404 for every credential on its board routes (issue #368).
  Read
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

### D57. Upstream stubs are marked in the contract and checked by one isolation rule

- **Context.** Sync is deferred (D19), yet upstream's clients call its routes
  (docs/protocol.md "Sync (deferred)", the U-stub rows). Ticket 382 answers them
  as a board with no sync does: 404 `not_synced_here`, 404
  `message_not_found`, empty lists, 403 "this board keeps no sync". Read-only
  stubs never answer 2xx with the caller's data, so D54's list and shared-ID
  checks could not hold for them ([issue #577](https://github.com/The-Vibe-Company/openboard/issues/577)).
- **Decision.** An operation that answers an upstream route as a board without
  the feature does carries `stub: true` in the contract. The isolation suite
  checks a stub by one rule: A on A's board answers exactly as B on B's board
  (same status, same body), A's answer carries none of B's names, and B's IDs
  on A's URL answer as IDs no board holds (D54). A stub's message route still
  reads the message first, so a missing or unreadable one answers 404
  `message_not_found` before the stub's answer. Stubs are `cli: false` and
  `mcp: false`.
- **Consequence.** No expected-failure list: a stub that answered with data, or
  differently for A and B, fails the suite. Building the feature later removes
  `stub` and the ordinary checks apply again.

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

### D58. GitHub as a grant principal

- **Decision.** The upstream `github` principal and `--github` flag are
  board protocol features. An unfiltered principal can name a person by the
  exact subject of their locally linked GitHub identity.
- **Consequence.** GitHub remains the only people sign-in provider. Grant
  creation and resolution use local data, with no GitHub API calls.

### D59. Apply staging image settings through Railway's API

- **Decision.** The staging deploy script defines the settings and applies them
  with the image source through Railway's service instance API. The staging
  replicas run in `europe-west4-drams3a`.
- **Reason.** A config file uploaded through `railway up` left the healthcheck
  and replica settings unset during the owner's staging setup.
- **Consequence.** The deploy command needs a staging-scoped Railway project
  token. It verifies the deployment tag on each replica returned by the API.

### D60. Publish every merge and enable staging deploys explicitly

- **Decision.** Publish the commit-tagged GHCR image on every merge to `main`.
  Deploy it only when the `STAGING_DEPLOY` repository variable is `on`.
- **Consequence.** Disabled deploys are recorded in the workflow summary.
  Enabled deploys require the `staging` environment's `RAILWAY_TOKEN` secret
  and fail if it is missing.

### D61. Promote production after a successful staging rolling check

- **Decision.** The production job in `release.yml` requires a Release Please
  tag for the same commit, `PRODUCTION_DEPLOY=on`, and the `production`
  environment. A completed, successful staging job with a passing rolling
  check qualifies while its workflow is still running.
- **Consequence.** Production promotes the digest already published for staging
  to the version tag. The owner configures the production environment protection,
  Railway project token and HTTPS origin before enabling deployment.

### D62. SSE caps are server settings and the benchmark uses one principal

The server defaults to 20 open SSE streams per principal and 500 per organization
on each instance. The composition root can override either cap through
`ServerConfig.streamLimits`. There is no environment variable before v1.

The local benchmark sets its principal cap to 50 and uses one credential for
all 50 tails, preserving the workload measured for ticket 108. The HTTP cap
tests use the server defaults. ([Issue #367](https://github.com/The-Vibe-Company/openboard/issues/367))

### D63. Board deletion preserves the default board

Organization admins and owners can soft-delete other boards. Deleting
`main` returns 400 `invalid_request` with a hint to delete the organization
instead. The retained row reserves the slug until organization purge.
Authenticated board routes refuse a deleted board's connections and agents
with 401 `unauthorized` and answer 404 `not_found` to people. Public
discovery and OpenAPI continue to answer from the URL alone (D35).
Parked event reads wake on deletion and reauthorize against the tombstone.

### D64. Expand the organization key on legacy board tables

- **Decision.** Ticket 405 adds nullable `org_id` to `grant_principals` and
  `task_needs`. New writers supply it and a startup job fills missing values
  in board-locked batches. Reads keep their existing predicates during rollout.
- **Consequence.** After old writers have drained, the contract phase must
  account for any remaining NULLs before enforcing `NOT NULL` and using both
  keys in grant principal predicates.
  ([Issue #724](https://github.com/The-Vibe-Company/openboard/issues/724#issuecomment-7131785387))

### D65. Local container listening address

- **Context.** Docker port publishing reaches the container over its network
  interface. A loopback-only listener inside the container is unreachable there.
- **Decision.** `OPENBOARD_HOST` defaults to `127.0.0.1` in local mode and
  `0.0.0.0` in hosted mode. The image explicitly sets `0.0.0.0`.
- **Consequence.** The local container accepts requests on the published port
  and uses the same authentication as a loopback deployment. Its owner
  credential is stored on the data volume.


### D66. Task expiry jobs during a rolling deploy

- **Status:** accepted (orchestrator, [issue #418](https://github.com/The-Vibe-Company/openboard/issues/418)).
- **Decision.** The task expiry handler and producer ship together. A runner
  leases only its registered job kinds, so an older replica leaves expiry
  jobs for an upgraded replica. Read-time expiry and reclaim continue to
  apply on upgraded replicas while delivery is pending.
- **Consequence.** Older feed replicas skip `task.expired` during rollout.
  The writer leaves expiry out of the persisted watcher allowlist because an
  older watcher reader can lease every persisted match. Other job kinds
  follow the general release rule in codebase.md §5.7.

### Gateway allowlists for direct connections

The gateway policy takes the routes allowed by the claimed-token guard and
excludes grant routes, watchers, sync records, schema registration, board
extensions and account and organization routes. The gateway enforces the
allowlist and supplies the pinned headers. Claimed-token enforcement continues
to use its existing rules.
([Issue #538](https://github.com/The-Vibe-Company/openboard/issues/538#issuecomment-7135210537))

### Private channel creation uses exact grants

`POST /channels` accepts an optional `private` flag. Both grants target the
exact channel so sibling and descendant channels retain their access. A
pre-existing grant at the exact path that permits access to anyone besides
the creator prevents creation with 409 `channel_granted`. Grants there can outrank or add to the
`everyone` closure. The board lock covers this check and all three events.

### D67. Personal token scope at device approval

- **Status:** accepted (orchestrator, [issue #473](https://github.com/The-Vibe-Company/openboard/issues/473)).
- **Decision.** Device start stores the requested scope and approval records
  the resulting per-board caps. Token management accepts a browser session or an
  unrestricted personal bearer. Narrowed personal bearers receive 403
  `forbidden` on account routes.
