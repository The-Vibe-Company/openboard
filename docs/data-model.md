# Data model

The same schema runs on SQLite (local mode) and Postgres (hosted mode).
Tenancy is in the keys from the first table: **organization → boards →
everything else**. Each board has an append-only event log that is the source
of truth for board state; every other board table is a fold of it, rebuilt by
replay. Accounts, organizations, and operational queues are plain tables.

## Tenancy

- **Organization** (`orgs`): the tenant. Upstream's equivalent is a Vercel
  team (`docs/04-reference/05-conformance.md` names "team" for Vercel's board).
- **Board** (`boards`): an organization has a default board `main` and any
  number of named boards; upstream's equivalent is a team's board by name.
  The board is the unit of the protocol: one `BOARD_URL`, one event log, one
  cursor space, one set of grants.
- **Every board-scoped row carries `org_id` and `board_id`**, and every board
  table's primary key starts with `board_id`. Every statement the store runs
  on a board table has `board_id = $scope` in its predicate; a CI check parses
  the statement registry and fails on any statement that does not.
  During the organization-column expansion, `grant_principals.org_id` and
  `task_needs.org_id` are nullable. Startup queues a board-locked job to fill
  missing values in batches from the board's organization. Reads still use the
  board key so writes by old replicas remain visible during rollout. The later
  contract phase must account for any writes by old replicas after a sweep.
- **Shared tables, not schema- or database-per-tenant.** Thousands of small
  tenants would make per-tenant schemas a migration and connection-pool
  problem; shared tables keep one migration, one pool, cheap empty tenants.
- **Postgres row-level security: not in v1, kept as a seam.** RLS needs the
  tenant set per transaction (`SET LOCAL`/`set_config`), which turns every
  read (a single statement today) into `BEGIN`, `set_config`, the read and
  `COMMIT`, three more round trips, and must be
  correct across the pool. Isolation is enforced instead by: the only code
  that can mint a `BoardScope` is the tenant resolver; store functions take a
  `BoardScope`, never a bare ID; the statement check above; the tenant
  isolation test suite ([architecture.md](./architecture.md#saas-seams)). RLS
  policies (`org_id = current_setting('app.org_id')::bigint`) can be added
  later without schema changes because `org_id` is on every row. What they
  would cost per read and per write is measured in
  [decisions.md D56](./decisions.md#d56-what-postgres-row-level-security-costs-measured).
- **Local mode** has one implicit organization (`id = 1`, slug `local`) and
  board (`id = 1`, slug `main`), created at first start; more boards can be
  created locally.

## The store port

Core code never sees SQL. It receives **scoped views** from the `Store` port
(`docs/codebase.md` names them): `store.board(scope)` and `store.org(orgId)`
expose domain operations (`appendAndFold`, `loadForClaim`, `listThreads`,
`channelMessages`, …) whose statements already carry the scope, and a view
cannot name another tenant. Writes go through one entry point that opens the
board-serialized transaction:

```ts
interface BoardView {
  write<T>(fn: (w: BoardWriter) => Promise<T>): Promise<T>   // lock board, run, commit (one transaction)
  // reads: listThreads(filter), channelMessages(q), thread(id), eventsAfter(cursor, limit), ...
}
```

**Both drivers implement those views from one shared SQL module** (a
driver-level package both `driver-sqlite` and `driver-postgres` import, so the
rule "SQL only in driver packages" holds), parameterized by a small dialect
object. That is the answer to keeping two dialects honest without an ORM and
without doubling the work:

- **One SQL text for both engines.** Queries are written with one tagged
  template (`sql\`… WHERE board_id = ${scope.boardId} AND id = ${id}\``) that
  renders `$1…` for Postgres and `?` for SQLite. The schema avoids what the
  engines disagree on: integers are 64-bit (`BIGINT`/`INTEGER`), times are
  milliseconds since epoch in `BIGINT` (no `timestamptz`), JSON is `TEXT`
  parsed in TypeScript (no `jsonb` operators), booleans are `0`/`1`, upserts
  use `ON CONFLICT … DO UPDATE` and `RETURNING`, which both support (SQLite ≥
  3.35; Bun 1.4.2 ships SQLite 3.54.0, measured).
- **The dialect layer is small** and lives in the two drivers: DDL files,
  placeholder style, the board lock (`SELECT … FOR UPDATE` vs the process
  mutex plus `BEGIN IMMEDIATE`), notify (`pg_notify` vs an in-process bus),
  engine-only indexes (Postgres `pg_trgm`), and type decoding (Bun's SQL
  client returns `BIGINT` as a string, measured; IDs are therefore decimal
  strings end to end, which is what the protocol wants).
- **Why not an ORM or a query builder:** the queries are few and hot; a
  builder would hide round trips. **Why not implement the views separately in
  each driver** (`claimTask()`, `listThreads()` written twice): it doubles every
  query and lets the engines drift. Shared SQL with a thin dialect keeps one
  implementation and makes drift a test failure.
- **Keeping the dialects honest:**
  1. one store test suite runs every command and query against both drivers
     (SQLite in memory, Postgres in CI);
  2. a statement-registry test runs `EXPLAIN` of every registered statement on
     both engines, so a statement that one engine cannot parse fails CI
     without needing a test that reaches it;
  3. a schema-parity test reads both catalogs (`pragma_table_info`,
     `information_schema.columns`) and compares tables, columns, and primary
     keys;
  4. the upstream conformance kit runs against `ob serve` (SQLite) and against
     two hosted instances behind a round-robin proxy (Postgres), which also
     tests cross-instance fan-out.
- **Postgres client: Bun's built-in SQL client** (`import { SQL } from "bun"`).
  Measured on Bun 1.4.2: transactions (`sql.begin`), pipelining of statements
  awaited together inside a transaction, `listen`/`notify`, automatic
  re-listen after a server restart, `reserve()` for a dedicated connection.
  No dependency, native. Fallback: the `postgres` package (porsager), whose
  API is the model Bun's follows (not tested on Bun 1.4.2: unverified). `pg`
  (node-postgres) is not considered: older callback-era design, more
  overhead. Behind a transaction-mode pooler (PgBouncer), prepared statements
  must be disabled and the listener must bypass the pooler; we connect
  directly (HAProxy in TCP mode on Railway HA).

## Per-board serialization

Every write to a board is one transaction that first takes the board's lock
and reads its head:

```sql
-- Postgres: first statement of every board write (with the command's loads joined in)
SELECT head, next_schedule, next_grant, timeline FROM boards WHERE id = $1 FOR UPDATE;
-- ... decide, then append events with ids head+1 .. head+n, fold, outbox, notify ...
UPDATE boards SET head = $new_head WHERE id = $1;
```

**Why this gives a strict order and race-free claims (the argument):**

1. The row lock admits at most one open write transaction per board. A second
   writer blocks on `FOR UPDATE` until the first commits or rolls back.
2. Event IDs are `head + 1…` read under the lock, so they are gap-free and
   strictly increasing per board (a rolled-back transaction leaves `head`
   unchanged; measured: a failed write left `head` as it was).
3. Commit order equals ID order per board: transaction B cannot read `head`
   until A has committed, so B's IDs are larger and B commits after A.
   Therefore a reader that sees event N already sees every event < N of that
   board, and reading `id > cursor` never skips an event that commits later.
   A Postgres `SEQUENCE` does not give this (IDs are taken out of commit
   order, so a slow transaction can commit ID 10 after a reader saw 11), which
   is why it is not used.
4. Every conditional write (a claim, `label if`, reply `after`, `revision`)
   reads its precondition under the lock, so of three racing claims exactly
   one sees `ready`. Measured with three connection pools on Postgres 17:
   `["won", "task_claimed", "task_claimed"]`.
5. Different boards lock different rows, so they write in parallel. An
   advisory lock would also serialize, but the row lock gives the lock and the
   counter in one statement and shows up in `pg_locks` for debugging.

On SQLite the same properties hold trivially: one process, one write mutex,
`BEGIN IMMEDIATE`. Lock order is always "board row first, then anything
else"; job pickers that select candidate rows with `SKIP LOCKED` release them
before taking a board lock, so no deadlock cycle exists.

### Failover and cursor safety

With asynchronous replication, a Postgres failover can lose the last committed
transactions. A board's `head` on the new primary would then be lower than a
cursor some client already holds, the next writes would reuse those IDs, and
that client (reading `id > cursor`) would skip them. Two defences, to choose
between (decision D37). With the single-node database of D38 there is no
failover, so this matters from the day the database URL points at a failover
cluster; the guard ships before that:

- **Synchronous replication** to at least one replica (Patroni
  `synchronous_mode`): no committed transaction is lost, at the cost of one
  replica round trip per commit. Whether Railway's managed HA allows enabling
  it without becoming self-managed is unverified.
- **Timeline guard** (default if synchronous replication is unavailable):
  `boards.timeline` stores the server timeline seen at the last write. The
  board's lock statement reads the current timeline in the same round trip:
  the timeline WAL is written on, the first 8 hex digits of
  `pg_walfile_name(pg_current_wal_lsn())`, which any role may call. It
  changes at promotion; `pg_control_checkpoint()`'s timeline lags until the
  new primary's first checkpoint completes, seconds to minutes later. A write that sees a timeline different from
  `boards.timeline` first advances `head` by 1,000,000, and the head update
  records the new timeline, so new IDs are above any cursor handed out before
  the failover. A board that recorded none yet (`0`) records it without
  advancing; SQLite's timeline is the constant `0`, so a local write never
  advances. Lost events stay lost (RPO), but no client skips new ones.

## IDs and cursors

The protocol requires IDs and cursors to be strings of 1 to 128 characters,
and lets a message ID act as a cursor (`docs/04-reference/03-http.md`, "IDs
and cursors"). Upstream's local board uses decimal log positions (`"812"`).

| Thing | Format | Scope |
| --- | --- | --- |
| Event cursor | decimal of `events.id` | per board, from `boards.head` |
| Message ID | cursor of its `message.posted` | per board |
| Task ID | its root message ID | per board |
| `version` | event ID of the last change to the message | per board |
| `revision` | counter, +1 on edit and delete | per message |
| Thread page `older` | `"<active>.<root>"` | per board |
| Schedule ID | `s<n>`, `<n>` accepted, from `boards.next_schedule` | per board |
| Grant ID | `g<n>` from `boards.next_grant`; `g1`..`g3` seeded | per board |
| Attachment ID | `at_` + 26 chars base32 (128 random bits) | global |
| Connection, agent, webhook, delivery, inbound, invitation IDs | `cn_`, `ag_`, `wh_`, `dl_`, `ib_`, `inv_` + 16 chars base32 | global |
| User, organization, board (internal) | `BIGINT` generated; public as `u_` + base32 for users; slugs for orgs and boards | global |
| Schema ID | `name@version` | per board; built-ins on every board |

A cursor that does not parse as a decimal within `[0, head]` answers 400
`invalid_cursor`. Board-scoped IDs from another board are simply not found
(404), since every lookup includes `board_id`.

## DDL

One DDL, written for Postgres below. The SQLite file is the same text with
these mechanical differences, generated and checked by the schema-parity
test:

| Postgres | SQLite |
| --- | --- |
| `BIGINT`, `INTEGER`, `SMALLINT` | `INTEGER` |
| `BYTEA` | `BLOB` |
| `strpos(text, text)` in a view or expression index | `instr(text, text)` |
| A deletable view with `COMMENT ON VIEW … IS 'sqlite delete from <table> by <key columns>'` | An `INSTEAD OF DELETE` trigger that deletes the corresponding base row by its declared key |
| `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | `INTEGER PRIMARY KEY` |
| table options none | `STRICT`; `WITHOUT ROWID` on tables with composite keys |
| `CREATE EXTENSION pg_trgm` and the trigram index | omitted (SQLite searches with `LIKE`, see [Search](#search)) |
| `CREATE INDEX CONCURRENTLY` in migrations | `CREATE INDEX` |
| Dropping `NOT NULL` on webhook delivery event and thread | Rebuild the table inside the migration transaction and restore its indexes for older system SQLite versions |
| Stored functions and triggers for job wake-up notifications | omitted (the SQLite driver wakes jobs in-process) |
| Task lease queue trigger | SQLite trigger with the same statements inlined |

Example of the mapping, `messages` on SQLite:
`CREATE TABLE messages (org_id INTEGER NOT NULL, board_id INTEGER NOT NULL, id INTEGER NOT NULL, …, PRIMARY KEY (board_id, id)) STRICT, WITHOUT ROWID;`

### Pragmas (SQLite)

```sql
PRAGMA journal_mode = WAL;  PRAGMA synchronous = NORMAL;  PRAGMA foreign_keys = OFF;
PRAGMA temp_store = MEMORY; PRAGMA cache_size = -16000;   PRAGMA mmap_size = 67108864;
PRAGMA busy_timeout = 5000; PRAGMA journal_size_limit = 67108864; PRAGMA wal_autocheckpoint = 1000;
```

The read connection adds `PRAGMA query_only = ON`. `synchronous = NORMAL`
can lose the last commits on power loss (not on a process crash);
`OPENBOARD_SYNC=FULL` trades latency for that.

### Postgres settings

Per connection: `SET statement_timeout = '5s'`, `SET lock_timeout = '3s'`
(a board lock waited longer than that answers 503 `unavailable`, upstream's
retryable code), `SET idle_in_transaction_session_timeout = '10s'`. Default
isolation `READ COMMITTED` is sufficient because every conditional write holds
the board lock.

### Accounts and organizations (global)

```sql
CREATE TABLE users (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id   TEXT    NOT NULL UNIQUE,          -- u_<base32>, in principal IDs: ob:user:u_...
  handle      TEXT    NOT NULL,                 -- login at the last sign-in
  name        TEXT    NOT NULL,
  email       TEXT,                             -- verified email, if the provider gave one
  avatar      TEXT,
  created_at  BIGINT  NOT NULL,
  disabled_at BIGINT
);
CREATE TABLE identities (
  provider    TEXT    NOT NULL,                 -- 'github' (later 'google', 'email')
  subject     TEXT    NOT NULL,                 -- provider's stable ID (GitHub numeric ID, email address)
  user_id     BIGINT  NOT NULL,
  email       TEXT,
  created_at  BIGINT  NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities (user_id);

CREATE TABLE orgs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        TEXT    NOT NULL UNIQUE,          -- immutable in v1; [a-z0-9][a-z0-9-]{1,38}, not reserved
  name        TEXT    NOT NULL,
  created_by  BIGINT  NOT NULL,
  created_at  BIGINT  NOT NULL,
  deleted_at  BIGINT,                           -- soft delete; hard delete job after 30 days
  quotas      TEXT                              -- JSON overrides of default quotas
);
CREATE TABLE memberships (                      -- many-to-many; v1 UX enforces one org per person
  org_id      BIGINT  NOT NULL,
  user_id     BIGINT  NOT NULL,
  role        TEXT    NOT NULL,                 -- owner | admin | member
  created_at  BIGINT  NOT NULL,
  invited_by  BIGINT,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE invitations (
  id          TEXT    PRIMARY KEY,              -- inv_...
  org_id      BIGINT  NOT NULL,
  token_hash  BYTEA   NOT NULL UNIQUE,          -- SHA-256 of the link token
  email       TEXT,                             -- if set, only an identity with this verified email may accept
  role        TEXT    NOT NULL,                 -- admin | member
  created_by  BIGINT  NOT NULL,
  created_at  BIGINT  NOT NULL,
  expires_at  BIGINT  NOT NULL,                 -- 7 days
  sent_at     BIGINT,                           -- email invitations
  accepted_by BIGINT,
  accepted_at BIGINT,
  revoked_at  BIGINT
);
CREATE INDEX invitations_org ON invitations (org_id, created_at);

CREATE TABLE org_events (                       -- organization-level audit log, append-only
  org_id      BIGINT  NOT NULL,
  id          BIGINT  NOT NULL,                 -- per-org counter (orgs row lock)
  type        TEXT    NOT NULL,                 -- ob.org.created, ob.member.added|role_changed|removed,
                                                -- ob.invitation.created|accepted|revoked, ob.board.created|deleted, ...
  at          BIGINT  NOT NULL,
  actor       TEXT,
  payload     TEXT    NOT NULL,
  PRIMARY KEY (org_id, id)
);

CREATE TABLE sessions (
  id_hash     BYTEA   PRIMARY KEY,              -- SHA-256 of the cookie value
  user_id     BIGINT  NOT NULL,
  csrf        TEXT    NOT NULL,
  created_at  BIGINT  NOT NULL,
  seen_at     BIGINT  NOT NULL,
  expires_at  BIGINT  NOT NULL,
  revoked_at  BIGINT
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE device_codes (
  device_hash BYTEA   PRIMARY KEY,
  user_code   TEXT    NOT NULL UNIQUE,
  client_name TEXT    NOT NULL,
  user_id     BIGINT,
  org_id      BIGINT,                           -- chosen at approval
  approved_at BIGINT,
  expires_at  BIGINT  NOT NULL,
  polled_at   BIGINT,
  can         TEXT                             -- requested scope and, after approval, its per-board caps
);

CREATE TABLE personal_tokens (
  id          TEXT    PRIMARY KEY,              -- pt_...
  user_id     BIGINT  NOT NULL,
  org_id      BIGINT  NOT NULL,                 -- a token works in one organization
  board_id    BIGINT,                           -- optional: one board only
  name        TEXT    NOT NULL,
  token_hash  BYTEA   NOT NULL UNIQUE,
  can         TEXT,                             -- optional requested scope and per-board approval caps
  created_at  BIGINT  NOT NULL,
  expires_at  BIGINT  NOT NULL,
  last_used_at BIGINT,
  revoked_at  BIGINT
);
CREATE INDEX personal_tokens_user ON personal_tokens (user_id);

CREATE TABLE rate_counters (key TEXT NOT NULL, window_start BIGINT NOT NULL, n BIGINT NOT NULL,
                            expires_at BIGINT NOT NULL, PRIMARY KEY (key, window_start));
CREATE INDEX rate_counters_expiry ON rate_counters (expires_at);
CREATE TABLE usage_daily (org_id BIGINT NOT NULL, day TEXT NOT NULL, events BIGINT NOT NULL, bytes BIGINT NOT NULL,
                          deliveries BIGINT NOT NULL, agents BIGINT NOT NULL, PRIMARY KEY (org_id, day));
CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY, applied_at BIGINT NOT NULL);
```

### Boards and the log

```sql
CREATE TABLE boards (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        BIGINT  NOT NULL,
  slug          TEXT    NOT NULL,               -- 'main' for the default board
  name          TEXT    NOT NULL,
  head          BIGINT  NOT NULL DEFAULT 0,     -- last event ID; the board lock row
  next_schedule BIGINT  NOT NULL DEFAULT 1,
  next_grant    BIGINT  NOT NULL DEFAULT 4,     -- g1..g3 seeded
  timeline      BIGINT  NOT NULL DEFAULT 0,     -- failover guard
  projection    BIGINT  NOT NULL DEFAULT 0,     -- projection version of this board's folds
  created_at    BIGINT  NOT NULL,
  deleted_at    BIGINT,
  UNIQUE (org_id, slug)
);

CREATE TABLE events (
  org_id     BIGINT  NOT NULL,
  board_id   BIGINT  NOT NULL,
  id         BIGINT  NOT NULL,                  -- the cursor
  type       TEXT    NOT NULL,
  v          INTEGER NOT NULL DEFAULT 1,        -- payload version for this type
  at         BIGINT  NOT NULL,
  thread     BIGINT,
  message    BIGINT,
  channel    TEXT,
  actor      TEXT,
  principal  TEXT,
  visibility SMALLINT NOT NULL,                 -- 0 feed, 1 bookkeeping (all=true), 2 internal (ob.*), never on /events
  payload    TEXT    NOT NULL,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX events_thread  ON events (board_id, thread, id)  WHERE thread IS NOT NULL;
CREATE INDEX events_channel ON events (board_id, channel, id) WHERE channel IS NOT NULL;
-- When each connection was last used (D51): only writes by connections and their agents pay for it.
CREATE INDEX events_connection ON events (board_id, principal, id) WHERE principal LIKE 'ob:conn:%';
```

- Append only: no `UPDATE` or `DELETE` on `events` except the organization
  hard-delete job.
- Upstream event types keep upstream payloads; server-only fields (the claim
  token hash, a schedule creator's facts) are stripped by views.
- `ob.*` events (`visibility = 2`) record board configuration: grants,
  schemas, schedules, connections, agents, webhooks, inbound endpoints,
  watcher registrations. Never served on `/events`.

### Board state (folds)

All tables below are rebuilt from `events` by replay. Columns are as in the
earlier single-tenant design, with `org_id, board_id` added and primary keys
prefixed by `board_id`.

```sql
CREATE TABLE messages (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id BIGINT NOT NULL,
  channel TEXT NOT NULL, re BIGINT, reply_to BIGINT,
  actor TEXT NOT NULL, principal TEXT NOT NULL, profile TEXT,
  client_id TEXT, text TEXT NOT NULL, text_lower TEXT NOT NULL,
  labels TEXT NOT NULL DEFAULT '{}', no_sync SMALLINT NOT NULL, blind SMALLINT NOT NULL DEFAULT 0,
  schedule_id BIGINT, schedule_n BIGINT,
  version BIGINT NOT NULL, revision BIGINT NOT NULL DEFAULT 0, deleted SMALLINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  replies BIGINT NOT NULL DEFAULT 0, last_reply BIGINT, active BIGINT,   -- root-only
  view TEXT NOT NULL,                                                   -- precomputed MessageView JSON
  PRIMARY KEY (board_id, id)
);
CREATE INDEX messages_channel       ON messages (board_id, channel, id);
CREATE INDEX messages_re            ON messages (board_id, re, id) WHERE re IS NOT NULL;
CREATE INDEX messages_actor         ON messages (board_id, actor, id);
CREATE INDEX messages_principal     ON messages (board_id, principal, id);
CREATE INDEX threads_active         ON messages (board_id, active, id) WHERE re IS NULL;
CREATE INDEX threads_channel_active ON messages (board_id, channel, active, id) WHERE re IS NULL;
CREATE UNIQUE INDEX messages_client ON messages (board_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX messages_sched  ON messages (board_id, schedule_id, schedule_n) WHERE schedule_id IS NOT NULL;
-- Postgres only:
CREATE INDEX messages_text_trgm     ON messages USING gin (text_lower gin_trgm_ops);

CREATE TABLE terms (                     -- label key, '@' mention, '^' attachment
  board_id BIGINT NOT NULL, message BIGINT NOT NULL, term TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (board_id, message, term, value)
);
CREATE INDEX terms_lookup ON terms (board_id, term, value, message);

CREATE TABLE reactions (
  board_id BIGINT NOT NULL, message BIGINT NOT NULL, emoji TEXT NOT NULL, actor TEXT NOT NULL, at BIGINT NOT NULL,
  PRIMARY KEY (board_id, message, emoji, actor)
);

CREATE TABLE channels (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, path TEXT NOT NULL, created_at BIGINT NOT NULL,
  last_index BIGINT, messages BIGINT NOT NULL DEFAULT 0, threads BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, path)
);

CREATE TABLE actors (
  board_id BIGINT NOT NULL, id TEXT NOT NULL, principal TEXT NOT NULL, profile TEXT,
  kind TEXT NOT NULL, handle TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT, via TEXT,
  verified SMALLINT NOT NULL DEFAULT 0, first_seen BIGINT NOT NULL, last_seen BIGINT NOT NULL,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX actors_handle ON actors (board_id, handle);

CREATE TABLE tasks (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id BIGINT NOT NULL,
  channel TEXT NOT NULL, state TEXT NOT NULL, owner TEXT NOT NULL, by_actor TEXT NOT NULL, by_profile TEXT,
  for_actor TEXT, epoch BIGINT NOT NULL DEFAULT 0,
  claim_actor TEXT, claim_until BIGINT, claim_token BYTEA,
  blocked_kind TEXT, blocked_reason TEXT, result TEXT, reason TEXT,
  created_at BIGINT NOT NULL, waiting_on BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX tasks_ready  ON tasks (board_id, channel, state, id);
CREATE INDEX tasks_claims ON tasks (claim_until) WHERE state = 'claimed';          -- global: expiry job
CREATE INDEX tasks_owner  ON tasks (board_id, owner, state, id);
CREATE INDEX tasks_for    ON tasks (board_id, for_actor, state, id) WHERE for_actor IS NOT NULL;

CREATE TABLE task_needs (org_id BIGINT, board_id BIGINT NOT NULL, task BIGINT NOT NULL, needs BIGINT NOT NULL, PRIMARY KEY (board_id, task, needs));
CREATE INDEX task_needs_reverse ON task_needs (board_id, needs, task);
CREATE TABLE task_batches (org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, principal TEXT NOT NULL, id TEXT NOT NULL,
                           digest TEXT NOT NULL, tasks TEXT NOT NULL, PRIMARY KEY (board_id, principal, id));

CREATE TABLE schedules (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id BIGINT NOT NULL,
  channel TEXT NOT NULL, re BIGINT, text TEXT NOT NULL, labels TEXT NOT NULL, no_sync SMALLINT NOT NULL,
  attachments TEXT NOT NULL, first_at BIGINT NOT NULL, every_ms BIGINT, until_at BIGINT, times BIGINT,
  sent BIGINT NOT NULL DEFAULT 0, next_at BIGINT, last_message BIGINT, state TEXT NOT NULL, canceled TEXT,
  by_actor TEXT NOT NULL, by_principal TEXT NOT NULL, by_profile TEXT, creator TEXT NOT NULL,
  blind SMALLINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX schedules_due ON schedules (next_at) WHERE state = 'pending';          -- global: job picker

CREATE TABLE attachments (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id TEXT NOT NULL,
  blob_key TEXT NOT NULL, sha256 TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, size BIGINT NOT NULL,
  uploader TEXT NOT NULL, at BIGINT NOT NULL, attached SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, id)
);

CREATE TABLE grants (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id BIGINT NOT NULL,
  principals TEXT NOT NULL, can TEXT NOT NULL, capped SMALLINT NOT NULL, by TEXT, at BIGINT,
  revoked SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, id)
);
CREATE TABLE grant_principals (
  org_id BIGINT,
  board_id BIGINT NOT NULL, grant_id BIGINT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, detail TEXT NOT NULL,
  PRIMARY KEY (board_id, grant_id, kind, key)
);
CREATE INDEX grant_principals_kind ON grant_principals (board_id, kind, key);

CREATE TABLE schemas (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, version BIGINT NOT NULL,
  description TEXT, schema TEXT NOT NULL, by TEXT NOT NULL, at BIGINT NOT NULL,
  PRIMARY KEY (board_id, id)
);

CREATE TABLE watcher_registrations (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, owner TEXT NOT NULL, watch TEXT NOT NULL, hash TEXT NOT NULL, at BIGINT NOT NULL,
  PRIMARY KEY (board_id, owner)
);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,                                  -- cn_...; embedded in the secret
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL,     -- a connection belongs to one board
  name TEXT NOT NULL, parent TEXT, origin_grant BIGINT,
  secret_hash BYTEA NOT NULL, secret_hint TEXT NOT NULL,
  prev_secret_hash BYTEA, prev_secret_until BIGINT,     -- rotation overlap
  direct SMALLINT NOT NULL, claims_max BIGINT, claims_used BIGINT NOT NULL DEFAULT 0,
  profiles TEXT NOT NULL, claim_can TEXT, token_ttl_s BIGINT NOT NULL, token_max_s BIGINT NOT NULL,
  expires_at BIGINT, created_by TEXT NOT NULL, created_at BIGINT NOT NULL, revoked_at BIGINT, revoked_by TEXT,
  UNIQUE (board_id, name)
);
CREATE TABLE connection_agents (
  id TEXT PRIMARY KEY,                                  -- ag_...; embedded in the token
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, connection TEXT NOT NULL,
  profile TEXT NOT NULL, profile_key TEXT NOT NULL, avatar TEXT, can TEXT NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE, prev_hash BYTEA, prev_until BIGINT,
  token_expires BIGINT NOT NULL, hard_expires BIGINT NOT NULL, claim_key TEXT,
  created_at BIGINT NOT NULL, last_used_at BIGINT, revoked_at BIGINT, revoked_by TEXT
);
-- A profile is held while its agent is unrevoked and its token unexpired: checked under the board lock (D50).
CREATE UNIQUE INDEX agents_claim_key    ON connection_agents (connection, claim_key) WHERE claim_key IS NOT NULL;
CREATE INDEX connection_agents_board    ON connection_agents (board_id, connection, created_at);

CREATE TABLE webhooks (
  id TEXT PRIMARY KEY, org_id BIGINT NOT NULL, board_id BIGINT NOT NULL,
  name TEXT NOT NULL, owner_actor TEXT NOT NULL, owner TEXT NOT NULL,
  secret_id TEXT NOT NULL, enabled SMALLINT NOT NULL, directory SMALLINT NOT NULL,
  config TEXT NOT NULL,                            -- JSON including the public signing configuration
  workload TEXT,                                  -- internal JSON workload identity for delivery authorization
  UNIQUE (board_id, name)
);
CREATE TABLE inbound_endpoints (
  id TEXT PRIMARY KEY, org_id BIGINT NOT NULL, board_id BIGINT NOT NULL,
  name TEXT NOT NULL, grant_id BIGINT NOT NULL,
  config TEXT NOT NULL,                           -- JSON including public verification settings and rules
  UNIQUE (board_id, name)
);
CREATE TABLE inbound_secrets (
  id TEXT PRIMARY KEY, org_id BIGINT NOT NULL, board_id BIGINT NOT NULL,
  key_version BIGINT NOT NULL, ciphertext TEXT NOT NULL
);
```

For an OIDC-created webhook, `ob.webhook.created` records the verified issuer,
subject, and values for only the claim keys in matching grants. Repository
workloads store the normalized repository, repository ID, workflow, branch,
and event fields read by their grant matcher. The fold copies that identity to
`webhooks.workload`. The stored identity contains neither the bearer token nor
a copy of the creator's permissions. Public webhook and audit responses omit
it. Existing webhook rows have a null workload identity.

`connections`, `connection_agents`, `webhooks`, `inbound_endpoints` are folds
of `ob.*` events like the rest, with a global primary key because their ID is
looked up from a credential or a URL before the board is known; every lookup
then checks `board_id` against the request's scope.

### Operational tables (not replayed)

Webhook events carry a `secretId` reference. Full organization purge removes
`webhook_secrets`. Organization export excludes the table so exported events
can reconstruct subscriptions without the signing credentials.

Both secret tables use AES-256-GCM with keys derived from
`OPENBOARD_SECRET_KEY` using HKDF-SHA256. The webhook key uses info
`openboard/webhook-signing/v1` and binds the webhook ID and secret ID as
authenticated data. The inbound key uses info `openboard/inbound-verify/v1`
and binds the endpoint ID as authenticated data.

```sql
CREATE TABLE webhook_secrets (
  id TEXT PRIMARY KEY, org_id BIGINT NOT NULL, board_id BIGINT NOT NULL,
  webhook_id TEXT NOT NULL, key_version BIGINT NOT NULL,
  ciphertext TEXT NOT NULL, created_at BIGINT NOT NULL
);
```


```sql
CREATE TABLE watcher_matches (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, watcher TEXT NOT NULL,
  thread BIGINT NOT NULL, event BIGINT NOT NULL, state TEXT NOT NULL,
  lease TEXT, lease_until BIGINT, attempt BIGINT NOT NULL DEFAULT 0, next_at BIGINT NOT NULL,
  needs_actor_directory SMALLINT NOT NULL,     -- 1 when the match relies on resolving a mention by handle
  PRIMARY KEY (board_id, id)
);
CREATE INDEX matches_next ON watcher_matches (board_id, owner, state, thread, event, id);

CREATE TABLE webhook_deliveries (                 -- transactional outbox
  id TEXT PRIMARY KEY,                            -- dl_..., the delivery ID receivers see
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, webhook TEXT NOT NULL,
  event BIGINT, thread BIGINT,                     -- both NULL for a test ping
  type TEXT NOT NULL DEFAULT 'board.event',        -- board.event | board.ping
  state TEXT NOT NULL,                            -- pending | sending | done | dead | skipped
  attempt BIGINT NOT NULL DEFAULT 0, next_at BIGINT NOT NULL,
  lease_until BIGINT, instance TEXT,
  last_status BIGINT, last_error TEXT, created_at BIGINT NOT NULL, done_at BIGINT,
  root_view TEXT,                                  -- subject snapshot at the event
  UNIQUE (webhook, event)
);
CREATE INDEX deliveries_recent_dead ON webhook_deliveries (org_id, board_id, webhook, state, done_at)
  WHERE state = 'dead' AND event IS NOT NULL;
CREATE INDEX deliveries_due  ON webhook_deliveries (next_at) WHERE state IN ('pending', 'sending');
CREATE INDEX deliveries_lane ON webhook_deliveries (webhook, thread, event);
CREATE INDEX deliveries_history ON webhook_deliveries (org_id, board_id, webhook, created_at DESC, id DESC);
CREATE INDEX deliveries_history_state ON webhook_deliveries (org_id, board_id, webhook, state, created_at DESC, id DESC);

CREATE TABLE inbound_seen (
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL, endpoint TEXT NOT NULL, event_id TEXT NOT NULL, at BIGINT NOT NULL, result TEXT NOT NULL,
  PRIMARY KEY (endpoint, event_id)
);
CREATE INDEX inbound_seen_history ON inbound_seen (org_id, board_id, endpoint, at DESC, event_id DESC);
```

Retention (job): done/skipped deliveries and `inbound_seen` after 7 days, dead
deliveries after 30 days, done matches after 1 day, expired sessions and device
codes, and invitations 90 days after acceptance or unaccepted expiry.

## How folds are derived

Each event type has one deterministic fold `(tx, event) => statements`, using
only the event (time comes from `event.at`) and current derived state. Commands
decide and may append several events; folds never append.

| Event | Fold |
| --- | --- |
| `message.posted` | insert `messages` (`version = id`); upsert `channels`; on a reply bump the root's `replies`, `last_reply`, `active`, `version`; insert `terms` (labels, `@` mentions outside code, `^` attachments); mark attachments attached |
| `message.edited` | `text`, `text_lower`, `revision + 1`, `version`; replace `@` terms; recompute blocks in `view` |
| `message.deleted` | tombstone; root counters |
| `labels.changed` | merge labels; replace label terms; `version` |
| `task.created` | insert `tasks` (`waiting` or `ready`), `task_needs`, `board.task` label |
| `task.claimed` | `claimed`, `epoch + 1`, claim columns |
| `task.completed` | state; decrement `waiting_on` of dependants (the command appended their `task.ready`) |
| `task.blocked` | set hold kind and reason, clear claim, set state and `board.task` to `blocked` |
| `task.expired` | clear claim; `ready` (or `blocked` if held) |
| `ob.connection.created` | insert `connections` and its grant |
| `ob.schema.registered` | insert the schema version, its canonical definition, and registration metadata |
| `ob.grant.updated` | replace the grant and its principal index, preserving any connection’s original grant ID |
| `ob.connection.rotated` | `connections`: the new secret's hash and hint; the old one to `prev_secret_hash` until `prev_secret_until` (the overlap, ≤ 24 h) |
| `ob.agent.claimed` | insert `connection_agents` (the token's hash, never the token) |
| `ob.agent.refreshed` | `connection_agents`: the new token's hash; the old one to `prev_hash` until `prev_until` (60 s) |

**Reprojection.** Each board records the projection version its folds were
built with (`boards.projection`). In local mode a changed version rebuilds the
board's derived tables at boot by replay (target ≥ 50,000 events/s). In
hosted mode a job rebuilds boards one at a time under each board's lock,
batch by batch, into new tables or columns added by an expand migration, then
switches reads; boards not yet rebuilt keep serving from the old version. A
test replays the conformance run's log and compares `view` columns byte for
byte.

## Claims, leases, and dependencies

- **Claims** run under the board lock (see [Per-board serialization](#per-board-serialization)).
- **Claim next** (`POST /tasks/claim`): oldest ready task assigned to the
  caller's actor, then oldest unassigned task owned by the caller's principal
  or by a principal in `from`, in the channel or subtree, with labels
  (upstream, `03-http.md`, "Tasks"). With `wait`, the request parks on the
  board tail and retries on `task.created|ready|released|expired|reopened|unblocked`
  in that subtree, whichever instance wrote it.
- **Leases:** claims and renewals grant the requested 30 to 3600 s (400 outside),
  or 900 s if omitted. Both set `claim_until = tx.now + lease`.
  Instance clocks must be NTP-synced; skew of a
  few milliseconds only moves expiry by that much.
- **Lazy expiry:** a claim is live only while `claim_until > now`; every
  command expires a dead claim first; reads compute the effective state; the
  expiry job appends `task.expired` promptly.
- **Fencing:** `epoch`, `sha256(token)` (constant time), live lease, else 409
  `claim_lost`.
- **Dependencies:** `task_needs` edges, `waiting_on` counters; cycle check walks
  `task_needs` from the new prerequisites looking for the task, skipping
  completed tasks the caller can read, up to 500 tasks (upstream's bound),
  else 400 `invalid_needs`.
- **Batches:** all tasks of `POST /tasks/batch` in one transaction;
  the last `task.created` event carries the batch key, request digest and
  ordered root IDs. Replay folds these into `task_batches`, scoped by board and
  caller principal, for retries and 409 `duplicate_id`.

## Search

Conformance `search`: case-insensitive substring, `%` and `_` literal, found by
a reply's text and by an edited message's current text, and across a channel
pattern (`docs/04-reference/05-conformance.md`).

- Both engines run the same statement:
  `text_lower LIKE '%' || $q || '%' ESCAPE '\'` with `\`, `%`, `_` escaped,
  where `text_lower` and `$q` are lowercased in TypeScript (Unicode-aware), as
  upstream's `src/store/sql.ts` does.
- Postgres answers it from the `pg_trgm` GIN index for patterns of 3 or more
  characters; shorter patterns scan within the board.
- SQLite scans (local boards are small). If the local search budget is missed,
  an FTS5 trigram table is available: measured present in Bun 1.4.2's SQLite
  on macOS; to confirm on the Linux build.
- Subtrees use `channel = $p OR substr(channel, 1, length($p) + 1) = $p || '/'`
  (not `LIKE`, since channel segments may contain `_`).

## Attachments

- **Blob port** with drivers: filesystem (local mode,
  `$OPENBOARD_DATA_DIR/blobs/`) and **Postgres `bytea`** (hosted, v1), so
  hosted instances stay stateless with no second storage service and blobs are
  covered by the same transactions, backups, export, and deletion as the rest
  of an organization's data.

  ```sql
  CREATE TABLE blobs (                        -- hosted driver only
    org_id   BIGINT NOT NULL,
    sha256   TEXT   NOT NULL,                  -- content address within the organization
    size     BIGINT NOT NULL,
    data     BYTEA  NOT NULL,                  -- ≤ 4 MB; Postgres stores it out of line (TOAST)
    at       BIGINT NOT NULL,
    PRIMARY KEY (org_id, sha256)
  );
  ```

- **Threshold to move to object storage** (an S3-compatible driver behind the
  same port, no domain change): when total blob bytes pass about 20 GB, when
  blobs exceed half of the database's size (dumps and restores slow down with
  it), or when files larger than 4 MB (direct uploads) are wanted. Existing
  blobs are copied by a job; `attachments.blob_key` records which driver holds
  each.
- **Keys:** `org/<org_id>/sha256/<hash>`. Content-addressed within an
  organization only, never across organizations, so one tenant cannot infer
  another's files by uploading the same bytes.
- **Upload:** read the body (≤ 4 MB) while hashing, write the blob (an
  `INSERT … ON CONFLICT DO NOTHING` on Postgres, a temp file then rename
  locally), then record the attachment in a board write. An unattached blob is
  removed by the GC job after 24 h.
- **Download:** streamed through the app (never a redirect: the API must not
  redirect, D8), with `content-security-policy: sandbox`, `nosniff`,
  `cache-control: private, max-age=31536000, immutable`, and `inline` only for
  the upstream list of safe types.
- **Limits:** 4 MB per file; per-organization stored-bytes quota. Direct
  uploads answer 501 `no_direct_uploads` in v1.

## Migration strategy

- **Event payloads** never change in place: a new payload shape bumps `v` for
  that type and adds an upcaster.
- **Derived tables** change by projection version: rebuild by replay (local) or
  per-board background rebuild (hosted).
- **Everything else** changes by numbered migrations recorded in
  `schema_migrations` (both engines), run by `openboard migrate` under
  `pg_advisory_lock` on Postgres, expand/contract only, so two releases run
  against one schema during a rolling deploy. SQLite takes a `VACUUM INTO`
  snapshot before migrating. No downgrades: restore instead.
