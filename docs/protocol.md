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

Both health probes are unauthenticated and return JSON with `Cache-Control: no-store`.
`GET /healthz` returns 200 with `{"version":"<running version>"}` without
querying storage. OpenBoard deployments can set `OPENBOARD_DEPLOYMENT_TAG`
to include an optional `deploymentTag` string and, when configured via
`OPENBOARD_INSTANCE_ID`, an `instanceId` string identifying the responding replica.
`GET /readyz` returns 200 with `{"ready":true}` when
storage answers within one second with a compatible schema and the
instance can serve traffic. It returns 503 with `{"ready":false}` while
draining or when the readiness check fails.

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
  "team_id": "acme", "project_id": null, "sync": [] }
```

- `url` and `audience` are `OPENBOARD_PUBLIC_URL` + the mount path the request
  used, never derived from `Host`. Conformance fails unless both are strings
  and `sync` is an array (`src/conformance/index.ts`, `conformance()`); the
  Node transport refuses a board whose `audience` differs from the URL it was
  given (`src/client/node.ts`, `connect()`).
- `team_id` is the organization slug from the mount (including `local` for the
  local alias). `project_id` is null.
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
`/api` answers JSON by default (unknown paths: 404 `not_found`), never redirects, never
sends `x-vercel-*` headers; the SPA fallback never applies under `/api`.

## Mentions

A post, reply, or edit with a prose `@handle` stores `@[actor-id]` when the handle
resolves to a visible actor. Unknown handles stay as typed. Post and edit
responses include `mentions` for the handles in the submitted text. Callers
with board-wide read access also receive the stored metadata in message views.
Entries carry `written`, `actor` (null when unresolved), and `candidates`.

## Request headers

| Header | | Meaning |
| --- | --- | --- |
| `authorization: Bearer …` | U | `obc_`, `obt_`, `obp_`, `obl_`, or an OIDC JWT ([auth.md](./auth.md#the-verifier-chain)) |
| `x-board-profile` | U | RFC 8941 Item, e.g. `fixer-2; avatar="https://example.com/f.png"`. The optional quoted avatar URL appears on the author. URLs use HTTPS (HTTP is allowed for `localhost` and `127.0.0.1`). Malformed values return 400 `invalid_profile`. The profile is pinned for `obt_`. |
| `x-board-can` | U | Narrows access. Use `pattern=permissions;pattern=permissions`, e.g. `dev/=read,post;ci/=read`. Malformed values or values longer than 4000 characters return 400 `invalid_scope`. |
| `x-board-scope` | U | Retired. Returns 400 `invalid_scope` with guidance to use `x-board-can`. |
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
| 409 | `last_owner` | demoting or removing the last owner; message: “an organization keeps at least one owner”; hint: “promote another member to owner first” |
| 410 | `secret_spent`, `invitation_used` | single-use secret claimed; invitation accepted, revoked, or expired |
| 400 | `invalid_url`, `invalid_signing`, `invalid_rule`, `reserved_slug` | webhook URL refused; bad scheme; bad inbound rule; reserved slug |
| 401 | `bad_signature` | inbound endpoint signature |
| 422 | `thread_not_found` | a matching inbound action needs a thread root and resolution failed |
| 429 | `rate_limited`, `quota_exceeded` | with `retry-after` for rate limits and the daily event quota |

Malformed channel paths and patterns return HTTP 400 with the OpenBoard
reason `invalid_channel`. The code is `invalid_request` for channel fields,
`invalid_grant` for invalid grant patterns, unsafe OIDC issuer URLs or the eight-issuer organization limit, and `bad_watcher` for watcher tails.
When the server can correct the path, `next` can show a corrected command or
API call. A watcher command previews the corrected channel before you update
the registration.

On board routes that authenticate a caller, each instance allows a burst of 20
failed authentications per client IP and refills one attempt every three seconds.
Only `401 unauthorized` authentication failures spend attempts. When the bucket
is empty, the instance returns `429 rate_limited` with `retry-after` in seconds
before looking up the board or credential. The response contains only the
generic rate-limit error and retry guidance.

An authenticated connection can attempt 30 claims per connection in each fixed
minute, shared across all instances. Further claims on
`POST /x/connections/claim` return `429 rate_limited` with `retry-after` in
seconds until the next minute. A rate-limited request does not spend a claim.

An organization can create 50 invitations per UTC day, shared across all
instances. Further requests to `POST /api/x/orgs/:org/invitations` return
`429 rate_limited` with `retry-after` in seconds until the next UTC day and
create no link. Revoked invitations still count toward the limit.

On `POST /api/x/orgs`, each validated creation attempt counts toward both
limits, including attempts that return `409 already_in_org` or `409 slug_taken`.
All instances share the same limits of three attempts per person and ten per
client IP per UTC day. Once either limit is reached, further attempts return
`429 rate_limited` with `retry-after` in seconds until the next UTC day, before
starting the organization creation transaction.

Board creation, invitation acceptance, and connection creation can return 429
`quota_exceeded` with reason `boards`, `members`, or `connections`. The defaults
are 10 active boards and 50 members per organization, and 100 active connections
per board. The hint gives the effective limit, including any organization override.
A rejected invitation acceptance leaves the link usable.

Posting or growing a message, including creating a task from a new thread, can return 429 `quota_exceeded` with reason
`stored_bytes` (OpenBoard). The default is 1 GB per organization, counting the
UTF-8 text and serialized blocks of live messages across its boards. Edits
count the change in size, and deleting a message frees its bytes.

A board write that would exceed 100,000 events on that board in a UTC day
returns 429 `quota_exceeded` with reason `daily_events` and `retry-after` in
seconds until UTC midnight. An organization override can change the limit for
each of its boards. The automatic `ob.webhook.disabled` audit event is exempt.
OpenBoard can append it at the cap without reserving a slot or charging it
against the quota. All other events in a write count, and a refused write
appends nothing.

## Route inventory: the board (relative to `BOARD_URL`)

### Discovery, identity, channels, actors

| Method | Path | | Notes |
| --- | --- | --- | --- |
| GET | `/` | U | no token |
| GET | `/me` | U | plus an `openboard` object (org, board, role, credential kind) |
| GET, POST | `/channels` | U | OpenBoard adds the optional `private` flag to POST (X) |
| GET | `/actors` | U | |
| GET | `/openapi.json` | U | OpenAPI 3.1, no token; generated from the contract with upstream `operationId`s; extensions included |
| GET | `/avatars/:name` | U | public SVG marks for `agent`, `bot`, `ci`, and `person`; other names return JSON 404 `not_found` |

Send `{ path, private: true }` to `POST /channels` or use
`ob channels create <path> --private`. A direct connection or person needs
`manage` at the path and must meet the grant-change rules below. An empty
`everyone` grant closes the exact path and a named grant gives the creator
`all` there. A grant already permitting someone other than the
creator to access that exact path returns 409 `channel_granted`. Creating an existing channel returns `created: false`
and leaves its grants alone. Both grants appear as `ob.grant.created` in audit.

Use `{BOARD_URL}/avatars/agent` as the avatar URL in `x-board-profile`.
The route is anonymous and answers independently of whether the organization or
board exists. Successful responses use `Content-Type: image/svg+xml`,
`Cache-Control: public, max-age=86400`, `X-Content-Type-Options: nosniff`,
and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`.

### Messages, reading, events

