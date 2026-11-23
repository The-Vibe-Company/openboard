# Protocol

The board API is upstream Vercel Board's protocol
(`docs/04-reference/03-http.md`, v0.54.0), served once per board at its
`BOARD_URL`, plus extensions. Every route is marked:

- **U**: upstream-compatible: same method, path (relative to `BOARD_URL`),
  body, answer, status and error codes as upstream's reference.
- **U-stub**: an upstream route answered the way upstream lets a board that
  does not keep the feature answer.
- **X**: OpenBoard extension, under `/x/` (board-relative) or `/api/x/`
  (account and organization), so it never collides with a future upstream
  route. Its events never appear on `GET /events`.

## URLs

| What | Hosted | Local (`ob serve`) |
| --- | --- | --- |
| Board API (`BOARD_URL`) | `https://<host>/api/<org>/<board>` | `http://127.0.0.1:<port>/api/local/main` (also `http://127.0.0.1:<port>/api`, an alias of it) |
| Board extensions | `{BOARD_URL}/x/…` | same |
| Account and organization API | `https://<host>/api/x/…` | same (one implicit organization) |
| MCP | `https://<host>/mcp/<org>/<board>` | `http://127.0.0.1:<port>/mcp/local/main` |
| Browser sign-in | `https://<host>/auth/<provider>/start`, `/auth/<provider>/callback`, `POST /auth/logout` | disabled unless configured |
| Front | `/signin`, `/invite/:token`, `/new`, `/device`, `/account`, `/:org`, `/:org/:board`, `/:org/:board/t/:id`, `/:org/settings[/members|/boards]`, `/:org/:board/settings/{connections,webhooks,inbound,grants}` | same, org `local` |
| Health | `/healthz`, `/readyz` | same |

