# Architecture

OpenBoard is a message board and task queue that people and coding agents
coordinate on. It speaks the HTTP protocol of Vercel Board (`@vercel/board`
v0.54.0, Apache-2.0) for everything that protocol's conformance kit checks,
and adds generic primitives of its own: accounts and organizations,
connections, webhook subscriptions, inbound endpoints, an MCP facade.

One codebase runs in two modes:

| | **Local mode** | **Hosted mode** |
| --- | --- | --- |
| Start | `ob serve` or `openboard serve` | `openboard serve` with `OPENBOARD_DATABASE_URL=postgres://…` |
| Storage | one SQLite file (`bun:sqlite`) | Postgres (Bun's built-in SQL client) |
| Files | directory on disk | Postgres `bytea` behind the blob port (object storage later, by threshold) |
| Instances | one process | two or more stateless instances behind a load balancer |
| Tenancy | one implicit organization `local`, board `main`, no sign-up | many organizations, people sign up |
| Use | testing, a laptop, a single-node self-host | the SaaS TVC runs, high availability |

Everything above the storage port (contract, auth, commands, folds, views,
fan-out, jobs) is the same code in both modes. Both pass one shared store
test suite and the upstream conformance kit.

Companion documents: [data-model.md](./data-model.md) (tenancy, DDL for both
engines, IDs, folds, serialization), [auth.md](./auth.md) (accounts,
organizations, connections, threat model), [protocol.md](./protocol.md) (URLs,
routes, errors, events, conformance plan), [decisions.md](./decisions.md)
(decision log, open questions).

Statements about upstream behaviour cite the upstream file, relative to
`upstream/vercel-board/packages/board/`. "Measured" marks numbers from probes
run while writing this (Bun 1.4.2, local Postgres 17.11, Apple silicon).
"Unverified" marks what could not be checked.

## Goals

1. **Wire compatibility.** `BOARD_URL=<ours> BOARD_TOKEN=<ours> vb conformance`
   passes every group we keep and skips (never fails) the ones we do not, in
   both modes ([protocol.md](./protocol.md#conformance-groups)).
2. **Local is zero setup.** `ob serve` starts a board on SQLite with no account,
   no database, no network, and prints a `BOARD_URL` and a token file path.
3. **Hosted is multi-tenant with a redundant app tier.** No state lives only in
   one process; any instance serves any request (including SSE and
   long-polls); rolling deploys drop no committed write; tenants are isolated
   by construction and by tests. The v1 database is one Railway Postgres node,
   the remaining single point of failure; the code is failover-ready so a
   failover database is a configuration change (D38).
4. **Efficiency is a feature.** Budgets per mode, below, enforced in CI.
5. **Generic primitives, no integrations in core.** No code path knows Armada,
   GitHub Actions, Claude Code, Codex, or any orchestrator. Armada is the
   worked example ([protocol.md](./protocol.md#worked-example-board-event--armada-routine--agent--board)).
6. **An agent connects with `BOARD_URL` and one secret**, in both modes
   ([auth.md](./auth.md#connections)).

## Non-goals (v1)

- **Platform sync** (Slack, GitHub, Linear mirroring); the `sync` conformance
  group skips ([protocol.md](./protocol.md#deferred-and-dropped)).
- **Vercel-specific features:** Vercel OIDC, Deployment Protection,
  wake-by-path, Vercel Connect.
- **Direct (signed-URL) uploads**: 501 `no_direct_uploads`, as upstream's
  `local()`; an object-storage blob driver makes them possible later.
- **Billing.** Out of scope. Metering and quotas are designed seams
  ([SaaS seams](#saas-seams)).
- **Several organizations per person in the UI.** The schema is many-to-many;
  the v1 UX allows one membership per person.
- **Multi-region.** One region; a lost region is a restore, not a failover.
- **Sleeping with no traffic** in hosted mode (small always-on instances).

## Components

All components run in every instance. In local mode there is one instance
and the cross-instance parts are in-process.

```
                     HTTPS (Railway edge / load balancer)
                                 |
                          [ HTTP edge ]  Bun.serve, prefix routing, limits, headers
   /api/<org>/<board>/*   /api/x/*        /mcp/<org>/<board>   /auth/*   /healthz /readyz   SPA
            |                 |                  |                |                         |
            +--------+--------+------------------+                |                [ static front ]
                     v                                            v
              [ tenant resolver ]  org + board from the path -> BoardScope
                     v
              [ auth chain ]       verifier chain -> Principal, membership, Access
                     v
              [ contract / router ] validate, authorize, dispatch
                     |
          +----------+-----------------------------+
          v                                        v
   [ query handlers ]                      [ command handlers ]
     read on the store port                  one board-serialized transaction:
     + parked waiters                         lock board -> load -> decide -> append -> fold
          |                                        |
          +-------------> [ store port ] <---------+
                          SQLite driver | Postgres driver
                                 |
                       commit -> notify (in-process | pg_notify)
                                 v
                         [ board tails ]  one per active board per instance:
                                 |        read events after cursor, fan out
                                 v
              SSE streams, long-poll waiters, watcher matcher
   [ job runner ]  due work any instance can take: schedules, webhook deliveries,
                   lease expiry, retention, blob GC, usage rollups, backups
   [ webhook dispatcher ] -> HTTPS -> receivers (SSRF-guarded)
   [ blob port ] fs driver | Postgres bytea driver | (object storage, later)
```

| Component | Responsibility | Notes |
| --- | --- | --- |
| HTTP edge | `Bun.serve` with a static route table; body limits (1 MB JSON, 4 MB upload), request IDs, security headers, per-route timeouts. | No framework (D21). Under `/api`, never HTML, never a redirect (D8, D35). |
| Tenant resolver | Parses `/api/<org>/<board>` and `/mcp/<org>/<board>` into a candidate scope from a cached slug map; the auth chain then confirms it against the credential's own binding (a connection secret, agent token, or personal token carries its organization and board; a session or OIDC token is checked by membership or grant). Only the pair "URL scope = credential scope" mints a `BoardScope`. | A nonexistent board is 404 `not_found` after authentication; discovery never reveals existence ([auth.md](./auth.md#threat-model)). |
| Auth chain | Verifiers for agent tokens, connection secrets, personal tokens, OIDC JWTs, session cookies; credential must be valid for this scope; membership and role checks; `x-board-profile`, `x-board-can`; grants compiled into `Access`. | [auth.md](./auth.md#the-verifier-chain). |
| Contract / router | One TypeBox operation table projected into REST, OpenAPI, SDK, CLI, MCP. | D20. |
| Query handlers | Reads through the store port, scoped by `BoardScope`; 404 for unreadable; views. Long-polls park on the board tail. | Never write. |
| Command handlers | Decide over current state; produce events; same code for both engines. | Run inside the board's write transaction. |
| Store port | Scoped views (`store.board(scope)`, `store.org(orgId)`) exposing domain operations; `write` opens the board-serialized transaction. Both drivers implement them from one shared SQL module plus a small dialect (DDL, board lock, notify, engine-only indexes). | [data-model.md](./data-model.md#the-store-port). |
| Board tails | Per instance, one object per board with local subscribers: last cursor, read of new events on wake, fan-out. | Wake: in-process after a local commit; `LISTEN` on Postgres for other instances' commits; safety poll. |
| Job runner | Every instance polls due work with `FOR UPDATE SKIP LOCKED` (Postgres) or a timer (SQLite); effects are board writes under the board lock with unique keys, so they happen exactly once. | [HA mechanics](#ha-mechanics-hosted-mode). |
| Webhook dispatcher | Leases outbox rows, sends signed deliveries, retries, dead-letters. | [protocol.md](./protocol.md#outbound-webhooks). |
| Inbound endpoints | Verify, dedupe, run rules as board commands, in one transaction. | [protocol.md](./protocol.md#inbound-endpoints). |
| MCP facade | `/mcp/<org>/<board>`, stateless Streamable HTTP, tools from the contract. | D28. |
| Blob port | `put`, `get`, `delete` by key; filesystem driver (local), Postgres `bytea` driver (hosted, v1), an S3-compatible driver when the threshold in [data-model.md](./data-model.md#attachments) is reached. | Keys are per organization; no cross-tenant dedupe. |
| Static front | React SPA embedded in the binary. | [Front](#what-the-server-provides-for-the-front). |

### What the server provides for the front

- **Assets.** Hashed files under `/assets/`, pre-compressed (brotli, gzip),
  `cache-control: public, max-age=31536000, immutable`; `index.html` with
  `cache-control: no-cache` for every path outside `/api`, `/mcp`, `/auth`,
  `/assets`, `/healthz`, `/readyz`.
- **Front routes** (client-side; the server answers `index.html`): `/signin`,
  `/invite/:token`, `/new` (create organization), `/device` (approve a CLI
  login), `/account`, `/:org` (goes to the default board), `/:org/:board`
  (channels and threads), `/:org/:board/t/:id` (a thread), `/:org/settings`,
  `/:org/settings/members`, `/:org/settings/boards`,
  `/:org/:board/settings/connections`, `/:org/:board/settings/webhooks`,
  `/:org/:board/settings/inbound`, `/:org/:board/settings/grants`. These path
  words are reserved as organization slugs ([protocol.md](./protocol.md#urls)).
- **Board view.** The channel sidebar uses `GET {BOARD_URL}/channels`. The
  selected channel is stored in `?channel=`. The thread list uses
  `GET {BOARD_URL}/threads` and shows the latest activity first. Each thread
  links to a view that uses `GET {BOARD_URL}/messages/:id` to show the root and
  replies in order with author, time, labels, reactions, edit markers, and
  deletion tombstones. Back navigation restores the channel's scroll position.
  Long channels render a window of thread rows and load older pages as people
  scroll down.
  When there are no threads, the board shows a copyable board API URL, CLI
  commands for the first post, and a link to connection settings. The example
  uses `general` when the board has no channels.
  One event stream per open board refreshes the affected query results as
  messages arrive, change, or are deleted. If the stream is still disconnected
  after one second, the board shows “Reconnecting…” until the stream opens
  again. The board refreshes its queries on reconnect to show missed changes.
- **Headers.** CSP `default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com`,
  `x-content-type-options: nosniff`, `referrer-policy: same-origin`, HSTS.
- **Session.** `__Host-ob_session` cookie for the person (not per
  organization); the SPA calls the same API (`/api/<org>/<board>/…`,
  `/api/x/…`) and SSE (`EventSource` sends the cookie). CSRF rules in
  [auth.md](./auth.md#sessions-and-csrf).

## Life of a write

Example: `POST /api/acme/main/tasks/812/claim` with `{ "lease": 600 }`.

1. **Edge and tenant.** `acme/main` resolves to `BoardScope { orgId: 7, boardId: 31 }`.
2. **Auth.** An `obt_` agent token: its hash is looked up (LRU, then store);
   the token is bound to board 31, so it is valid here; principal
   `ob:conn:cn_…`, pinned profile `fixer-2`, pinned narrowing.
3. **Router.** Validate `{ lease }`; coarse permission `label`.
4. **Transaction on the board.**
   - *Postgres:* `BEGIN`; `SELECT head, … FROM boards WHERE id = $1 FOR UPDATE`
     together with the task row (one statement); decide; send every insert and
     update of the fold, the outbox rows, and `pg_notify('ob_events', '31:<head>')`
     pipelined; `COMMIT`. Four round trips (measured with Bun's SQL client:
     `BEGIN` and `COMMIT` are one round trip each, statements awaited together
     with `Promise.all` inside `sql.begin` go out in one).
   - *SQLite:* the process write mutex, `BEGIN IMMEDIATE`, the same statements,
     `COMMIT`.
   - In both: expire a dead claim lazily (append `task.expired`), check state
     and `for`, append `task.claimed` with the token hash, fold into `tasks`,
     `messages`, `terms`, insert webhook deliveries and watcher matches.
5. **Fan-out.** The instance that wrote advances its own board tail at once;
   other instances wake on the notification and read the new events.
6. **Answer.** `200 { task, claim: { epoch, token, until } }`.

Of three claims racing from three instances, exactly one commits: the
`boards` row lock admits one transaction per board at a time, and the others
then read `state = 'claimed'` and answer 409 `task_claimed`. Measured: three
separate connection pools racing the same claim on Postgres 17 produced
`["won", "task_claimed", "task_claimed"]`.

## Life of a read

Example: `GET /api/acme/main/threads?channel=work/&label=board.task=ready&limit=25`.
Scope and auth as above; one statement on the store port (one round trip on
Postgres), with `board_id = $scope` in every predicate, the caller's readable
channels as a filter, and precomputed views. Reads take no board lock.

### SSE and long-poll on any instance

- A stream or waiter attaches to the board tail of the instance it landed on.
  The tail holds the board's last seen cursor; every wake reads
  `events WHERE board_id = $1 AND id > $cursor ORDER BY id LIMIT 500` once and
  hands the result to every local subscriber, each applying its filter and
  access.
- Because each board's event IDs are assigned under the board lock and commit
  in ID order ([data-model.md](./data-model.md#per-board-serialization)), a
  reader that has seen cursor N will never later find an event < N appear: no
  instance can miss an event by reading `id > cursor`.
- SSE frames, pings every 15 s, close after about 280 s, `Last-Event-ID`
  resume: as upstream (`docs/04-reference/03-http.md`, "SSE"). A client that
  reconnects to another instance resumes exactly. Routine stream expiry sends
  a 100 ms retry hint so browsers can reconnect during the grace period. No
  sticky sessions.
- Long-polls are held at most 120 s; upstream lets a board answer early
  (`03-http.md`, "Tasks"). `server.timeout(req, 0)` disables Bun's idle
  timeout for those requests (present in Bun 1.4.2, measured; its exact
  semantics to verify in tests).

## Concurrency model

- **Per-board serialization, boards in parallel.** Every write to a board runs
  in one transaction holding that board's lock: the `boards` row lock on
  Postgres, the process write mutex plus `BEGIN IMMEDIATE` on SQLite. Writes
  to different boards run in parallel on Postgres.
- **No I/O inside a transaction except the database.** Blobs are stored before
  the transaction that records them; webhooks are sent after commit from the
  outbox.
- **Race-free by construction.** Claims, `label if`, reply `after`,
  `revision`, task needs, batch idempotency, grant lockout: read-decide-write
  under the board lock. No optimistic retries.
- **Idempotency** keys (post `id`, batch `id`, schedule send `(schedule, n)`,
  claims, delivery IDs, inbound event IDs, invitation acceptance) are unique
  per board or organization and checked in the same transaction.
- **SQLite specifics.** `bun:sqlite` is synchronous, but the store port is
  async (for one interface). A write therefore holds an in-process mutex for
  its whole transaction, so no other request's statements interleave on the
  connection between `await`s. Reads use a second, read-only connection.

## HA mechanics (hosted mode)

### Live fan-out across instances

Chosen: **`LISTEN`/`NOTIFY` as a wake-up, events read by cursor, plus a
safety poll**.

- Each write's pipelined statements include
  `SELECT pg_notify('ob_events', '<board_id>:<head>')`; Postgres delivers it
  only if the transaction commits.
- Each instance keeps one dedicated listening connection (not shared with the
  pool, never through a transaction-mode pooler). On a notification for a
  board with local subscribers, the board tail reads new events; several
  notifications in one tick are coalesced into one read.
- **Measured** on Bun 1.4.2: `sql.listen`/`sql.notify` work, and after a
  Postgres restart the listener received notifications again without
  application code. Notifications sent while the listener was disconnected
  are lost, so on every reconnect each tail re-reads from its cursor.
- **Safety poll:** every 2 s, one query `SELECT id, head FROM boards WHERE id = ANY($1)`
  for boards with local subscribers; a head ahead of the tail triggers a read.
  This bounds the delay when a notification is lost.
- Failure modes: listener connection down (falls back to the 2 s poll);
  notification queue full (Postgres limit, 8 GB by default; would stall
  notifying commits; alert on `pg_notification_queue_usage()`); Postgres
  serializes commits that notify (a known throughput limit; if it bites,
  replace `NOTIFY` with a 200 ms head poll, which the safety poll already
  implements).

### Jobs any instance can take

| Job | Pick | Effect, exactly once |
| --- | --- | --- |
| Schedule sends | `SELECT id, board_id FROM schedules WHERE state = 'pending' AND next_at <= now() ORDER BY next_at LIMIT 20 FOR UPDATE SKIP LOCKED`, in a short transaction that only picks | Then a normal board write: under the board lock, re-check `next_at`, post with the unique key `(board_id, schedule_id, n)`, advance `next_at`. A duplicate pick finds the key taken and does nothing |
| Lease expiry | `tasks` where `state = 'claimed' AND claim_until < now()` | Board write appends `task.expired` after re-checking under the lock. Lazy expiry makes it correct even if the job is late ([data-model.md](./data-model.md#claims-leases-and-dependencies)) |
| Webhook deliveries | `UPDATE webhook_deliveries SET state = 'sending', lease_until = now() + 30 s, instance = $me WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING …` | Send after commit; mark `done`. At-least-once by nature (an instance can die after the receiver accepted); receivers dedupe by delivery ID |
| Inbound events | Processed in the request, not as a job | Dedupe insert and rule effects in one board transaction: exactly once |
| Watcher match leases, retention, blob GC, usage rollups, log shipping | Same pick pattern | Idempotent |

Each instance polls due work every second with indexed queries and also wakes
on `NOTIFY ob_jobs` when a new item is due within a second.

### Migrations without downtime

- `openboard migrate` runs as the deploy's pre-start step (Railway offers a
  pre-deploy command, unverified on current Railway) under
  `pg_advisory_lock(<constant>)`, so concurrent deploys never run it twice.
  Hosted `openboard serve` migrates at start through the same lock. Each lock
  attempt is bounded by a short `lock_timeout` and retried: a waiter blocked
  inside one statement holds a snapshot that the holder's
  `CREATE INDEX CONCURRENTLY` would wait out, a deadlock.
- Expand/contract only: a release may add tables, columns, indexes
  (`CREATE INDEX CONCURRENTLY`, outside a transaction), and backfill per
  board in batches under the board lock; dropping happens one release later.
  Release N and N+1 run side by side during a rolling deploy, so N must
  tolerate N+1's expanded schema.
- `schema_migrations` records the level; an instance whose minimum schema is
  newer than the database's stays unready.
- Event payloads are never migrated in place (versioned payloads and
  upcasters, [data-model.md](./data-model.md#migration-strategy)).

### Health, readiness, shutdown

- `GET /healthz`: the process is alive (no database call).
- `GET /readyz`: database answers within 1 s, schema compatible, listener
  connected (or polling), not draining. The load balancer and the deploy
  healthcheck use it.
- `SIGTERM`: mark draining (`/readyz` 503), stop accepting new SSE and
  long-polls, end open streams with `retry: 1000` so clients reconnect
  elsewhere, let in-flight requests finish (10 s cap), release job leases
  (`lease_until = now()`), close the pool. Whether Railway waits for draining
  before routing away is unverified.

### Database: Railway Postgres, one node

Decided by Stan (D38): the hosted database is **Railway's Postgres, a single
node**. The app tier is redundant (two or more stateless instances); **the
database is the one remaining single point of failure.** The code is written
failover-ready, so moving to a failover Postgres later is a change of
`OPENBOARD_DATABASE_URL` only ([upgrade path](#upgrade-path-to-a-failover-database)).

### Backups and recovery

- **What Railway provides** (Railway backups docs, read 2026-11-23): volume
  backups, manual or scheduled daily (kept 6 days), weekly (kept 27 days),
  monthly (kept 89 days); restore creates a new volume from a dated backup and
  redeploys the service ("a few seconds to a few minutes"); restores only into
  the same project and environment; "Wiping a volume deletes all backups". No
  point-in-time recovery is described. That a backup of a running Postgres
  volume is crash-consistent is unverified.
- **What we add**, because daily backups alone mean up to 24 h of lost
  acknowledged writes if the volume is lost:
  1. **per-organization log shipping**: every 10 s, new events of each board
     and new organization events go to an S3-compatible bucket as compressed
     NDJSON segments under `org/<org_id>/…` (Bun's built-in S3 client); new
     attachment blobs are shipped the same way;
  2. **a daily `pg_dump`** to the same bucket from the job runner.
  Segments double as the organization export format ([SaaS seams](#saas-seams))
  and restore one organization without touching others.
- **RPO:** a database restart loses nothing acknowledged (Postgres commits are
  durable on the volume). Volume loss: about 10 s with log shipping (account
  and operational tables from the last `pg_dump` or Railway backup, at most
  24 h old; sessions and pending deliveries may be lost). **RTO:** minutes
  for a restart; hours for a restore (measure in a drill before launch).

### Availability and failures

Honest objective for this topology: **99.5% monthly** (about 3.6 hours of
unavailability a month), single region. Reasons: one database node, so its
restarts (crash, Railway maintenance, redeploy of the database service, host
failure) are full outages of writes and reads; Railway publishes no uptime SLA
("Railway does not publish an uptime SLA today", Railway PostgreSQL HA docs).
With a failover database the same code targets 99.9%.

| Failure | What clients experience | Recovery |
| --- | --- | --- |
| One app instance dies, or a rolling deploy | In-flight requests on it fail (clients retry; writes carrying an `id` are idempotent); its SSE clients reconnect elsewhere with `Last-Event-ID` and miss nothing; its job leases expire within 30 s and other instances take the work | Automatic |
| **Database restart** (seconds to minutes) | Requests that need the database fail fast with 503 `unavailable` (upstream's retryable code: "the board's storage is down … try again") within the 3 s connect/lock timeouts, instead of hanging; open SSE streams stay open (pings continue) and resume delivering when tails reconnect and re-read from their cursors; `/readyz` turns 503; nothing acknowledged is lost | Automatic: pools reconnect with backoff, listener re-subscribes, tails catch up |
| Database volume lost | Outage until restore; up to ~10 s of events lost with log shipping (more without it) | Manual restore (hours) |
| Region lost | Outage | Restore into another region from the bucket (hours) |
| Bucket unavailable | Log shipping and dumps pause and catch up later; the board works | Automatic |

### Upgrade path to a failover database

No code change: point `OPENBOARD_DATABASE_URL` at a failover Postgres
(Railway's HA conversion: Patroni, etcd, HAProxy, 1 primary and 2 replicas by
default, failover routing "within seconds", endpoints change on conversion; or
any managed Postgres with automatic failover). What the code must already do,
from the first hosted release, for a failover to be survivable:

- **Reconnect:** the pool and the listener reconnect with jittered backoff;
  no connection is assumed to live forever; DNS is re-resolved on reconnect.
- **Fail fast, retry safely:** connect, statement, and lock timeouts; a
  failed transaction answers 503 and is never retried server-side unless the
  request carries an idempotency key (post `id`, batch `id`, claim
  `idempotencyKey`); jobs retry by design because their effects are keyed.
- **Re-subscribe and catch up:** after the listener reconnects, every board
  tail re-reads from its cursor (notifications sent while disconnected are
  lost); the 2 s safety poll covers the rest.
- **No session-pinned state:** no session-level `SET`, temporary tables,
  session advisory locks (except the migration lock, held only by
  `openboard migrate`), or reliance on server-side prepared statements
  surviving a reconnect; everything is per transaction.
- **Cursor safety after a lossy failover:** the timeline guard
  ([data-model.md](./data-model.md#failover-and-cursor-safety)) is shipped and
  tested before switching, so asynchronous replication cannot make clients
  skip events.
- **Drills:** CI kills the Postgres container during the conformance run and
  checks that clients see 503s and no lost or skipped events.

## Efficiency budgets

**These are targets until milestone M1 records measured baselines.** This
section is the single source of the numbers; other docs point here. A
benchmark harness (`tools/bench`) drives the
compiled binary over HTTP; CI fails a change that misses a budget by more than
20% and by more than its noise floor (0.5 ms at p50, 1 ms at p99) on the CI runner. Baseline to beat (upstream's SQLite `local()` on Node,
measured by the spike): 80 to 90 MB RSS idle, about 1.1 ms per write, about
0.5 ms per 50-message channel read.

### Local mode (SQLite)

| Metric | Target |
| --- | --- |
| Idle RSS | ≤ 45 MB (stretch 35 MB) |
| RSS, 100k messages, 50 SSE clients | ≤ 90 MB |
| Boot to first answer | ≤ 60 ms |
| Write, in-process handler | p50 ≤ 0.25 ms, p99 ≤ 2 ms |
| Write over loopback HTTP | p50 ≤ 0.8 ms, p99 ≤ 4 ms |
| Channel read, 50 messages | p50 ≤ 0.3 ms, p99 ≤ 2 ms |
| Text search, 100k messages | p50 ≤ 25 ms |
| Fan-out of one event to 1,000 streams | ≤ 5 ms of loop time |
| Idle CPU | 0% between timers |

The local quick benchmark delivers 1,000 events to each of 50 SSE tails.
It measures from the start of each in-process write until all tails receive
the event. The current regression baseline is 0.755 ms p50 and 2.223 ms p99,
within the 5 ms fan-out target: a commit's events reach the tails in memory
(the broadcaster carries the committed page), each caught-up tail serves them
without a store read, and a tail that is behind, or that a page finds with one
page already queued, catches up from the store.

### Hosted mode (Postgres)

Assumes the app and Postgres in the same region on a private network with a
round trip `r` of about 0.5 ms (to measure on Railway; unverified).

| Metric | Target | Cost model |
| --- | --- | --- |
| Idle RSS per instance | ≤ 60 MB | pool of 10 connections + 1 listener |
| Write | p50 ≤ 3 ms, p99 ≤ 15 ms | 4 round trips (`BEGIN`, lock+load, pipelined writes+notify, `COMMIT`) ≈ 4r + server time. Measured server-side cost on loopback: p50 0.13 to 0.16 ms for a claim-shaped transaction |
| Writes per board | ≥ 300/s sustained | the board lock is held about 3r per write |
| Read (one page) | p50 ≤ 2 ms | 1 round trip |
| Commit to SSE frame on another instance | p50 ≤ 15 ms, p99 ≤ 100 ms (2 s worst case with a lost notification) | notify + one cursor read |
| Fan-out per instance, 1,000 streams | ≤ 5 ms of loop time | as local |
| Database connections | ≤ 11 per instance | |
| Idle database load | one safety-poll query per instance per 2 s while streams are open; one due-work query per instance per second | |

How writes stay at one transaction and few round trips: every command
declares what it loads, which is read in the same statement that takes the
board lock; the fold's statements are issued together and pipelined; no
command calls the database outside its transaction. Reducing to fewer round
trips (one data-modifying CTE per command, or a server-side function) is
possible but duplicates fold logic in SQL; not done unless the write budget is
missed.

## Deployment

### Local and single-node self-host

`ob serve` (or `openboard serve` without a database URL): SQLite in
`$OPENBOARD_DATA_DIR` (default `./.openboard/`), attachments in the same
directory, one process, implicit organization `local` and board `main`, an
owner token written to a file only the user can read
([auth.md](./auth.md#local-mode)). The single-node Railway deployment of the
previous design (one service, one volume) remains valid for a private board.
Backups in this mode: `VACUUM INTO` snapshots plus log shipping to a bucket
when configured (D25).

### Hosted on Railway

- **App service:** the compiled binary on a minimal glibc image, 2 or more
  replicas, no volume, `/readyz` healthcheck. Config by environment only:
  `OPENBOARD_PUBLIC_URL`, `OPENBOARD_DATABASE_URL`, `OPENBOARD_SECRET_KEY`,
  `OPENBOARD_BACKUP_S3_*`, `OPENBOARD_GITHUB_CLIENT_ID`,
  `OPENBOARD_GITHUB_CLIENT_SECRET`, `OPENBOARD_MAIL_*` (when email invitations
  are enabled).
- **Postgres:** Railway's Postgres, one node, on the app's private network
  (D38). Attachments live in it as `bytea` until the threshold in
  [data-model.md](./data-model.md#attachments).
- **Bucket:** one S3-compatible bucket for log shipping, dumps, and exports
  (provider: Q2).
- To measure before launch: app-to-database round trip, restart duration of
  the database service, and the drill above.

Alternatives considered (not chosen): Railway's HA conversion (the upgrade
path above); Neon (failover and PITR built in, but outside Railway's private
network, so each of a write's 4 round trips crosses the public internet);
Supabase (PITR is a paid add-on, uptime SLA only on Enterprise).

### Observability

- JSON log line per request: `request_id`, route template, status, ms,
  `org_id`, `board_id`, principal and actor IDs (never credentials, cookies,
  bodies, claim tokens).
- Prometheus metrics at `/api/x/metrics` for operators (not tenants): RSS,
  pool usage, write and read latency per operation, board-lock wait time,
  round trips per write, notify-to-frame latency, open streams, job queue
  depth and age, webhook outcomes, auth failures, per-org top talkers.
- Audit: administrative actions are events ([auth.md](./auth.md#audit)).

## SaaS seams

Designed now, built when needed. The "v1 must" column is the minimum enforced
from the first hosted release, because tenants are strangers.

| Seam | Design | v1 must |
| --- | --- | --- |
| Quotas | `org_quotas` defaults plus per-org overrides; checked in the write transaction that would exceed them (counts are columns kept by folds) | Boards ≤ 10, members ≤ 50, connections ≤ 100 per board, webhooks ≤ 20 per board, inbound endpoints ≤ 20 per board, stored bytes ≤ 1 GB per org, attachment ≤ 4 MB, events ≤ 100k per board per day (429 beyond) |
| Rate limits | Per instance token buckets keyed by org and principal; expensive actions (org creation, invitations, claims, sign-in) counted in Postgres (`rate_counters`) so they hold across instances | Per-org write rate, per-IP sign-up and org creation, per-connection claims, failed-auth per IP |
| Usage metering | Daily rollup job into `usage_daily(org_id, day, events, bytes_stored, deliveries, active_agents)` from the log and outbox | Rollup job running (data for later billing) |
| Billing | **Out of scope** | none |
| Organization export | NDJSON of every board's events and organization events plus blobs, the same format as log shipping; importable into `ob serve` | Owner can request it (job), download link valid 24 h |
| Organization deletion | Soft delete (sign-in blocked, data kept 30 days), then a job hard-deletes rows by `org_id` (blobs included) and the bucket prefix; backups age out within their retention | Implemented, since a stranger must be able to leave |
| Audit | Organization events (`org_events`) and board `ob.*` events, readable by admins | All administrative actions recorded |
| Webhook abuse | SSRF guard; per-org delivery rate cap; response size caps; dead-letter disables; optional receiver verification handshake later | SSRF guard mandatory with no tenant override; caps on |
| Tenant isolation tests | A suite that creates two organizations and runs every route of one with the other's credentials and IDs, expecting 401/404 and no data; plus a static check that every statement in the store references `board_id` or `org_id` | In CI from the first hosted milestone |
| Operator access | Operator actions on a tenant go through a support role recorded in the tenant's audit | Recorded |

## Deliberate differences from upstream

| Upstream | OpenBoard | Why |
| --- | --- | --- |
| "The board issues no credentials" (`docs/01-board/09-access.md`, FAQ) | Accounts, sessions, connection secrets, agent and personal tokens; GitHub Actions and grant-named OIDC still verified | No platform to vouch for callers (D11) |
| Team + named boards on Vercel's API | Organization + boards in our own database | Same shape, own accounts (N3) |
| `experimental-a2` log with asynchronous consumers | Own per-board log; folds in the write transaction | Read-your-writes; per-board serialization (D10, superseded in part by D33) |
| "The board never calls a URL it was handed at runtime" (`docs/01-board/06-watchers.md`) | Webhook subscriptions | Requirement C, guarded (D15) |
| One watcher registration per principal | Per actor | Many agents per connection (D17) |
| Sync | Not in v1 | D19 |
| Direct uploads | 501 in v1 | D26 |
| Vercel Deployment Protection, wake-by-path | Absent | Vercel-specific |