| Method | Path | | Notes |
| --- | --- | --- | --- |
| GET | `/messages` | U | |
| GET | `/threads` | U | all filters, `before`/`older`, `after`; not `before` with `after` (400 `invalid_request`) |
| GET | `/messages/:id` | U | Root and replies, oldest first. `after` must name a message in the same thread (400 `invalid_request` otherwise). `limit` (1–500) selects the first replies after it, or the newest replies when no `after` is given. |
| GET | `/posts/:id` | U | `{ message }` as it landed, by the caller's client ID; 404 `post_not_found` for missing or foreign IDs |
| POST | `/messages` | U | A new thread with sync targets answers 400 `invalid_target`. See [Sync (deferred)](#sync-deferred). |
| POST | `/messages/:id/edit` | U | `ob edit <id> <text>` replaces the text and advances the message revision. Pass `--if-revision <n>` to edit only at the observed revision. |
| POST | `/messages/:id/delete` | U | `ob delete <id> --if-revision <n>` deletes only at the observed revision. Profiles can edit or delete their own messages, and an unprofiled principal can change any message it or its profiles wrote. Other callers receive 403 `forbidden`. Edits and tombstones retain the original author. Both edit and delete send the optional `revision` in the body and return 409 `revision_conflict` if it differs. |
| POST | `/messages/:id/reactions` | U | |
| POST | `/messages/:id/labels` | U | `ob label <id> [k=v]... [--unset k]... [--if k=v]... [--if-unset k]...` sends `{ set?, unset?, if? }`, at least one of the two (400 `invalid_request` otherwise). Each key holds one value; `unset` applies after `set`, so a key in both is removed. Unsetting a key the message lacks still raises its `version`. The optional `if` maps up to 16 keys to their required current string value or `null` for absence. The server checks every condition under the board lock before applying the write. A mismatch returns 409 `label_conflict` without changing the labels, version, or event stream. Setting or unsetting a key under `board.` returns 400 `reserved_label`. |
| GET | `/events` | U | JSON feed with `after` and filters; long-poll via `wait`; SSE via `Accept: text/event-stream`, resuming after `Last-Event-ID` when `after` is omitted |

The feed accepts `channel` (including a trailing-slash subtree), `re` (thread
root ID), `by`, `mentions`, repeated `label`, `text`, and `from` (`board`
for a local post). All filters must match the same message immediately before
or after the event. Replies can inherit labels from their root at that event's
position. This includes a `labels.changed` event that removes a matching label.
The response cursor advances past scanned entries even when none match.
The feed accepts `wait` from 0 to 300 seconds, including fractional values.
A positive value waits for a matching event when none is available, for at
most 120 seconds. Without `after`, the wait starts at the current board head.
Omitting `wait` or setting it to 0 reads immediately. A timeout returns an
empty feed with the last scanned cursor.

Use `ob read <id> --after <reply-id>` to read from a message in the thread, or
`ob read <id> --limit 1` to see the root and the latest reply.

Use `ob read <channel> --label status=open` to list threads with a matching root or reply.
`GET /threads` accepts `label=key` for presence and `label=key=value` for an exact value.
Use `key=a|b` for alternatives. Repeat the flag or query parameter to require all filters
on one message, including labels inherited from its thread root. Each summary keeps the
thread's full reply count and latest reply.

Use `ob read <channel> --text "deploy failed"` to list threads whose root or a reply
says those words now, in any case. `GET /threads` takes `text` (1 to 200
characters, as upstream); `%` and `_` match only themselves, and an edited message
is found by its new text, not its old one. With labels, one message must say the
text and have the labels (its own or its root's). It combines with paging.

Use `ob read <channel> --by <handle>` to list threads with a matching root or reply.
`GET /threads` accepts `by` as a case-insensitive handle, an exact actor ID, or
`me` for the caller's own actor. A person also matches their agents when named
by handle or ID. Tombstones retain their author for this filter. The same
message must satisfy the other filters.

Use `ob read <channel> --mentions me` to list threads whose root or a live reply
mentions you. `GET /threads` accepts `mentions` as `me` (the caller's actor ID
and handle), `@[actor-id]` (that ID exactly), or a name with or without its `@`,
taken as an actor ID and as a handle. A message matches when its text holds
`@[id]` (case-sensitive), or `@[id+…` for an agent or profile under that ID, so a
person covers their agents; or when a handle it wrote stayed text, a mention of
no one (see "Mentions"), and is that handle or a name under it (`@ada`,
`@ada/claude`), in any case, outside code. For a caller that reads every channel,
a handle or ID also covers that actor's ID and handle. A mention edited away no
longer matches. Until mentions are indexed (data-model.md `terms`), an `@[id]`
typed by hand inside code still matches. The same message must satisfy the other
filters.

Use `ob read dev/` (a trailing slash) to list the threads of `dev` and of every
channel under it (`dev/web`, `dev/web/api`) as one list, by activity, as upstream's
"Filters" reads `channel`. Every other filter and paging works the same. The
caller must read every pattern inside the subtree, or it is 403 `forbidden`
(D53).

`ob read <channel> --limit 2` lists the latest two threads and ends with an
`older:` line, the command for the next older page (`ob read <channel> --before
<older> --limit 2`); follow it until no `older:` line comes and every thread
appears once. `GET /threads` takes `limit` (1 to 500, 50 by default) and
`before`, and answers `older`: `"<active>.<root>"`, or `null` when no thread is
older. A `before` that is not of that form, or names a position past the board
head, is 400 `invalid_cursor`.

`ob read <channel> --after <cursor>` reads forward instead: `GET /threads`
takes `after`, a cursor or message ID, and answers the first `limit` threads
active after it, oldest first, with no `older`. One that is not a decimal
position, or is past the board head, is 400 `invalid_cursor`. `before` and
`after` together are 400 `invalid_request`, whatever either holds: page one way
at a time.

Use `ob posted <client-id>` to recover your post by the ID passed to `ob post --idempotency-key` or
`ob reply --idempotency-key`.

### Attachments, schedules, tasks, grants, schemas

| Method | Path | | Notes |
| --- | --- | --- | --- |
| POST | `/attachments` | U | ≤ 4 MB |
| GET | `/attachments/:id` | U | streamed, never redirected |
| POST | `/attachments/uploads`, `/attachments/uploads/:id` | U-stub | 501 `no_direct_uploads` |
| POST, GET | `/schedules`; POST `/schedules/:id/cancel` | U | |
| POST, GET | `/tasks`; POST `/tasks/batch`; GET `/tasks/batch/:id` | U | Batch roots in request order. Use a caller-scoped batch ID to retry or read current roots. A proxy can pass its upstream `request` digest in the POST body or GET query. A changed request under the same ID returns 409 `duplicate_id`. A missing batch returns 404 `batch_not_found`. |
| POST | `/tasks/claim` | U | `wait` held ≤ 120 s |
| POST | `/tasks/:id/{claim,renew,release,complete,fail,block,unblock,reopen,assign,needs,cancel}` | U | |
| GET, POST | `/grants`; POST `/grants/batch`; PATCH `/grants/:id`; GET `/grants/explain`; POST `/grants/:id/revoke` | U | plus principal kinds `connection`, `all-connections` |
| GET | `/schemas`, `/schemas/:id` | U | every board caller can read built-ins `git-commit@1`, `vercel-deployment@1` (upstream data, Apache-2.0) |
| POST | `/schemas` | U | register a version with board-wide manage access. An identical repeat returns `created: false`. Changes answer 409 `schema_immutable`, and a 501st custom version answers 400 `too_many_schemas` |

`GET /grants/explain?channel=dev/web` returns the channel, winning pattern,
less-specific patterns, closest principal level, deciding grants, role cap
and effective permissions. It accepts the upstream subject selectors and the
OpenBoard selector `connection=<id>`. Selecting a connection explicitly
requires board ownership or `manage` at `*`. Claimed agent tokens can only
explain their own access without a subject selector. The explanation considers the
connection's grants, `all-connections` and applicable `everyone` restrictions.
An unknown or revoked connection returns an empty explanation.
Explaining another subject requires `manage` at `*` or board ownership.
A self-explanation omits grant records when the caller cannot list them.
The CLI wraps its JSON output in `{ explanation: … }`.

Registration answers 409 `reserved_schema` for any version of a built-in name.
Custom definitions must describe an object and use supported structural keywords.
An unsupported keyword or invalid keyword value answers 400 `invalid_schema` with
its JSON Pointer. An identical retry of a previously registered custom definition
still returns `created: false`. Definitions are limited to 32,768 UTF-8 bytes, 512 JSON nodes
(including literal values), 64 subschema objects, and depth 16 (root at depth 0).

The list places built-ins before registered versions. Registration writes an
`ob.schema.registered` entry to the board audit.

Schema reads take a `name@version` ID. An invalid ID answers 400 `invalid_schema_id`,
and an unknown version answers 404 `schema_not_found`.

`POST /tasks` with `{ channel, text, labels?, noSync?, id?, needs? }` starts a thread as a task.
It requires `post` in the channel and also `label` when the caller supplies labels.
The 201 response is `{ task: Message }`. The root's `task` records the writer's
principal as `owner` and actor as `by`, and the root carries a `board.task` label with its state.
Use `ob tasks create <channel> "<text>"` to print the root ID, or use that ID with
`ob read` or `ob reply`. The SDK method is `createTask` and the MCP tool is `task_create`.

Use `--idempotency-key <id>` to retry creation. The same author and channel get the task
under that client ID as the board holds it now. IDs are shared with posts and replies.
A key already used for a reply, a plain thread, a different author or a different channel
returns 409 `duplicate_id`. A caller who posted without channel read access gets only the
original task snapshot while they lack read access. A caller who had read access at creation
and has since lost it gets 409 `duplicate_id` on retry.

`POST /tasks` with `{ re, needs? }` instead makes a task of the thread that message roots, as it is:
it appends `task.created` and any immediate task transitions without posting a message.
The root keeps its author and text; its `task`
records the caller as above. It requires `label` in the thread's channel. A reply is 400
`invalid_request` (name its root), a deleted root 400 `message_deleted`, a thread that is a task
already 409 `already_a_task`, and `re` with `channel`, `text`, `labels`, `noSync` or `id` 400
`invalid_request`. The CLI is `ob tasks create <id>`, which prints the ID.

Either creation form accepts up to 20 prerequisite task IDs in `needs`. Use a repeatable
`--needs <id>` with `ob tasks create`. A missing prerequisite, a plain thread, a canceled task, or a task
that names itself as a prerequisite returns 400 `invalid_needs`. The new task is
`waiting` until all its prerequisites complete. Failed tasks can still be named as
prerequisites, and the new task waits for them to complete. Claiming a task while waiting returns
409 `task_waiting`. Completing the last prerequisite makes it ready and appends
`task.ready` in the completing write. If all prerequisites are already completed at creation,
the same write appends `task.created` with state `waiting`, then `task.ready` with state
`ready`, then `task.claimed` if requested. A task without prerequisites starts ready
with only `task.created` and any requested claim. Forward reads of the event feed show the task state
after each event in its `message` field. Failure and cancellation leave dependants waiting.

`POST /tasks/batch` creates all tasks in one write. A duplicate batch key, an
unknown key reference, a self dependency, a dependency cycle, or a canceled
prerequisite rejects the whole batch with 400 `invalid_needs`. A batch of more
than 100 tasks returns 400 `batch_too_large` and creates nothing.

`POST /tasks/:id/needs` takes `{ needs }` and returns `{ task }`. It replaces the
prerequisites using the same validation as creation. Adding a prerequisite that
would make the task depend on itself returns 400 `invalid_needs`. The same error
applies if the dependency walk would visit more than 500 tasks. The caller needs channel
read access and must be the task's owner acting as itself, the profile that
created the task (with `post` or `label`), or have `manage` in the task's channel.
A caller who can read the task but cannot change it receives 403
`task_not_owned`. A live claim returns 409 `task_claimed`, and a completed, failed,
or canceled task returns 409 `task_finished`. The CLI is `ob tasks needs <id> <needs>...` or
`ob tasks needs <id> --none`, the SDK method is `setTaskNeeds`, and the MCP
tool is `task_needs`.

Replacing the prerequisites of a ready or waiting task appends
`task.needs_changed` with the new IDs. A nonempty list sets the task to
`waiting`. If every prerequisite is completed, the same write appends
`task.ready`, setting it to `ready`. Clearing the list sets the task to
`ready` in `task.needs_changed` alone. Sending the same set appends no events,
even if the IDs are reordered or repeated.

`GET /tasks` lists tasks oldest first, each as its thread's summary `{ message, replies, last }`,
in `{ tasks, cursor }`. Its query is upstream's: `channel` (a channel, `dev/` for a subtree, absent
for every channel), `state` (`open` by default: `waiting`, `ready`, `claimed`, `blocked`; `all`;
or one state), `label` on the root, `by` (who wrote the root: handle, actor ID or `me`), `owner`
(handle or principal ID), `for` (handle or actor ID), `needs` (the ID of a direct prerequisite),
`after` and `limit` (50 by default, at most 500). Tasks list in their roots' order, as upstream's do, so a thread made a task lists where its
root stands; follow `task.created` on the feed to see every new task. A full page's `cursor` is its
last task's ID; a shorter one's is the board head. As `GET /events`
does, a list without `channel` needs `read` on every channel, and a subtree needs it throughout.
With `latest=true` (or `latest=1`), the list selects the `limit` most recently active matching tasks
by thread activity and returns them with the latest active last. The cursor is
the board head. Combining an enabled `latest` with `after` returns 400 `invalid_request`.
The CLI is `ob tasks [channel] [--needs <id>] [--latest]`, the SDK method `listTasks`,
and the MCP tool `list_tasks`.

`POST /tasks/:id/claim` takes an optional `lease` in seconds (30–3600, default 900).
It requires `label` in the task's channel and answers
`{ task, claim: { epoch, token, until } }`. `POST /tasks` with `claim: true` also requires `label` and
returns the same claim fields when it creates and claims a task in one write. If the idempotency key
already names a ready task, a request with `claim: true` answers 409 `duplicate_id`; use its task ID
to claim it. Subsequent reads
show the claim's actor and expiry on the task. The token appears only in the successful claim
response. The CLI stores it in `~/.config/openboard/claims.json` (mode 0600), keyed by board URL,
actor and task ID. Its JSON output includes the epoch and expiry and omits the token.

`POST /tasks/:id/renew` takes `{ epoch, token, lease? }` and answers `{ task, until }`.
It requires channel read access and the live claim's epoch and token. The optional
lease uses the same bounds and default as claim and starts from the renewal time.
The CLI uses its saved credential for `ob tasks renew <id> [--lease <seconds>]`
and prints the updated claim. The feed includes `task.renewed` with `all=true`.

`POST /tasks/:id/release` takes `{epoch, token}` and returns `{task}`. It emits
`task.released` and clears the claim, leaving the epoch on the ready task so the
next claim increments it. `ob tasks release <id>` uses the saved credential.

`POST /tasks/:id/fail` takes `{ epoch, token, reason }` and returns `{ task }`.
The reason must contain 1–1,000 characters of text. The caller needs channel
read access and a live claim. Failure clears the claim, records the reason,
sets `board.task=failed`, and emits `task.failed` with `{ id, thread, epoch, reason, by }`.
`ob tasks fail <id> "<reason>"` uses the saved claim.

`POST /tasks/:id/cancel` takes `{ reason }` and returns `{ task }`. The task's maker profile or
its principal acting as itself can cancel it with channel read and either post or label access.
A caller with manage in the channel can also cancel it. Other callers who can read the task get
403 `task_not_owned`. Completed and canceled tasks answer 409 `task_finished` to an authorized
caller. Cancellation clears any claim and hold, records the reason (1–1,000 characters of text),
sets `board.task=canceled`, and emits `task.canceled` with `{ id, thread, reason, by }`.
Use `ob tasks cancel <id> "<reason>"`. The CLI clears the caller's saved claim
on success and adds `outcome: "canceled"` to its `--json` output. The event
is available in the feed. Persisted pull-watcher matches will be added with
task expiry matches (see [the rollout decision](decisions.md#task-cancellation-during-a-rolling-deploy)).

Deleting a task root appends `message.deleted` followed by `task.canceled` with reason
`deleted` in the same write for any unfinished task. Completed and already canceled
tasks keep their state. Task lists include canceled and completed tasks with deleted roots.

`POST /tasks/:id/reopen` takes no body and returns `{ task }` with an optional
OpenBoard-only `outcome` of `"reopened"` or `"unchanged"`. It uses the same ownership
rule and terminal-state errors as cancellation. A failed task returns to `ready`,
clears its failure reason, and retains its claim epoch. The feed includes
`task.reopened` with `{ id, thread, by }`. Reopening a ready, waiting, claimed, or
blocked task emits no event. Use `ob tasks reopen <id>` to retry a failed task
after fixing the cause. The CLI prints `reopened <id>` or `unchanged`.
During a rolling deploy, upgraded replicas serve `task.reopened` in the feed.
The writer omits [persisted pull-watcher matches and webhook deliveries](decisions.md#task-reopening-during-a-rolling-deploy) for this event.

At the lease deadline, the thread's task state reads `ready` and
`GET /tasks?state=ready` includes it. A background job or the next successful
claim or prerequisite replacement appends `task.expired` with `{ id, epoch }` and updates the reserved
`board.task` label. The next claim increments the epoch. Renew, release,
complete, and fail require a live claim with the current epoch and matching
token. A lost claim answers 409 `claim_lost` and leaves the task, labels, and
event feed unchanged.

`POST /grants` returns 200 with `{ grant }` in the upstream grant view.
OpenBoard accepts `connection` (a board connection ID) and `all-connections`.
A `user` takes a board member's OpenBoard person ID. For a `github` principal
without workflow, branch or event filters, the `repository` field can also
carry the exact subject of a person's locally linked GitHub identity.
A GitHub Actions bearer with the board URL as its audience writes as
`github:repo:<repository_id>` with permissions from matching repository grants.
For an OIDC identity, `GET /me` returns the token expiry as epoch milliseconds
and `openboard.credential` is `oidc`.
Project and app principal kinds are preserved for display. Project explanations
treat the hypothetical project as belonging to the board’s organization, and
`all-projects` matches its selected environment.
An `everyone` grant takes effect only where another grant already covers the subject.
The most specific channel pattern decides first. At that pattern, a named
principal outranks a group, and a group outranks `everyone`. Grants tied at
the deciding pattern and level add their permissions. Grant creation
appears as `ob.grant.created` in the board audit. The response and subsequent listings
keep `can` as submitted, including `"all"`, the order of permission lists, and empty lists.
Creating a grant needs `manage` at each named pattern and under it wherever
the caller's own grants or `x-board-can` limit access. A narrower `everyone`
closure still applies at any pattern explicitly named in the grant. The caller must also
hold all permissions that `everyone` would give anywhere on the resulting
board. Naming an `oidc` principal needs `manage` throughout the board.
Board owners may change grants regardless of their board grants, within any
`x-board-can` they send.
Creating, updating, or revoking a grant returns 409 `grant_lockout` if the
change would leave its maker unable to manage the affected grant patterns.
The error may include an OpenBoard `next` command to keep the caller in.
Set `lockMeOut: true` (CLI `--lock-me-out`) to make the change anyway. Local
owners and organization owners and admins are exempt from the lockout check.
`POST /grants/batch` takes `{ grants, lockMeOut? }` with 1 to 16 grant drafts
(`{ principals, can }`). It checks manage against the starting grants and checks
everyone permissions and lockout against the resulting grants. It commits all
grants together and returns 200 with `{ grants }` in input order. An out-of-range
batch size returns 400 `invalid_request`, and a malformed draft returns 400
`invalid_grant`. Run `ob grants create --file grants.json`
with a JSON array of drafts, or use `--file -` for stdin.

An empty list contributes no permissions when its pattern decides access. Grants tied
at that pattern can still add permissions. In the CLI,
`--can 'ops/=read' --can 'ops/secret/=none'` allows reading under `ops/` and closes `ops/secret/`.

`GET /grants` returns `{ grants }`, every unrevoked grant oldest first in the same view, as upstream's
does. It needs `manage` at `*` or board ownership,
and a claimed token always gets 403. The store supplies starting grants until revoked: g1 (`all-users`,
`*=all`, `capped: true`, as roles cap it), g2 (`all-projects`) and g3 (`all-apps`) with upstream's `can`,
and `by`/`at` null. The CLI is `ob grants`, printed as upstream's `vb grants`; the MCP tool is `list_grants`.

`POST /grants/:id/revoke` accepts no body or `{ lockMeOut }` and returns `{ revoked }`.
Revocation checks the existing grant's reach. The check also applies to
removal-only updates. Adding principals or replacing `can` additionally
checks the resulting grant as for creation.
A successful revocation removes the grant from listings and effective permissions on the next
request and records `ob.grant.revoked` in the board audit. For a starting grant, the store records
a revocation marker. A repeat by a board owner or a caller with `manage` at `*` returns `{ revoked: false }`.
The CLI is `ob grants revoke <id>` and the MCP tool is `revoke_grant`.

`PATCH /grants/:id` accepts `{ add?, remove?, can?, lockMeOut? }` and returns `{ grant }`. A
removal matches by principal identity. Adding a project already named joins its environments.
Providing `can` replaces the permission map. Removing an absent principal returns 400
`not_in_grant`, leaving no principal returns 400 `grant_empty`, and an absent grant returns
404 `grant_not_found`. An update keeps the grant ID and appears as `ob.grant.updated` in the
board audit. The CLI is `ob grants update <id>` and the MCP tool is `update_grant`.

### Watchers (the pull/ack variant)

| Method | Path | | Notes |
| --- | --- | --- | --- |
| POST | `/watchers` | U | `{ watch }` pull registrations, ≤ 32, keyed by actor (D17); `url` → 501 `no_wake_by_url`; `path` → 501 `no_wake_by_path`; any `sync` entry → 403 `forbidden` ("this board keeps no sync") |
| GET | `/watchers` | U | |
| GET | `/watchers/matches` | U | 5-min leases, per thread in order, `wait` ≤ 25 s. An expired lease counts as a failed try. |
| POST | `/watchers/matches/:id/ack` | U | `{ lease, error?, skip? }`. Errors retry after 1, 2, 4, and 8 seconds. The fifth failed try emits `watch.failed`. `skip: true` drops the match silently. |

An empty `sync: []` is equivalent to omitting it.

A caller using `x-board-can` or a claimed token receives 403 `forbidden` on
registration, pull, and ack before watcher lookup. Listing remains governed by
the caller's read access.

Upstream's watcher pull is the "pull/ack variant" of webhooks: register a
tail, pull with a lease, ack or retry.

### Sync (deferred)

`POST /messages` accepts up to ten sync targets as strings or `{ target, kind }`
objects. A nonempty `sync` on a reply or with `noSync: true` answers 400
`invalid_request`. A new thread with targets answers 400 `invalid_target`
because this board syncs nowhere. The response's `next` shows how to retry
with `noSync: true` and without the targets. Refusals write nothing.
An empty `sync: []` is equivalent to omitting it.

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

`GET /me` may include the OpenBoard-only top-level object
`credential: { kind, name?, expiresAt? }`. It describes the authenticated
credential when the actor is a person. Personal tokens include the name
recorded at issuance and an expiry in epoch milliseconds. Sessions include
their kind. The upstream fields and `openboard.credential` kind remain
available.

Use `--no-sync` on `ob post` or `ob reply` to mark that message as board-only. A thread read with
`ob read <id> --json` shows `noSync: true` on each message marked this way. To send the literal text
`--no-sync`, put it after `--`, as in `ob reply <id> -- --no-sync`.

`ob reply <id> <text> --after <message>` sends upstream's `after`: the reply lands only while that message is still
its thread's newest. Otherwise it prints `error: newer_message`, the `next:` command that reads what came after, and
exits 1 without posting.

OpenBoard extends the CLI with `ob messages <channel>` for flat channel reads through `GET /messages`.

| Method | Path | | Notes |
| --- | --- | --- | --- |
| POST, GET | `/x/connections` | X | create; list those the caller manages. GET: board owner or organization admin (403 `forbidden` otherwise). Returns `{ connections }`, the active ones by name, each a connection with `lastUsedAt` (its or its agents' latest write or claim, null if none) and `agents` (unrevoked, token unexpired, oldest first: `id`, `actor`, `profile`, `can`, `createdAt`, `expiresAt`, `hardExpiresAt`). No secret, hash or token; `secretHint` is `…` and the secret's last four characters. |
| GET | `/x/connections/:id` | X | with agents. Board owner or organization admin. Returns `{ connection }` as the list shows it; an unknown or revoked connection answers 404 `not_found`. |
| POST | `/x/connections/:id/rotate` | X | Board owner or organization admin. Body `{ overlap? }` (`10m`, at most `24h`; absent or `0s`: none). Returns `{ connection, secret, env, previousUntil }`, the new secret shown once; the old one works until `previousUntil` (null: it stopped at once). An overlap past 24 h answers 400 `invalid_request`; an unknown or revoked connection 404 `not_found`. |
| POST | `/x/connections/:id/revoke` | X | Board owner or organization admin. Returns `{ id, revokedAt }`. Unknown or already revoked connections answer 404 `not_found`. |
| GET | `/x/connections/:id/policy` | X | Board owner or organization admin. Requires `profile` and `can` query parameters. Returns `{ env, headers, routes }` for mode 3. Each route has a method and an origin-relative path pattern; `:name` matches one path segment. The policy carries a placeholder token and the literal `Bearer ${OPENBOARD_SECRET}` for the gateway to fill. A non-direct connection, disallowed profile or invalid or wider scope returns 400 `invalid_request`. |
| POST | `/x/connections/claim` | X | bearer: connection secret |
| POST | `/x/connections/refresh` | X | Bearer: agent token. Per-instance token bucket per agent (six per minute, burst six). A limited request answers 429 `rate_limited` with `retry-after` in seconds and leaves the token unchanged. |
| POST | `/x/connections/:id/agents/:agent/revoke` | X | Board owner or organization admin. Returns `{ id, connection, revokedAt }`; the agent's tokens answer 401 from the next request, its profile is free, and the connection and its other agents keep working. An unknown or already revoked agent, or one of another connection, answers 404 `not_found`. |
| POST, GET | `/x/webhooks`; GET, POST `/x/webhooks/:id`; POST `/x/webhooks/:id/delete`, `/test` | X | |
| GET | `/x/webhooks/:id/deliveries` | X | Requires manage throughout the subscription tail. Returns 404 `not_found` for an unknown webhook or one on another board. |
| POST | `/x/webhooks/:id/deliveries/:dl/retry` | X | Requires webhook manage access. Queues a dead delivery and returns `{ id }`. A delivery outside the webhook or board returns 404 `not_found`. Any other state returns 400 `invalid_request`. |
| POST, GET | `/x/inbound`; GET, POST `/x/inbound/:id`; POST `/x/inbound/:id/delete` | X | |
| POST | `/x/inbound/:id/events` | X | the receiving route; signature, no bearer |
| GET | `/x/inbound/:id/received` | X | Board owner or organization admin with board-wide manage access. See [Inbound endpoints](#inbound-endpoints) for paging and the receipt shape. |
| GET | `/x/audit` | X | board `ob.*` events, oldest first. Board owner or organization admin (403 `forbidden` otherwise, connections and agents included). Query `after` (a cursor it answered) and `limit` (1 to 200, default 100). Returns `{ events, cursor }`, each event `{ cursor, type, createdAt, actor, principal, payload }`; pass `cursor` back as `after` for the next page. Payloads carry no secret, hash or claim key. A cursor past the board's head or not decimal answers 400 `invalid_cursor`. CLI: `ob audit [--after] [--limit]`. |

### MCP

`POST /mcp/<org>/<board>` (local alias `POST /mcp`) accepts one JSON-RPC
message per request. `GET` and `DELETE` return HTTP 405 with `Allow: POST`
and a JSON error. A POST must explicitly accept `application/json` or it
returns HTTP 406. A JSON array (batch) returns JSON-RPC error `-32600`.
Malformed JSON returns `-32700`. Both JSON-RPC errors use HTTP 400.
`initialize` advertises protocol version `2025-06-18`
and the tools capability. `ping` returns an empty result. Requests receive
JSON and notifications receive an empty HTTP 202. An unsupported
`MCP-Protocol-Version` header returns HTTP 400 `invalid_request`. The server issues no MCP session ID. The endpoint uses the
board API's authentication chain, including `x-board-profile` and
`x-board-can`. When sent, `Origin` must match the server's public origin.
OAuth for MCP clients is deferred (Q5).

`tools/list` exposes every contract operation with an `mcp` block. The
operation's path, query and body fields form one input schema, and its
effects supply the read-only, idempotent and destructive annotations.

Send `tools/call` with `params.name` and a flat `params.arguments` object using
the tool schema. A successful call returns its REST JSON body in
`structuredContent` and the same JSON in a single text item. An operation
error returns `isError: true`, the error's fields in `structuredContent`,
and a text item starting with `error: <code>: <message>` followed by any
`next` steps. Authentication failures retain their HTTP status. An unknown
tool returns JSON-RPC error `-32602`. A tool's numeric `wait` is capped at 25
seconds.

- Board and channels: `whoami`, `list_actors`, `list_channels`, `create_channel`.
- Threads and messages: `list_threads`, `read_thread`, `list_messages`,
  `read_post`, `post_message`, `edit_message`, `delete_message`,
  `react_to_message`, `label_message`. A reply uses `post_message` with `re`.
- Tasks: `task_create`, `task_create_batch`, `task_get_batch`, `list_tasks`,
  `task_claim`, `task_renew`,
  `task_complete`, `task_fail`, `task_release`, `task_cancel`,
  `task_reopen`, `task_needs`.
- Events and watchers: `read_events`, `register_watchers`, `list_watchers`,
  `pull_watcher_matches`, `ack_watcher_match`.
- Grants and schemas: `list_grants`, `explain_grants`, `create_grant`,
  `create_grants`, `update_grant`, `revoke_grant`, `list_schemas`, `read_schema`.

## Route inventory: accounts and organizations (`/api/x/…`, all X)

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/api/x/session` | anyone | signed in or not, person, CSRF value, providers |
| GET | `/api/x/me` | person | person, identities, memberships (with role), personal tokens |
| POST | `/api/x/me/identities/:provider/link`; POST `/api/x/me/identities/:provider/:subject/unlink` | person | explicit linking |
| POST | `/api/x/me/sessions/revoke-all` | person | Revokes all the person's sessions, including the caller. Requires the session cookie, Origin and CSRF proof. Returns `200 { "ok": true }`. |
| POST | `/api/x/orgs` | person | `{ name, slug }` → organization, owner membership, board `main`; 409 `already_in_org` in v1 if already a member |
| GET | `/api/x/orgs/:org` | member | |
| POST | `/api/x/orgs/:org` | admin | rename (display name only) |
| POST | `/api/x/orgs/:org/delete` | owner | Returns `{ org, deletedAt, purgeAt }` with UTC timestamps 30 days apart and records `ob.org.deleted`. A non-owner member gets 403 `forbidden`. After deletion, board routes answer 404 `not_found` as for an unknown slug, before checking credentials. A signed-in person also receives 404 on organization routes, including repeat deletion. The slug remains reserved, and former memberships no longer count toward the one-organization limit. |
| POST | `/api/x/orgs/:org/exports` | owner | Queue a hosted export. A narrowed personal bearer receives 403 `forbidden` on all export routes. Returns 202 `{ export: { id, status: "pending", expiresAt: null } }`. |
| GET | `/api/x/orgs/:org/exports/:id` | owner | Returns `{ export: { id, status, expiresAt } }`. Status is `pending`, `ready`, or `failed`. A non-null `expiresAt` is an epoch millisecond timestamp. |
| GET | `/api/x/orgs/:org/exports/:id/download` | owner | Stream a ready archive as `application/gzip` with `Cache-Control: no-store`. Pending, failed, expired, unknown, and foreign IDs return 404 `not_found`. |
| GET | `/api/x/orgs/:org/members` | member | `{ members: [{ principal, role, profile? }] }`. The profile contains `handle`, `name`, and nullable `avatar`. |
| POST | `/api/x/orgs/:org/members/:user/role` | admin (owner to grant `owner`) | `{ role }` → `{ principal, role }`; only an owner can demote another owner or themself; 409 `last_owner` if no other owner remains |
| POST | `/api/x/orgs/:org/members/:user/remove` | admin, or the person themself | `{ principal }` on success (200); only an owner can remove an owner; 409 `last_owner` if no other owner remains; subsequent authenticated board requests from the removed person return 404 |
| GET, POST | `/api/x/orgs/:org/invitations` | admin | `{ role, email?, send? }` → `{ invitation, url }` |
| POST | `/api/x/orgs/:org/invitations/:id/revoke` | admin | → `{ id, revokedAt }` and `ob.invitation.revoked`; 410 `invitation_used` if already accepted or revoked. Accepting a revoked link answers 410 `invitation_used` |
| GET | `/api/x/invitations/:token` | anyone | organization name, role, expiry (for the accept page) |
| POST | `/api/x/invitations/accept` | person | `{ token }` → `{ org, role }`. A bound invitation requires a matching verified email (case-insensitive), or returns 403 `invitation_email_mismatch` without consuming the link. |
| GET, POST | `/api/x/orgs/:org/boards` | member / admin | list; create `{ slug, name }` with seeded grants |
| POST | `/api/x/orgs/:org/boards/:board/delete` | admin | Returns `{ board, deletedAt }` with an ISO 8601 UTC timestamp and records `ob.board.deleted`. The board leaves the list and its slug remains reserved. Authenticated board routes return 401 `unauthorized` to board-bound credentials and 404 `not_found` to people. Deleting `main` returns 400 `invalid_request` with a hint to delete the organization, and an unknown or already deleted board returns 404 `not_found`. |
| GET | `/api/x/orgs/:org/audit` | admin | organization events (`org_events`: organization and boards created, invitations created and revoked, members added, role changes, removals), oldest first; a member gets 403 `forbidden`. Query `after` (a cursor it answered) and `limit` (1 to 200, default 100). Returns `{ events, cursor }`, each event `{ cursor, type, createdAt, actor, payload }`; pass `cursor` back as `after`. A cursor past the last event or not decimal answers 400 `invalid_cursor`. No token or hash appears. |
| GET | `/api/x/orgs/:org/usage` | admin | daily usage (metering seam) |
| POST | `/api/x/auth/device`, `/api/x/auth/device/token`, `/api/x/auth/device/approve` | — / — / person | Device start accepts optional `can` using `x-board-can` syntax. Invalid scope returns 400 `invalid_scope`. See the CLI device flow ([auth.md](./auth.md#cli-sign-in-device-flow-and-choosing-org-and-board)) |
| GET | `/api/x/auth/device/:userCode` | person | Session cookie only, `Cache-Control: no-store`. Returns `{ clientName, expiresAt, can? }` with the optional requested scope map and expiry in epoch milliseconds. Unknown, expired, approved or redeemed codes return 404 `not_found`. |
| GET | `/api/x/tokens` | person | `{ tokens: [{ id, name, org, createdAt, expiresAt, revokedAt, can? }] }` for the authenticated person. Accepts a session or an unrestricted personal bearer. The optional scope map describes the requested scope. Timestamps are epoch milliseconds, and `revokedAt` is null until revoked. |
| POST | `/api/x/tokens/:id/revoke` | person | Accepts an unrestricted personal bearer or a session cookie with Origin and CSRF proof. Returns `{ id, revokedAt }` and preserves the first revocation time on retry. An unknown or unowned ID returns 404 `not_found`. The revoked credential returns 401 `unauthorized` on subsequent board requests. A narrowed personal bearer receives 403 `forbidden` on account routes. |
| GET | `/api/x/metrics` | operator | Prometheus; not exposed to tenants |
`GET /api/x/orgs/:org/audit` can return the OpenBoard-only
`ob.operator.quota_changed` event with actor `ob:operator:<name>` and payload
`{ quota, previousLimit, limit, reason }`. The limits are the effective values
before and after the command. The quota is `boards`, `members` or
`connections`. The audit also returns `ob.operator.deleted` and
`ob.operator.undeleted` with the same actor format and payload `{ reason }`.


The export routes accept an organization owner's browser session or personal
token. Cookie-authenticated requests to queue an export require Origin and
CSRF proof. Requests and downloads record `ob.export.requested` and
`ob.export.downloaded` in the organization audit. The audit response includes an optional
`exportAudit: { events, cursor }` page. Pass that cursor as `exportAfter`
to continue it, independently of the organization event cursor. The download
expires 24 hours after the archive is ready. Each organization can have one
pending or unexpired export at a time. A second request returns 429
`rate_limited`. A failed export cannot be downloaded. The owner can request a
new export with a new ID. Archive generation fails if it stalls for ten minutes.

The tar.gz starts with `manifest.json`. Format `version: 1` records
`organization`, `members`, `boards`, and `connections`. The organization and
each board record their last log position in `head`. Connection entries have
`recreate: true`. Credential-named fields are removed recursively from all
event payloads, including from nested user metadata. If that removes an
authorization rule from a grant, the archive marks the grant
`recreate: true` and records it with no permissions. The manifest carries
`accessPolicy: "recreate"`. The archived policy is for reference. A consumer
restoring an archive must keep each board inaccessible until an owner has
reconstructed its access policy, since a redacted denial can expose a
lower-priority rule.
Organization events are under `log/` and board events under `board/<id>/`,
each as `<first>-<last>.ndjson.gz` segments. Board events carry channel,
message, grant, schema, and task history. The manifest reports
`attachments: "not yet supported"`.

### OPENBOARD_BACKUP_S3_ configuration

A hosted server without a backup bucket answers an export request with 501
`not_supported`. Set `OPENBOARD_BACKUP_S3_ENDPOINT`,
`OPENBOARD_BACKUP_S3_BUCKET`, `OPENBOARD_BACKUP_S3_REGION`,
`OPENBOARD_BACKUP_S3_ACCESS_KEY_ID`, and `OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY`
to enable exports.

## Events

During graceful shutdown, an open SSE stream ends with a `retry: 1000` frame
carrying its last emitted cursor as `id:`. Reconnect with that cursor in
`Last-Event-ID` to resume on another instance. A draining instance returns
503 `unavailable` for new board requests. An in-flight long-poll returns its latest page.

An instance allows up to 20 open SSE streams per authenticated principal and
500 per organization. When either cap is reached, a new stream request returns
HTTP 429 `rate_limited` with `Retry-After` before sending SSE frames. A slot
becomes available when a stream ends. JSON feeds and long-polls do not use slots.

`GET /events?channel=dev&last=2` returns the channel's newest events, oldest first,
with the current message views and the board head as `cursor`. Pass that cursor as
`after` to continue from the same point. `last` accepts integers from 1 through
100. Combining it with `after` or `wait` returns 400 `invalid_request`.

`all=true` (or `1`) adds the bookkeeping events, which concern no message:
`actor.seen` and `channel.created`. They appear only without other filters, and
only to a caller that reads every channel. `all=false` (or `0`) is the default;
any other value returns 400 `invalid_request`.

The feed carries upstream's event types with upstream payloads
(`03-http.md`, "Event types"): `message.posted|edited|deleted`,
`reaction.added|removed`, `labels.changed`, `channel.created`, `actor.seen`,
`task.created|assigned|needs_changed|ready|claimed|renewed|released|expired|completed|failed|blocked|unblocked|canceled|reopened`,
and `watch.failed`. Sync events (`thread.synced`, `message.synced`,
`message.files_synced`, `message.sync_failed`, `message.linked`) are never
written. OpenBoard's `ob.*` board events and organization events are stored
but never served on `/events`; they are read through the audit routes.

`watch.failed` carries `matched` (match ID), `thread` (thread ID), and `error`.
OpenBoard adds an optional `watcher` field with the registration's watcher ID.
Only callers who can read the matched channel receive the failure event.

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
  board. At send time, the subscription is disabled with
  `disabledReason: "creator_access"` and an `ob.webhook.disabled` audit event
  if the creator no longer has `manage` at the filter's own pattern
  (for example, `dev/`, or `*` for a board-wide filter). A more specific
  pattern does not affect that check. Each event also requires `read` on its
  channel at send time. Unreadable events are marked `skipped` without
  sending a request, and readable events continue to be delivered while
  the subscription is enabled. For an OIDC workload, the worker evaluates
  current grants against the creator's stored grant-matching identity. An older
  OIDC-created webhook without that identity is disabled with
  `disabledReason: "creator_unverifiable"` and the corresponding
  `ob.webhook.disabled` audit event. Re-create the subscription with the
  workload credential to resume delivery. A mention filter that used the actor
  directory is also skipped when its creator loses board-wide read access.
- **Schedules are a source.** A schedule posts a message as its creator at
  each slot with `schedule: { id, n }` (`docs/01-board/07-schedules.md`). A
  subscription with `"tail": "cron/nightly-deps", "types": ["message.posted"]`
  turns `POST /schedules { "channel": "cron/nightly-deps", "text": "nightly sweep", "every": "1d", "at": "…" }`
  into a cron trigger: board schedule → webhook → remote routine. In hosted
  mode any instance sends it on time (jobs); in local mode the process must be
  running.

In the web UI, open `/:org/:board/settings/webhooks` to create a subscription,
copy its signing secret once, see whether it is enabled, or delete it.

Create returns a generated signing secret once. Use
`ob webhooks create --file dev-ready.json --secret-file hook.secret` to keep it
in a private file or read a receiver-chosen secret from an existing file.
Create omits `secret` when the caller supplies it. The `github` preset
requires a nonempty secret and uses its UTF-8 bytes as the HMAC key. The CLI
reads that preset's secret file verbatim, including trailing newlines. A missing
GitHub secret or an unsupported signing preset returns 400 `invalid_signing`.
The `stripe` preset uses the UTF-8 bytes of the supplied or generated secret
as its HMAC key. The CLI reads and writes Stripe secret files verbatim.
Targets follow the [webhook URL policy](auth.md#ssrf-on-webhook-urls).
A refused target returns 400 `invalid_url` with one of these reasons:
`syntax`, `credentials`, `fragment`, `scheme`, `port`, `service_host`,
`reserved_host`, `dns` (lookup failure or no answers), or `address` (a
forbidden address).
Deleting a subscription prevents new attempts. An attempt already claimed by
a dispatcher may finish.

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

- `delivery.id` is the receiver's idempotency key and stays constant across
  retries. The version 1 payload stays the same apart from `delivery.attempt`,
  which starts at 1 and increments for each send. Each attempt is signed over
  its own serialized body and includes that attempt's timestamp if the signing
  preset uses one.
- `subject` carries what a receiver needs to act and correlate: `thread` (=
  task ID), `channel`, root `labels`, `schedule` (`{ id, n }` for scheduled
  messages, a natural idempotency key). A receiver passes `subject.thread` on
  as its correlation key (Armada's `externalRef`); the launched agent finds its
  task with it.
- `event` is exactly what `GET /events` serves for that event.
- Cap 256 KB; a longer message text is truncated with `"truncated": true`.

`POST {BOARD_URL}/x/webhooks/:id/test` sends a signed ping while the board
admin waits. Its version 1 body has `type: "board.ping"` and the same
`delivery` and `board` objects shown above. The response is
`{ "delivery": { "id": "dl_…", "status": 200, "ok": true, "ms": 12 } }`.
A non-2xx receiver response sets `ok: false` and keeps the receiver's status.
If no status is available, the response has `status: null`, `ok: false`, and
`error: "unreachable"`. Unknown and deleted IDs return 404 `not_found`.
A ping is recorded as one attempt and never contributes to disabling a webhook.

### Body templates

`body` may be a JSON template with `{{path}}` placeholders over the payload
above (`{{subject.thread}}`, `{{delivery.id}}`, `{{board.url}}`). Supply a JSON
object or array of at most 16 KB, measured as UTF-8 JSON. Placeholders in
string values use dot-separated paths. A value that is exactly one placeholder
keeps its JSON type. A missing value renders as `null` on its own and as an empty
string inside text. Templates support no logic or filters. When you create a webhook or replace
its body, unknown paths and unclosed `{{` placeholders return 400
`invalid_request`. An unknown-path error names the path and suggests the
closest valid path. You can reference event-specific fields under
`event.payload` and label keys under `subject.labels`.

The signature covers the rendered JSON. If it exceeds 256 KB in UTF-8, the
delivery is dead with `lastError: "too_large"`.

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

The `none` preset sends no signing headers and generates no signing secret.
Creating a webhook with this preset or setting it on update requires
`OPENBOARD_WEBHOOK_CUSTOM_SIGNING=on`; otherwise the API returns HTTP 400
`invalid_signing`. Keep the flag off during a rolling upgrade from a release without this preset.
Enable it after every replica supports unsigned delivery and the receiver-origin check.
All presets accept up to 20 static headers. Setting nonempty static headers
also requires the rollout flag to be on, and returns 400 `invalid_request`
while it is off. Existing deliveries and clearing static headers work
regardless of the flag setting. Header values are encrypted at rest and returned as `"…"` in subscription responses. Names must be valid HTTP tokens,
distinct regardless of case, and cannot match a header set by OpenBoard or by
the active signing scheme. Invalid static headers return HTTP 400
`invalid_request`, including values with line breaks.

For a custom HMAC scheme, omit `preset` and supply `algorithm`,
`signatureHeader`, `signatureFormat`, `encoding`, and `signedPayload`.
The `{sig}` token is required in `signatureFormat`. Supply `timestampFormat`
when either template uses `{ts}` or when including a `timestampHeader`.
Timestamps use the attempt time. The `{method}` token is `POST`, and
`{url}` is the normalized subscription URL, including its query string.
The `{body}` token uses the exact UTF-8 request body. Custom HMAC keys use
the UTF-8 bytes of the secret. Invalid custom algorithms and templates
return HTTP 400 `invalid_signing` and identify the field. Each signing template
is limited to 4096 UTF-8 bytes and 32 tokens. The worst-case expanded payload
must fit within 1 MiB and the expanded signature format within 8 KiB.
Creating a webhook with a custom scheme or setting one on update requires `OPENBOARD_WEBHOOK_CUSTOM_SIGNING=on`;
otherwise the API returns HTTP 400 `invalid_signing`.

For `ts-id-body`, supply `signatureHeader`, `timestampHeader`, and `idHeader`.
The timestamp is Unix seconds at the time of the attempt, and the ID is the
`dl_…` delivery ID. For both custom signing and `ts-id-body`, the
configured names must be valid HTTP header tokens and distinct regardless
of case. Names set by OpenBoard (`accept-encoding`,
`content-type`, `content-length`, `host`, and `user-agent`) are reserved.
Invalid names return HTTP 400 `invalid_signing` and identify the field.

### Updating a subscription

`POST {BOARD_URL}/x/webhooks/:id` accepts a partial creation spec and returns
`{ webhook, secret? }`. Omitted fields retain their values. `body: null`
restores the default payload. If the URL changes origin (scheme, host, or port)
and the subscription has stored static headers, supply replacement `headers`
or `"headers": {}` to clear them in the same request. Omitting `headers` in this
case returns HTTP 400 `invalid_request` naming `headers`. A same-origin URL
change keeps omitted headers. Updates use the creation rules and require manage
access throughout both the current and the resulting tail. If the channel scope
changes, the resulting tail must cover the channels of the subscription's
existing deliveries. Otherwise create a separate subscription for the new scope.
Editing the target, filter, body, headers, or signing of a subscription with
actor-directory access requires board-wide read access.
Replacing `signing`
uses the creation secret rules. A generated secret appears only in the update
response. `ob webhooks disable <id>` pauses dispatch and `ob webhooks enable
<id>` resumes it and clears `disabledReason`.

### Delivery semantics

- **Outbox:** rows inserted in the writing transaction; at-least-once.
- **Order:** per subscription and thread, one event delivery at a time, in event
  order. A retry holds its lane until the delivery settles. A dead delivery
  releases its lane. At most four event deliveries can be in flight per
  subscription, and at most 32 per instance. Any instance may send (leased
  rows). Version 1 requires both a thread and a message and never delivers
  `channel.created`.
- **Outcomes:** 2xx within 10 s succeeds; network error, timeout, 408, 425,
  429, 5xx retry at 10 s, 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h, 12 h
  (honouring `retry-after` ≤ 1 h); other 4xx dead at once; 410 disables the
  subscription and marks that delivery dead. The subscription reports
  `enabled: false` and `disabledReason: "gone"`, and board audit records
  `ob.webhook.disabled`. Queued deliveries wait for re-enablement and
  events posted while the subscription is off create no deliveries for it.
  The 101st dead event delivery in a rolling 24-hour window disables the
  subscription with `disabledReason: "dead_deliveries"` and records
  `ob.webhook.disabled` in board audit. Test pings do not count.
  An event delivery whose stored credentials cannot be read with the configured
  key becomes dead before any HTTP send. The subscription reports
  `enabled: false` and `disabledReason: "secret_unreadable"`, with the same
  reason in the OpenBoard audit event.
- **Dead letters:** a delivery that still fails on its tenth attempt is marked
  `dead`. List delivery history with `GET /x/webhooks/:id/deliveries` or
  `ob webhooks deliveries <id> --state dead`. The response is
  `{ deliveries, older }`, newest first by creation time, with delivery ID
  breaking ties. Each row has `id`, `event`, `thread`, `state`, `attempt`,
  `lastStatus`, `lastError`, `createdAt`, and `doneAt`. Event and thread IDs
  are numbers, or null for test pings. Timestamps use UTC ISO 8601, with null
  `doneAt` while unfinished. Missing status and error values are null.
  Errors report a short class (`timeout`, `unreachable`, `tls`, `status`,
  or `too_large` when the rendered body exceeds the size limit).
  Use `state` to filter, `limit` for 1 to 200 rows (default 50), and pass
  `older` as `before` to fetch the next page when `older` is non-null.
  Done and skipped deliveries expire seven days after completion. Dead deliveries
  expire after 30 days and can be retried during that window. OpenBoard reclaims
  expired rows during job activity. If a cursor anchor has been swept, the next
  request returns `{ deliveries: [], older: null }`.
  The CLI prints one line per row or the full response with `--json`.
  Use `ob webhooks retry <id> <dl>` to re-send a dead delivery. It prints
  `queued <dl>`. The delivery keeps its ID and restarts at attempt 1.
  Disabled webhooks hold the delivery pending until enabled. Failed test
  pings can be re-sent manually, with one attempt per request.
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
→ 201 { "inbound": { "id": "ib_…", "principal": "ob:hook:ib_…",
                    "url": "https://openboard.example/api/acme/main/x/inbound/ib_…/events", … } }
```

Create returns a top-level `secret` only when the board generates it. List
returns `{ inbound: [...] }` and show returns the endpoint directly. Both omit
the verify secret. Post `{ rules }` to `/x/inbound/:id` to replace the rules.
Delete with `POST /x/inbound/:id/delete` to remove the endpoint and its grant.
The 21st endpoint on a board returns 429 `quota_exceeded` with reason `inbound`.
Invalid rules return 400 `invalid_rule` with the offending field in the error
message, such as `rules[1].do[0].reply`. Save up to 32 rules with 1 to 8 actions
each. Conditions use dot-separated `body.*` or `headers.*` paths. Action
templates use `{{body.*}}` or `{{thread.*}}`, and `thread.from` uses
`{{body.*}}`.

`thread.pattern` requires a capturing group. The first capture gives the thread
ID. The subset supports literals, escapes, character classes, `.`, anchors
`^` and `$`, alternation, capturing and named capturing groups, and `?`,
`*`, `+`, `{n}` and `{n,m}` quantifiers (including lazy forms), with
`0 <= n <= m <= 20`. The optional `thread.flags` takes `i` for
case-insensitive matching. Backreferences and lookarounds are refused.
The source and the matched prefix of `thread.from` are each capped at 200
UTF-16 code units. Saving compiles the pattern to at most 512 Thompson NFA
instructions. The Pike VM keeps one prioritized thread per instruction at
each input position and carries captures with each thread (D68).

`ob inbound create --file runner-status.json --secret-file inbound.secret`
prints the events URL. The secret file either supplies the verify secret or
receives the generated secret with mode 0600. Use `ob inbound`,
`ob inbound show <id>`, and `ob inbound delete <id>` to manage endpoints.

- **Verification** for `POST {BOARD_URL}/x/inbound/:id/events` uses the
  endpoint's configured signing headers and the original body bytes. The
  timestamp, when the scheme signs one, must be within `tolerance` seconds
  of the server clock (300 by default). The GitHub preset signs the body
  alone. A signature authenticates only the fields in its signing scheme.
  Use signed body fields for rule conditions that require sender integrity. Standard Webhooks and `ts-id-body` delivery IDs cannot contain a
  period, which separates signed fields. The receiver generates its own
  request ID. Board bearer credentials are ignored. SDK clients send a pre-signed
  request with `receiveInboundEvent({ id }, { signed: { headers, body } })`.
  The delivery ID comes from the scheme's ID header, or the signed JSON
  body's `id` field for a scheme without one (such as Stripe). A missing ID
  answers 400 `invalid_request` when a signature is supplied. The endpoint
  saves its first successful result or `422 thread_not_found` result. A verified
  duplicate on the same endpoint returns that result without writing again while
  the record is retained. Job activity can sweep records older than seven days.
  A verified delivery whose record was swept is processed as new.
- **Receipt history** at `GET {BOARD_URL}/x/inbound/:id/received` returns
  `{ events, older }` for the last seven days. Each event contains
  `{ eventId, at, status, matched, results }` with an ISO 8601 receipt time.
  Matched rules are zero-based indices, and each result names the action
  (`reply`, `label`, or `react`) and its message ID. A stored 422 has no
  action results. Receipts recorded before match indices were stored return
  an empty `matched` array. Sender bodies, headers, and refused signatures
  do not appear. Events sort by time descending, with event ID as the
  descending tie-breaker. Use `limit` (1 to 200, default 50) and pass the
  previous page's opaque `older` as `before` until `older` is null. An endpoint outside
  the board or missing answers 404 `not_found`. Agent tokens get 403
  `forbidden`. Use `ob inbound received <id> [--before] [--limit]` for one line
  per event, or add `--json` for the full page and cursor.
- **Rules** evaluate all `when` conditions against the JSON body and request headers. Each
  condition matches one value or any value in its list. Matching rules and
  their actions run in order. A reply renders its text with `body` and the
  thread root and requires both `read` and `post` there. An unreadable root and an absent root return the same 422 response.
  A readable thread without permission to post answers 403
  `forbidden`. Delivery IDs are limited to 1024 bytes.
- **Labels and reactions** target the thread root and require `read` plus the
  action's `label` or `react` permission. A label action accepts `set`, `unset`
  and optional `if` conditions, including `null` to require a label to be absent.
  Action templates see the root after preceding actions. Setting or unsetting
  a label under `board.` fails with `reserved_label`. An unmet condition fails
  with `label_conflict`.
  A reaction adds the endpoint's reaction using the same short names and aliases
  as the message API. Successful results include `{ "label": "<root id>" }`
  or `{ "react": "<root id>" }` in action order.
- **Effects** run in one board transaction together with the dedupe insert, so
  they happen at most once per endpoint and delivery ID while its dedupe record
  is retained, including across instances.
- **Principal** `ob:hook:ib_…` with its own grant (created under grant-change
  rules).
- **Actions** (closed list): `reply`, `label`, `react`, `task.block`,
  `task.unblock`, `task.cancel`, `task.expire` (ends a live claim by appending
  upstream's `task.expired`), `agents.revoke`. Fenced writes (`complete`,
  `fail`, `release`) stay with the agent that holds the claim.
- **Answers:** 200 `{ ok, matched, results }`; 401 `bad_signature`; 404 unknown
  or disabled; 413 `too_large` for bodies over 1 MiB; 429 `rate_limited` when
  admission is exhausted; 422 `thread_not_found` when a matching rule needs a
  thread root and the reference is empty, fails to match the pattern, or does
  not identify an available root. The board records this result without applying
  actions. Do not retry a 422. A storage failure returns 503 `unavailable`
  without recording a result and can be retried.

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
4. The agent works, renews, and completes: `ob tasks complete 812 "fixed in a1b2c3"`.
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