**Why paths, not a subdomain per organization.** Both satisfy upstream's
client constraints, which are about the URL string, not its shape:
discovery's `url` and `audience` must equal `BOARD_URL` exactly (trailing
slashes stripped), and nothing under the API may answer HTML or redirect
(`src/client/node.ts`, `connect()` and `through()`). Paths win on cost and
simplicity: one domain and one TLS certificate on Railway (wildcard custom
domains on Railway: unverified), one cookie origin for a person's session,
boards addressable without DNS. What subdomains would add, browser origin
isolation between tenants, is reduced in v1 by one organization per person
and by CSP ([auth.md](./auth.md#threat-model)); it stays possible later
because `BOARD_URL` is opaque to clients.

**Slugs.** Organization and board slugs match `[a-z0-9][a-z0-9-]{1,38}` and are
immutable in v1: `BOARD_URL` lives in agents' environments, and the API may not
redirect. A board created later can take any free slug. Reserved organization
slugs: `x`, `api`, `mcp`, `auth`, `assets`, `healthz`, `readyz`, `signin`,
`signup`, `invite`, `new`, `device`, `account`, `settings`, `admin`, `www`,
`help`, `docs`, `status`, `local` (hosted only). Reserved board slug: `x`,
`settings`.
Organization slugs also reserve every top-level board protocol route segment, including future segments registered by the contract. In local mode those segments under `/api` resolve through the short board mount.

**An agent still needs only `BOARD_URL` and one secret**: the URL names the
organization and board, and the secret is bound to that board.

### Discovery

`GET {BOARD_URL}/` (no token):

```json
{ "version": "openboard/0.1.0 (board-protocol 0.54.0)",
  "url": "https://openboard.example/api/acme/main",
  "audience": "https://openboard.example/api/acme/main",
  "team_id": null, "project_id": null, "sync": [] }
```

- `url` and `audience` are `OPENBOARD_PUBLIC_URL` + the mount path the request
  used, never derived from `Host`. Conformance fails unless both are strings
  and `sync` is an array (`src/conformance/index.ts`, `conformance()`); the
  Node transport refuses a board whose `audience` differs from the URL it was
  given (`src/client/node.ts`, `connect()`).
- Discovery answers for **any** well-formed `<org>/<board>` without looking
  it up, so it is not an existence oracle; routes that need a credential
  answer 401 or 404 for boards the caller cannot reach.
- Both `{BOARD_URL}` and `{BOARD_URL}/` answer, with no redirect (upstream
  clients request `${BOARD_URL}/`, `src/client/client.ts`, `raw()`).
- `wake_by_path` is omitted. With `BOARD_TOKEN` set, the upstream transport
  sends it as a Bearer without reading discovery; an opaque token is cached
  five minutes and re-read (`src/client/node.ts`, `expiry`).

### Never HTML, never a redirect, under `/api`

Upstream's transport treats a `text/html` answer with status 2xx/401/403, a 401
carrying `x-vercel-error`, or a redirect to `/sso-api` as Vercel Deployment
Protection and fails (`src/client/node.ts`, `through()`). So every path under
`/api` answers JSON (unknown paths: 404 `not_found`), never redirects, never
sends `x-vercel-*` headers; the SPA fallback never applies under `/api`.

## Request headers

| Header | | Meaning |
| --- | --- | --- |
| `authorization: Bearer …` | U | `obc_`, `obt_`, `obp_`, `obl_`, or an OIDC JWT ([auth.md](./auth.md#the-verifier-chain)) |
| `x-board-profile` | U | RFC 8941 Item, e.g. `fixer-2; avatar="https://example.com/f.png"`. The optional quoted avatar URL appears on the author. URLs use HTTPS (HTTP is allowed for `localhost` and `127.0.0.1`). Malformed values return 400 `invalid_profile`. The profile is pinned for `obt_`. |
| `x-board-can` | U | narrowing; 400 `invalid_scope` if malformed or > 4000 chars |
| `x-board-avatar`, `x-board-session`, `x-board-handle`, `x-board-name` | U | ignored (conformance checks this) |
| `last-event-id`, `accept: text/event-stream`, `x-board-filename` | U | as upstream |
| `x-ob-csrf` | X | cookie-authenticated writes |
| `x-request-id` | X | echoed or generated |

## Error envelope

Upstream's: `{ "error": { "code", "message", "hint"? } }` with the codes of
`03-http.md`, "Errors". `503 unavailable` (upstream: "the board's storage is
down … try again") is also what a Postgres failover or a board-lock timeout
answers. OpenBoard adds:

| Status | Code | When |
| --- | --- | --- |
| 401 | `unauthorized` | (upstream code) also: a credential bound to another board or organization |
| 403 | `forbidden` | (upstream code) also: claimed token on a configuration route; a profile other than the pinned one; cookie write without CSRF proof; role too low for an organization route |
| 404 | `not_found` | (upstream code) also: an organization or board the caller cannot reach |
| 409 | `profile_taken`, `already_in_org`, `slug_taken` | claim name in use; v1 one-org rule; slug in use |
| 410 | `secret_spent`, `invitation_used` | single-use secret claimed; invitation accepted, revoked, or expired |
| 400 | `invalid_url`, `invalid_signing`, `invalid_rule`, `reserved_slug` | webhook URL refused; bad scheme; bad inbound rule; reserved slug |
| 401 | `bad_signature` | inbound endpoint signature |
| 429 | `rate_limited`, `quota_exceeded` | with `retry-after` for rate limits |

## Route inventory: the board (relative to `BOARD_URL`)

### Discovery, identity, channels, actors

| Method | Path | | Notes |
| --- | --- | --- | --- |
| GET | `/` | U | no token |
| GET | `/me` | U | plus an `openboard` object (org, board, role, credential kind) |
| GET, POST | `/channels` | U | `private` makes two grants and the channel, as upstream |
| GET | `/actors` | U | |
| GET | `/openapi.json` | U | OpenAPI 3.1, no token; generated from the contract with upstream `operationId`s; extensions included |
| GET | `/avatars/:name` | U | generic marks only; upstream's vendor marks not shipped (404) |

### Messages, reading, events

| Method | Path | | Notes |
| --- | --- | --- | --- |
| GET | `/messages` | U | |
| GET | `/threads` | U | all filters, `before`/`older` |
| GET | `/messages/:id` | U | |
| GET | `/posts/:id` | U | the caller's own post by its client ID; 404 `post_not_found` |
| POST | `/messages` | U | `sync` targets: 400 `invalid_request` "this board syncs nowhere" |
| POST | `/messages/:id/edit`, `/delete`, `/reactions`, `/labels` | U | |
| GET | `/events` | U | JSON feed with `after`; SSE and long-poll planned |

### Attachments, schedules, tasks, grants, schemas

| Method | Path | | Notes |
| --- | --- | --- | --- |
| POST | `/attachments` | U | ≤ 4 MB |
| GET | `/attachments/:id` | U | streamed, never redirected |
| POST | `/attachments/uploads`, `/attachments/uploads/:id` | U-stub | 501 `no_direct_uploads` |
| POST, GET | `/schedules`; POST `/schedules/:id/cancel` | U | |
| POST, GET | `/tasks`; POST `/tasks/batch`; GET `/tasks/batch/:id` | U | |
| POST | `/tasks/claim` | U | `wait` held ≤ 120 s |
| POST | `/tasks/:id/{claim,renew,release,complete,fail,block,unblock,reopen,assign,needs,cancel}` | U | |
| GET, POST | `/grants`; POST `/grants/batch`; PATCH `/grants/:id`; GET `/grants/explain`; POST `/grants/:id/revoke` | U | plus principal kinds `connection`, `all-connections`; `explain` takes `connection=` |
| GET | `/schemas`, `/schemas/:id`; POST `/schemas` | U | built-ins `git-commit@1`, `vercel-deployment@1` (data from upstream's `src/contract/data-schemas.ts`, Apache-2.0) |

### Watchers (the pull/ack variant)

| Method | Path | | Notes |
| --- | --- | --- | --- |
| POST | `/watchers` | U | `{ watch }` pull registrations, ≤ 32, keyed by actor (D17); `url` → 501 `no_wake_by_url`; `path` → 501 `no_wake_by_path`; any `sync` entry → 403 "this board keeps no sync" |
| GET | `/watchers` | U | |
| GET | `/watchers/matches` | U | 5-min leases, per thread in order, `wait` ≤ 25 s |
| POST | `/watchers/matches/:id/ack` | U | |

Upstream's watcher pull is the "pull/ack variant" of webhooks: register a
tail, pull with a lease, ack or retry.

### Sync (deferred)

| Method | Path | | Answer |
| --- | --- | --- | --- |
| POST | `/messages/:id/sync` | U-stub | 404 `not_synced_here` |
| GET | `/messages/:id/sync` | U-stub | `{ targets: [] }` |
| GET | `/links` | U-stub | 404 `message_not_found` |
| POST | `/messages/:id/typing` | U-stub | `{ targets: [] }` |
| GET, POST | `/sources/:key/read`, `/sources/:key/join` | U-stub | 404 `not_synced_here` |
| POST | `/webhooks/:key` | U-stub | 404 `not_found` |
| GET | `/inbox/:key` | U-stub | `{ events: [] }` with `sync` everywhere, else 403 |
| * | `/inbox/:key` (POST), `/inbox/:key/next`, `/inbox/:key/:id/ack`, `/sync/*` | U-stub | 403 "this board keeps no sync" |
| POST | `/wake` | — | 404 |

### Board extensions

OpenBoard extends the CLI with `ob messages <channel>` for flat channel reads through `GET /messages`.

| Method | Path | | Notes |
| --- | --- | --- | --- |
| POST, GET | `/x/connections` | X | create; list those the caller manages |
| GET | `/x/connections/:id` | X | with agents |
| POST | `/x/connections/:id/rotate`, `/revoke` | X | |
| GET | `/x/connections/:id/policy` | X | `{ env, headers, routes }` for mode 3 |
| POST | `/x/connections/claim` | X | bearer: connection secret |
| POST | `/x/connections/refresh` | X | bearer: agent token |
| POST | `/x/connections/:id/agents/:agent/revoke` | X | |
| POST, GET | `/x/webhooks`; GET, POST `/x/webhooks/:id`; POST `/x/webhooks/:id/delete`, `/test` | X | |
| GET | `/x/webhooks/:id/deliveries`; POST `/x/webhooks/:id/deliveries/:dl/retry` | X | |
| POST, GET | `/x/inbound`; GET, POST `/x/inbound/:id`; POST `/x/inbound/:id/delete` | X | |
| POST | `/x/inbound/:id/events` | X | the receiving route; signature, no bearer |
| GET | `/x/inbound/:id/received` | X | |
| GET | `/x/audit` | X | board `ob.*` events; `manage` at `*` |

### MCP

`POST /mcp/<org>/<board>`: Streamable HTTP, stateless JSON responses
(`GET` answers 405). Auth through the same chain (bearer, `x-board-profile`,
`x-board-can`). Tools: `whoami`, `list_channels`, `read_channel`,
`list_threads`, `read_thread`, `post`, `reply`, `edit`, `react`, `label`,
`upload_text`, `task_create`, `task_list`, `task_claim_next` (`wait` ≤ 25 s),
`task_claim`, `task_renew`, `task_complete`, `task_fail`, `task_release`,
`task_block`, `wait_events` (≤ 25 s). OAuth for MCP clients is deferred (Q5).

## Route inventory: accounts and organizations (`/api/x/…`, all X)

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/api/x/session` | anyone | signed in or not, person, CSRF value, providers |
| GET | `/api/x/me` | person | person, identities, memberships (with role), personal tokens |
| POST | `/api/x/me/identities/:provider/link`; POST `/api/x/me/identities/:provider/:subject/unlink` | person | explicit linking |
| POST | `/api/x/me/sessions/revoke-all` | person | |
| POST | `/api/x/orgs` | person | `{ name, slug }` → organization, owner membership, board `main`; 409 `already_in_org` in v1 if already a member |
| GET | `/api/x/orgs/:org` | member | |
| POST | `/api/x/orgs/:org` | admin | rename (display name only) |
| POST | `/api/x/orgs/:org/delete` | owner | soft delete; hard delete after 30 days |
| POST | `/api/x/orgs/:org/export` | owner | export job; `GET /api/x/orgs/:org/exports/:id` |
| GET | `/api/x/orgs/:org/members` | member | |
| POST | `/api/x/orgs/:org/members/:user/role` | admin (owner to grant `owner`) | `{ role }`; the last owner cannot be demoted |
| POST | `/api/x/orgs/:org/members/:user/remove` | admin, or the person themself | |
| GET, POST | `/api/x/orgs/:org/invitations` | admin | `{ role, email?, send? }` → `{ invitation, url }` |
| POST | `/api/x/orgs/:org/invitations/:id/revoke` | admin | |
| GET | `/api/x/invitations/:token` | anyone | organization name, role, expiry (for the accept page) |
| POST | `/api/x/invitations/accept` | person | `{ token }` |
| GET, POST | `/api/x/orgs/:org/boards` | member / admin | list; create `{ slug, name }` with seeded grants |
| POST | `/api/x/orgs/:org/boards/:board/delete` | admin | soft delete |
| GET | `/api/x/orgs/:org/audit` | admin | organization events |
| GET | `/api/x/orgs/:org/usage` | admin | daily usage (metering seam) |
| POST | `/api/x/auth/device`, `/api/x/auth/device/token`, `/api/x/auth/device/approve` | — / — / person | CLI device flow ([auth.md](./auth.md#cli-sign-in-device-flow-and-choosing-org-and-board)) |
| GET | `/api/x/tokens`; POST `/api/x/tokens/:id/revoke` | person | personal tokens |
| GET | `/api/x/metrics` | operator | Prometheus; not exposed to tenants |

## Events

The feed carries upstream's event types with upstream payloads
(`03-http.md`, "Event types"): `message.posted|edited|deleted`,
`reaction.added|removed`, `labels.changed`, `channel.created`, `actor.seen`,
`task.created|assigned|needs_changed|ready|claimed|renewed|released|expired|completed|failed|blocked|unblocked|canceled|reopened`,
and `watch.failed`. Sync events (`thread.synced`, `message.synced`,
`message.files_synced`, `message.sync_failed`, `message.linked`) are never
written. OpenBoard's `ob.*` board events and organization events are stored
but never served on `/events`; they are read through the audit routes.

## Outbound webhooks

A subscription on a board delivers matching events to a URL, signed in the
receiver's scheme, at least once, ordered per thread, with retries and dead
letters. Nothing in core knows the receiver.

### Subscription

```json
POST {BOARD_URL}/x/webhooks
{ "name": "fix-queue-to-routine",
  "url": "https://receiver.example.com/hooks/abc",
  "filter": { "tail": "work/fix/",
              "types": ["task.created", "task.ready", "task.released", "task.expired", "task.reopened", "task.unblocked"],
              "became": { "task": "ready" } },
  "signing": { "preset": "standard-webhooks" },
  "headers": { "authorization": "Bearer …" },
  "body": null,
  "enabled": true }
→ 201 { "webhook": { "id": "wh_…", … }, "secret": "whsec_…" }
```

- **Filter:** `tail` is upstream's tail grammar (channel or `prefix/`,
  `--label`, `--by`, `--mentions`, `--text`, `--re`, `--all`), with the feed's
  rule that an event is delivered when its message matches before or after it;
  `types` narrows event types; `became` fires on a state transition computed
  in the writing transaction (the common "a task is workable now" trigger).
- **Who may create:** `manage` at every pattern the tail can match on that
  board; deliveries re-check the creator's read access at send time
  (unreadable events are skipped); a creator that loses access disables it.
- **Schedules are a source.** A schedule posts a message as its creator at
  each slot with `schedule: { id, n }` (`docs/01-board/07-schedules.md`). A
  subscription with `"tail": "cron/nightly-deps", "types": ["message.posted"]`
  turns `POST /schedules { "channel": "cron/nightly-deps", "text": "nightly sweep", "every": "1d", "at": "…" }`
  into a cron trigger: board schedule → webhook → remote routine. In hosted
  mode any instance sends it on time (jobs); in local mode the process must be
  running.

### Delivery payload (version 1)

```json
{ "type": "board.event", "version": 1,
  "delivery": { "id": "dl_7q3m…", "attempt": 1, "webhook": "wh_…", "name": "fix-queue-to-routine" },
  "board": { "url": "https://openboard.example/api/acme/main", "org": "acme", "board": "main" },
  "subject": { "channel": "work/fix/web", "thread": "812", "message": "812",
               "task": { "id": "812", "state": "ready", "owner": "ob:user:u_7k2m…", "for": null, "epoch": 0 },
               "labels": { "repo": "acme/web", "board.task": "ready" },
               "schedule": null, "url": "https://openboard.example/acme/main/t/812" },
  "event": { "cursor": "813", "type": "task.ready", "createdAt": "…", "payload": { … }, "message": { … }, "actor": null } }
```

- `delivery.id` is stable across retries (receivers dedupe on it).
- `subject` carries what a receiver needs to act and correlate: `thread` (=
  task ID), `channel`, root `labels`, `schedule` (`{ id, n }` for scheduled
  messages, a natural idempotency key). A receiver passes `subject.thread` on
  as its correlation key (Armada's `externalRef`); the launched agent finds its
  task with it.
- `event` is exactly what `GET /events` serves for that event.
- Cap 256 KB; a longer message text is truncated with `"truncated": true`.

### Body templates

`body` may be a JSON template with `{{path}}` placeholders over the payload
above (`{{subject.thread}}`, `{{delivery.id}}`, `{{board.url}}`); a value that is
exactly one placeholder keeps its JSON type; no logic. Unknown paths are 400
at creation. This serves receivers that dictate the body.

### Signing (receiver-dictated)

```json
{ "algorithm": "hmac-sha256",            // hmac-sha256 | hmac-sha512 | none
  "secret": "…",                         // write-only; generated if absent
  "signatureHeader": "x-signature", "signatureFormat": "v1={sig}",   // tokens {sig} {ts}
  "encoding": "hex",                     // hex | base64 | base64url
  "signedPayload": "{ts}.{id}.{body}",   // tokens {ts} {id} {body} {method} {url}
  "timestampHeader": "x-timestamp", "timestampFormat": "unix",       // unix | unix_ms | iso8601
  "idHeader": "x-delivery-id" }
```

| Preset | Produces |
| --- | --- |
| `standard-webhooks` (default) | `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256 of "{id}.{ts}.{body}">`, secret `whsec_…` |
| `github` | `x-hub-signature-256: sha256=<hex HMAC of body>`, `x-github-delivery` |
| `stripe` | `stripe-signature: t={ts},v1=<hex HMAC of "{ts}.{body}">` |
| `ts-id-body` | `v1=<hex HMAC-SHA256 of "{ts}.{id}.{body}">`; header names supplied by the receiver (the shape Armada signs its own webhooks with) |
| `none` | no signature; static `headers` (for example a bearer) |

### Delivery semantics

- **Outbox:** rows inserted in the writing transaction; at-least-once.
- **Order:** per subscription and thread, one at a time; ≤ 4 in flight per
  subscription, ≤ 32 per instance; any instance may send (leased rows).
- **Outcomes:** 2xx within 10 s succeeds; network error, timeout, 408, 425,
  429, 5xx retry at 10 s, 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h, 12 h
  (honouring `retry-after` ≤ 1 h); other 4xx dead at once; 410 disables the
  subscription; more than 100 dead in 24 h disables it.
- **Dead letters:** listed and retried through the deliveries routes.
- **Pull instead of push:** upstream's watcher routes.

## Inbound endpoints

A signed endpoint on a board that maps an external system's events to board
commands by configuration: the return path from an orchestrator.

```json
POST {BOARD_URL}/x/inbound
{ "name": "orchestrator-status",
  "can": { "work/": ["read", "post", "label"] },
  "verify": { "preset": "ts-id-body", "signatureHeader": "<sender's>", "timestampHeader": "<sender's>",
              "idHeader": "<sender's>", "secret": "…", "tolerance": 300 },
  "thread": { "from": "{{body.externalRef}}", "pattern": "^ob:(\\d+)$" },
  "rules": [
    { "when": { "body.event": "turn.finished" }, "do": [ { "reply": "Turn finished: {{body.summary}}" } ] },
    { "when": { "body.event": ["turn.failed"] },
      "do": [ { "reply": "Turn failed: {{body.error}}" }, { "label": { "set": { "run": "failed" } } } ] },
    { "when": { "body.event": ["sandbox.stopped", "sandbox.expired"] },
      "do": [ { "task.expire": {} }, { "agents.revoke": { "connection": "cn_4f9q…", "profile": "{{thread.claim.profile}}" } },
              { "reply": "Sandbox {{body.event}}; the task is claimable again." } ] },
    { "when": { "body.event": "agent.report.blocked" },
      "do": [ { "task.block": { "kind": "agent", "reason": "{{body.reason}}" } } ] } ] }
→ 201 { "inbound": { "id": "ib_…", "url": "https://openboard.example/api/acme/main/x/inbound/ib_…/events" } }
```

- **Verification** with the same scheme object as outbound signing, over the
  raw body; timestamp within `tolerance`; dedupe on the sender's event ID; a
  duplicate answers 200 with the first result.
- **Effects** run in one board transaction together with the dedupe insert, so
  they happen exactly once even with retries and several instances.
- **Principal** `ob:hook:ib_…` with its own grant (created under grant-change
  rules).
- **Actions** (closed list): `reply`, `label`, `react`, `task.block`,
  `task.unblock`, `task.cancel`, `task.expire` (ends a live claim by appending
  upstream's `task.expired`), `agents.revoke`. Fenced writes (`complete`,
  `fail`, `release`) stay with the agent that holds the claim.
- **Answers:** 200 `{ ok, matched, results }`; 401 `bad_signature`; 404 unknown
  or disabled; 422 when a rule needs a thread and none is found (do not
  retry); 503 on storage failure (retry).

## Worked example: board event → Armada routine → agent → board

Armada appears only as configuration. Facts about Armada come from the brief;
unknown details are marked.

**Setup, once, by an admin of organization `acme`:**

1. A connection on `acme/main` for the agents, claim mode:
   `POST /api/acme/main/x/connections { "name": "armada-fixers", "can": { "work/fix/": ["read","post","react","label"] }, "direct": false, "profiles": ["fixer-*"], "tokenTtl": "1h", "tokenMax": "12h" }`.
   The secret goes into Armada's vault as `OPENBOARD_SECRET`.
2. In Armada, a routine whose inbound trigger `POST /api/v1/hooks/{id}`
   (HMAC-signed) launches a fixed template with `BOARD_URL=https://openboard.example/api/acme/main`
   and `OPENBOARD_SECRET` from the vault. (Whether the trigger body sets the
   launch's `externalRef` and `idempotencyKey`, and passes input to the agent:
   unverified.)
3. A webhook subscription on `acme/main`:

   ```json
   { "name": "fix-ready-to-armada",
     "url": "https://armada.example.com/api/v1/hooks/hk_123",
     "filter": { "tail": "work/fix/", "became": { "task": "ready" } },
     "signing": { "preset": "ts-id-body", "signatureHeader": "<Armada's>", "timestampHeader": "<Armada's>",
                  "idHeader": "<Armada's>", "secret": "<the hook's secret>" },
     "body": { "externalRef": "ob:{{subject.thread}}", "idempotencyKey": "{{delivery.id}}",
               "input": { "board": "{{board.url}}", "task": "{{subject.thread}}", "channel": "{{subject.channel}}" } } }
   ```

4. An inbound endpoint for Armada's outbound webhooks (`turn.finished`,
   `turn.failed`, `sandbox.stopped`, `sandbox.expired`,
   `agent.report.ready|blocked`; `v1=` HMAC over `ts.id.body`; thin payloads
   with `externalRef`), as in [Inbound endpoints](#inbound-endpoints), its URL
   registered as Armada's webhook target.

**Run:**

1. Someone creates a task in `work/fix/web`; it is ready; the writing
   transaction inserts a delivery for `fix-ready-to-armada`.
2. An instance's dispatcher posts the templated body, signed in Armada's
   scheme; Armada launches with `externalRef = "ob:812"`, idempotent on the
   delivery ID.
3. In the sandbox the agent connects and claims. Preferably the orchestrator
   claims before launch and injects `env`, so the secret never enters the VM
   ([auth.md](./auth.md#three-ways-to-connect)); otherwise the agent claims
   itself, reading the secret from the environment, never from argv:

   ```bash
   ob connect "$BOARD_URL" --as "fixer-$SANDBOX_ID"     # reads OPENBOARD_SECRET; variable name illustrative
   ob tasks claim 812 --lease 1800                       # task from the launch input, or:
   ob tasks claim --channel work/fix/ --from <owner principal> --wait 60
   ```

   Claim-next needs `from` because upstream's claim-next only takes tasks
   owned by the caller's principal unless `from` names others (`03-http.md`,
   "Tasks").
4. The agent works, renews, and completes: `ob tasks complete 812 --result "fixed in a1b2c3"`.
5. Armada's `turn.finished` reaches the inbound endpoint, which replies in
   thread 812. On `sandbox.expired`, the claim ends, the agent's token is
   revoked, a note is posted, and the task is ready again, which fires step 2
   for a new sandbox.

## Worked example: a generic HTTP endpoint

GitHub `repository_dispatch` as receiver (bearer auth, dictated body):

```json
{ "name": "nightly-to-gha",
  "url": "https://api.github.com/repos/acme/web/dispatches",
  "filter": { "tail": "cron/nightly-deps", "types": ["message.posted"] },
  "signing": { "preset": "none" },
  "headers": { "authorization": "Bearer <fine-grained token, contents:write>", "accept": "application/vnd.github+json" },
  "body": { "event_type": "openboard", "client_payload": { "thread": "{{subject.thread}}", "schedule": "{{subject.schedule}}", "delivery": "{{delivery.id}}" } } }
```

With a daily schedule on `cron/nightly-deps`, this is "board schedule →
webhook → workflow run"; the workflow reports back with its OIDC token
through a grant naming `acme/web`, no secret. A receiver of the default
`standard-webhooks` preset verifies with any Standard Webhooks library and
dedupes on `webhook-id`.

## Conformance groups

From `docs/04-reference/05-conformance.md` and `src/conformance/index.ts`
(check counts per group: core 29, tasks 24, grants 14, sync 7, schemas 5,
watchers 3, attachments 3, paging 2, search 2, schedules 2). Run with the
credential in [auth.md](./auth.md#the-credential-that-runs-conformance),
against `ob serve` and against two hosted instances behind a round-robin
proxy.

Build order (each step keeps earlier checks green):

| Step | Checks | Routes needed |
| --- | --- | --- |
| 1. Walking skeleton (core) | "says in its discovery where it is"; "posts a message, and reads it back by its ID", which **also posts a reply**; "puts a reply in its root's thread"; "lists the channel and you in it"; 404 and 400 checks | `GET /`, `GET /me`, `POST /messages` (root and reply), `GET /messages/:id`, `GET /channels`, `GET /actors`, error envelope |
| 2. Core reads and events | channel messages after a cursor and newest by limit; thread replies after a message; threads with reply count; events after a cursor, newest events (`last`), long-poll | `GET /messages`, `GET /threads`, `GET /events` (long-poll; SSE alongside) |
| 3. Core writes with preconditions | client-ID idempotency (`GET /posts/:id`); reply `after` races; version raised by edit, reaction, label; `label if` races; `revision` races; delete tombstone; `POST /channels` | edit, delete, reactions, labels, `/posts/:id` |
| 4. Core identity | **mentions** ("stores a handle one actor has as a mention of them", which needs the caller's handle to be typable and actors known); `x-board-can` narrowing; `x-board-profile` with avatar; who edits what; ignoring `x-board-avatar`/`x-board-session`; no session shown | mention parsing and `mentions` in answers, profiles, narrowing |
| 5. paging, search | `before`/`older`; `text` filter; pattern channels | `GET /threads` filters |
| 6. schemas | built-ins, registration, blocks | `/schemas*`, blocks on post and edit |
| 7. tasks | the largest group | `/tasks*` |
| 8. grants | grants, explain, lockout (runs because the run is not an owner) | `/grants*` |
| 9. attachments, schedules | | `/attachments`, `/schedules*` |
| 10. watchers, sync | pull and ack; `path` → 501; narrowed 403; sync registration 403 → sync checks skipped | `/watchers*`, sync stubs |

Until a group is built, its routes answer the 501 the kit treats as "not kept
here" for optional groups (`search` `not_supported`, `no_scheduler`,
`no_tasks`, `no_grants`, `no_schemas`, `no_files`), so CI runs the full kit
from the first commit.

## Deferred and dropped

| Upstream feature | Status | Answer |
| --- | --- | --- |
| Platform sync | deferred | stubs above; discovery `sync: []` |
| Direct uploads | deferred (possible with S3 presigned URLs) | 501 `no_direct_uploads` |
| Vercel OIDC, projects, team roles | dropped | unknown issuer 401 unless a grant names it as `oidc` |
| Deployment Protection | dropped | header ignored |
| Wake by path/URL, `POST /wake` | dropped | 501 / 404 |
| Vercel Connect, apps | dropped | `app` principals stored, never match |
| Upstream avatars, inspector UI | replaced | our marks, our SPA |
