# How the project runs

OpenBoard is built mostly by coding agents, one small ticket per pull request. This file says in what order, how a ticket is written and moves, how PRs land, how parallel agents stay out of each other's way, and when the project starts running on its own board. Structure and code rules are in [codebase.md](codebase.md); agent rules in [AGENTS.md](../AGENTS.md).

## 1. Milestones

Build order is fixed: each milestone is usable end to end before the next starts, and the first one is the thinnest slice that works. A milestone is **done** when the conformance checks it names pass in `tools/conformance/score.json` in every mode it must pass in, its other criteria pass, and its demo script (`.veebee/milestones/Mn-slug.md`, section "Demo") has been run against a real instance (local through M5, staging from M6) with the transcript pasted into the milestone's closing issue.

**Modes.** *Local* is SQLite, one process (`ob serve`). *Hosted* is Postgres with two instances sharing one database (`docs/codebase.md` 6.4). Until M4, milestones must pass in local mode. From M5 on, every milestone must pass in both, and `Verify` runs both on every PR. Tenancy keys (`org_id`, `board_id`) exist from the first migration in M1, and every board URL has its organization and board in the path (`/api/local/main`, bare `/api` as its alias): local mode is one implicit organization and board, not a schema without tenants. Before M5, multi-organization behaviour is tested on the SQLite driver, which can hold several organizations in tests.

| # | Milestone | Mode | What works at the end | Done when |
|---|---|---|---|---|
| M0 | Foundations | n/a | Workspaces (including `ports`, `driver-sql`, `driver-sqlite`, `driver-postgres`, `apps/openboard` as empty packages), Biome, oxlint, boundaries (graph, `driver-sql` and driver imports, SQL outside `driver-*`, deny terms), sizes, migrations check over the single source, agents guard, the `Verify` check with its six jobs and a Postgres service container, conformance printing zeros, `bench --quick` counters, isolation suite skeleton that walks the contract | `Verify` green on `main` in under two minutes; `bun run conformance` prints a table of zeros in both modes |
| M1 | Walking skeleton | local | `ob serve`; the implicit organization `local` and board `main` at `/api/local/main` (bare `/api` as alias); the local owner token written at first start to `~/.config/openboard/local/<port>.json` (mode 0600, never printed) and read by `ob`; `ob post`, `ob reply`, `ob read`; discovery; posts and replies stored as events with `org_id`/`board_id` | core: discovery, posts and reads back by ID, puts a reply in its root's thread, reads one channel's messages after a cursor, reads one channel's newest messages, lists the channel and you in it, answers 404, answers 400 (8). Local bench baseline in `budgets.json` |
| M2 | Messages and threads | local | `after`, client IDs, edits and deletes at a revision, reactions, labels with `if`, versions, thread reads, thread lists, channel lists and creation, mentions, tombstones, label lookup after delete, `noSync`, paging, search | core: replies after only while newest; posts once for a client ID; raises the version; labels only while labels are as written; edits and deletes at a revision; lists channels a page at a time; reads a thread's replies after one of its messages; lists threads with reply count; stores a handle as a mention; deletes leaving a tombstone; drops a deleted message from what its labels find; creates a channel only once (12). paging (2), search (2), sync: keeps noSync on a post and a reply (1) |
| M3 | Live tail | local | Event feed after a cursor, newest events, long-poll, SSE, `ob tail`, SDK `tail()` with reconnect, all through the `Broadcaster` port | core: reads events after a cursor; reads a channel's newest events; holds a long-poll open until the next event (3). 50 SSE tails within the local budget |
| M4 | Accounts, organizations and auth | local (several organizations in tests) | Accounts, organizations, memberships with roles, invitations, boards per organization; connections claimed with URL + secret (`ob connect <url> --as <name>`, secret on stdin); profiles; verifier chain with GitHub sign-in and the CLI device flow; `ob use`; `/api/x/` account and organization routes; one organization per person (D34); audit events | core: takes a profile and its avatar as one x-board-profile header; lets a profile change only its own messages; ignores x-board-avatar; ignores x-board-session; shows no session (5). Tenant isolation suite (generated) green on SQLite from this milestone's first multi-tenant ticket |
| M5 | Postgres driver | local and hosted (one Postgres instance) | `driver-postgres` implements every port through the shared SQL in `driver-sql` (Bun's built-in SQL client, the `boards` row lock, migrations rendered from one source); `OPENBOARD_DATABASE_URL` selects it; a measurement task: measure the cost of Postgres row-level security on the read path and record a decision in `docs/decisions.md` | Driver testkit, `EXPLAIN` registry and schema-parity tests green on both engines; isolation suites green on Postgres; `score.json` `hosted` lists exactly the checks `local` lists; hosted bench baseline recorded; the RLS decision recorded with its numbers |
| M6 | High availability | local and hosted (two instances) | Postgres `Broadcaster` (`pg_notify` as a wake-up only, read by cursor, 2 s safety poll, re-read on reconnect), jobs any instance can run (`SKIP LOCKED`), drain on `SIGTERM`, `/readyz`, expand-only migrations under an advisory lock, failover-ready reconnects and the D37 timeline guard; staging on Railway with two replicas and Railway Postgres (one node) | The HTTP, isolation and HA suites (including the kill-the-database drill) and conformance green with two instances on one Postgres, with the same score as local; `scripts/release/rolling-check.ts` passes on staging: a tail open through a rolling deploy of every replica receives every posted message exactly once, in order |
| M7 | Hosted deploy | both | Production on Railway (two or more replicas, Railway Postgres one node, `openboard migrate` before start), release pipeline to production, the v1 SaaS minimums of D40 (count and size quotas, per-organization rate limits, organization deletion, SSRF guard settings), sign-up behind `OPENBOARD_SIGNUP=invite`, backups (Railway volume backups, per-organization log shipping every 10 s, daily `pg_dump`; `VACUUM INTO` snapshots locally), self-host image and one-volume path | Production serves sign-up and a board; a release goes to production with rolling-check green; a self-host container on one volume passes `bun run conformance --url` with the local score |
| M8 | Front | both | SPA embedded in the binary, on the routes of `docs/protocol.md` "URLs": sign in, sign-up that creates the person's organization with board `main` or joins one through an invitation, organization settings (members, boards), board settings (connections, grants), the device page for `ob login`, channels, threads, compose, live updates, virtualized lists | Playwright journeys green in `web.yml` on both modes: sign up -> organization and board `main` created -> create a connection -> see an agent's post arrive live; an invited person signs in and joins; read a channel and post |
| M9 | Tasks | both | Tasks, claims with leases and renewals, fencing, needs and readiness, batches, holds, assignment, `--next` claims, ready feed | tasks: all except the three that need a narrowed caller (claims none when narrowed; takes read in a prerequisite's channel; lets a profile change only the tasks it made) and "holds a task when anyone but its owner edits its root" (20) |
| M10 | Access | both | Grants, patterns, `explain`, `x-board-can` narrowing, lockout refusal, grant batches | grants: all 14, of which the four upstream's own server cannot pass (team role cap, apps, member grant after a lock, project on another team) are recorded as `expectedSkips` (10 pass). core: narrows a caller to what its x-board-can says (1). tasks: the three narrowed-caller checks (3) |
| M11 | Webhooks and watchers | both | Signed outbound webhooks through the outbox and jobs, delivery log, retries, inbound endpoints (D18), watchers; organization settings page for webhooks | watchers: all 3. Webhook delivery exactly once across two instances (HA test); `examples/webhook-receiver` passes its own test |
| M12 | MCP, SDK, skill | both | `/mcp`, SDK and CLI on npm, `skills/openboard` installable with `npx skills add` | An agent with only the skill, a URL and a secret posts, claims and completes a task through MCP and through `ob` against production (demo transcript) |
| M13 | Data, files, schedules | both | Schemas and blocks, attachments through the `Blobs` port, scheduled posts through `Jobs` | schemas (5), attachments (3), schedules (2) |
| M14 | External sync | both | Sync records, inbox, receipts; platform bridges as recipes in `examples/` | sync: the six remaining checks, and tasks: holds a task when anyone but its owner edits its root (7). While D19 defers platform sync, these are recorded as `expectedSkips` with D19 as the reason, by the owner |
| M15 | Operations | both | Offsite backups and restore drills for both modes, metrics endpoint, log retention, compaction policy, `openboard admin` commands, upgrade runbook | Restore drill recorded for SQLite and Postgres; full bench within budgets for 7 nightly runs in both modes |

Every one of upstream's 91 checks is placed exactly once: core 29 (M1 8, M2 12, M3 3, M4 5, M10 1), tasks 24 (M9 20, M10 3, M14 1), grants 14 (M10), sync 7 (M2 1, M14 6), schemas 5, attachments 3 and schedules 2 (M13), watchers 3 (M11), paging 2 and search 2 (M2). Check names are upstream's, from `@vercel/board`'s `src/conformance/index.ts`; ticket front-matter `conformance:` lists them as `group/name`.

SaaS seams (quotas, rate limits, usage metering, organization export and deletion) are designed in `docs/codebase.md` 4.5 and built after v1; billing is out of scope.

**Changes from the previous list.** M0 gains the driver, SQL and migrations checks and the Postgres job. M1 now includes replies (upstream's first post check also posts a reply) and tenancy keys. M4 becomes accounts, organizations and auth. M5 (Postgres driver) and M6 (high availability) are new. The old M5 "Deploy" is now M7 "Hosted deploy", after HA. Front, tasks, access, webhooks, MCP/SDK/skill, data, sync and operations move from M6-M13 to M8-M15; the front gains the organization onboarding journey; access takes the narrowed-caller checks; every milestone names its exact checks.

The whole cut, one line per ticket with its dependencies, lives in `.veebee/cut.md` and covers every milestone. Ticket files are written for M0 to M4 up front, since the upstream protocol and its conformance checks specify them. From M5 on, a milestone's ticket files are written only when the milestone before it is nearly done, so they are written against code that exists; until then its lines in `.veebee/cut.md` are the plan.

## 2. Tickets

### 2.1 Format

One ticket per file: `.veebee/tickets/NN-slug.md`, numbered in creation order across the project (`31-reply-in-a-thread.md`). Front-matter in English, body in English.

```markdown
---
id: 31
title: Reply in a thread
milestone: M1-walking-skeleton
package: server            # the one workspace that owns the change (contract|core|ports|driver-sql|driver-sqlite|driver-postgres|server|sdk|cli|web|app|tools|docs)
writes:                    # globs this ticket may change; no other open ticket may claim them
  - packages/core/src/messages/**
  - packages/server/src/operations/messages.ts
  - packages/contract/src/operations/messages.ts
conformance: ["core/puts a reply in its root's thread"]
modes: [local]             # local | hosted; from M5 on, both
depends_on: [25, 26]
status: ready              # draft | ready | claimed | review | done | dropped
claimed_by: null
issue: null                # GitHub issue number once mirrored
---

## What the user does
One sentence, as the person or agent would say it.

## Done when
- [ ] `ob reply 812 "on it"` prints the reply's ID, and `ob read dev --thread 812` shows it under 812
- [ ] one to three criteria, each checked by using the product, never by reading code

## Out of scope
What someone might think belongs here and does not, with the ticket that carries it.

## Notes
Only when code exists: where it plugs in, what to reuse.
```

A ticket is an atomic vertical slice: one user-visible action, through every layer it needs (contract, core, port and drivers, server, client), within the 600-changed-lines-per-workspace limit. "Out of scope" is mandatory; it is what stops the neighbouring slice from landing in the same PR. Acceptance criteria are commands and their visible results, or a screen and what it shows.

### 2.2 Lifecycle

```
draft --(owner or planner agent reviews)--> ready --(agent claims)--> claimed --(PR opened)--> review --(merged)--> done
                                                                                                   \--> dropped (with a reason)
```

- **draft**: written, not yet checked against the code or the milestone.
- **ready**: dependencies are `done` or in review, `modes` says where it must pass, `writes` overlaps no claimed ticket, criteria are checkable.
- **claimed**: one agent owns it. Its branch exists. `claimed_by` names the agent session.
- **review**: PR open, linked with `Closes #<issue>` and the ticket path.
- **done**: the PR that implemented it also set `status: done` in the ticket file. A done ticket is never rewritten; a change in behaviour is a new ticket.
- **dropped**: kept in the tree with a one-line reason; never deleted.

### 2.3 Mirror to GitHub issues

`bun scripts/tickets/sync-issues.ts` creates or updates one issue per ticket in `The-Vibe-Company/openboard`, with the ticket body, labels from the front-matter, the milestone as a GitHub milestone, and writes the issue number back into `issue:`. The file is the spec; the issue is the public handle PRs close and people comment on. Comments that change the scope go back into the file in the next PR, not left only in the issue. The script never closes or deletes issues; merging the PR closes them.

## 3. Branches, pull requests, merge queue

- **Branch**: `t/NN-slug` for a ticket, `fix/slug` for an unplanned fix (which still gets a ticket file in the same PR). One branch, one agent: never push to a branch another session owns (armada: `AGENTS.md` "Pull requests").
- **Title**: Conventional Commits, imperative, 60 characters or fewer: `feat(server): reply in a thread`. Types `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `chore`, with `!` for a breaking change. Scope is the owning workspace (`contract`, `core`, `ports`, `driver-sql`, `driver-sqlite`, `driver-postgres`, `server`, `sdk`, `cli`, `web`, `app`, `conformance`, `bench`, `skill`, `ci`, `docs`) (armada and upstream both use this format).
- **Body** (`.github/pull_request_template.md`), adapted from upstream's four answers (upstream: `AGENTS.md` "pr titles and descriptions"):
  - first line: what it does and for whom, then `Ticket: .veebee/tickets/NN-slug.md` and `Closes #N`;
  - `Users:` none, or the new or changed command, SDK call, MCP tool or screen, with a pasted transcript or screenshot;
  - `Protocol:` none, or routes and codes added or changed, upstream or OpenBoard-only;
  - `Conformance:` the score diff printed by `bun run conformance` (`tasks 31/58 -> 36/58`), or `unchanged`;
  - `Performance:` the `bench --quick` diff, or `unchanged`;
  - `Tests:` what is covered and at which layer, what is faked and why;
  - `Dependency:` none, or the package, its install size, why Bun or the standard library cannot do it, and what else was considered.
- **Size**: at most 600 changed lines per workspace (generated files, lockfile, pure deletions and renames excluded). Bigger work is split before it is coded. CI enforces it; only the owner can apply `size-exception`.
- **Merge**: GitHub merge queue on `main`, squash only, one required check `Verify` (armada: `docs/merge-queue.md`). The orchestrator merges with `gh pr merge <n> --squash` once `Verify` is green and review is done; an agent never merges its own PR, and no one uses `--admin`. Branches are deleted on merge.
- **Review**: the PR author is never its only reviewer. The author ships with the `ship-pr-dev` skill, whose `review-code-dev` pass is an independent review; the orchestrator then re-runs the ticket's acceptance criteria, reviews the diff against this file, `AGENTS.md` and the ticket, and merges. There is no CODEOWNERS file (D44). After three review rounds, non-security, non-data-loss findings may be deferred to a new ticket that contains the failing test (armada: `AGENTS.md` "Review").

## 4. Labels

| Label | Meaning |
|---|---|
| `pkg:contract`, `pkg:core`, `pkg:ports`, `pkg:driver-sql`, `pkg:driver-sqlite`, `pkg:driver-postgres`, `pkg:server`, `pkg:sdk`, `pkg:cli`, `pkg:web`, `pkg:app`, `pkg:tools`, `pkg:docs` | the owning workspace (from `package:`) |
| `M0` … `M15` | milestone (also set as GitHub milestone) |
| `ready`, `claimed`, `review`, `blocked` | ticket state, mirrored from the file |
| `needs-decision` | stopped on a question only the owner can answer; the question is the first line of the latest comment |
| `conformance` | the ticket targets named conformance checks |
| `perf` | the ticket changes bench numbers or budgets |
| `size-exception` | owner only; lets one PR exceed the size limit |
| `bug` | behaviour differs from the docs or upstream's protocol |
| `isolation` | touches tenant scoping or the isolation suites; the PR says so in its body |

## 5. Parallel agents

- **Ownership by package.** Every ticket names one owning workspace and the globs it `writes`. Two claimed tickets never have overlapping `writes`. The claim step checks this (`bun scripts/tickets/claim.ts NN` refuses an overlap) and, after dogfooding phase B, the board's task claim does.
- **One writer per file set.** If a ticket needs a file another claimed ticket owns, it waits (`depends_on`) or the tickets are re-cut. No agent edits outside its ticket's `writes` without updating the ticket in the same PR and re-checking overlap.
- **Shared append points are few and sorted**: `packages/contract/src/operations/index.ts`, `packages/server/src/operations/index.ts`, `packages/cli/src/commands/index.ts`, `packages/ports/src/store.ts`, and `packages/driver-sql/migrations/`. Additions go in sorted position so concurrent PRs rebase cleanly. Migrations take the next free number at merge time, from the one migration source; the merge queue re-runs `Verify`, which fails on a duplicate number.
- **Contract first when it is shared.** When several tickets in a milestone need the same new entity or error code, a small `feat(contract)` ticket lands it first, and the others depend on it.
- **Parallelism limit**: at most one claimed ticket at a time touching `contract`, `ports` or `driver-sql/migrations/` (shared foundations), at most three for `server` and `web`, provided `writes` do not overlap.
- **Port changes go through both drivers.** A ticket that adds a port method owns `packages/ports/src/store.ts` and the matching `packages/driver-sql/src/views/<area>.ts`; nobody else writes those files until it merges.

## 6. Dogfooding

The project moves its own coordination onto OpenBoard as soon as the board can carry it.

- **Phase A, from M7 (production deployed).** An organization `tvc` on the hosted production instance (never staging, which nightly conformance writes to) hosts the channels `openboard/dev` (one thread per PR, opened by the agent that opens the PR), `openboard/ops` (deploys, nightly results, bench), and `openboard/decisions` (questions for the owner; answers are copied into `docs/decisions.md`). Agents connect with a connection secret, nothing else. Tickets stay in files and GitHub issues.
- **Phase B, from M9 (tasks).** Each `ready` ticket is also a board task in `openboard/tickets`, created by `scripts/tickets/sync-board.ts` with the ticket path and `depends_on` as task needs. Agents pick work with `ob tasks claim --next --channel openboard/tickets`, renew the lease while working, and complete the task when the PR merges. The board becomes the source of truth for ticket state (`ready`, `claimed`, `done`); the file keeps the spec and the GitHub issue stays the mirror PRs close. If the board is down, agents stop claiming and fall back to GitHub issue assignment until it is back; they never run two queues at once.
- **Phase C, from M11 and M12.** A signed webhook on task readiness drives TVC's agent launcher through a recipe in `examples/`, so new ready tickets start agents without a person. That recipe is the only place the launcher's name appears in this repository.

Every gap dogfooding reveals (a missing filter, a confusing error, a slow page) becomes a ticket labelled `bug` or `perf` in the next milestone that touches it.

## 7. Decisions and questions

- A choice that constrains later tickets (a dependency, a schema shape, a protocol extension, a budget) is recorded in `docs/decisions.md` in the same PR that makes it, using the format defined there.
- An agent blocked by a question only the owner can answer stops, labels the ticket `needs-decision`, and asks it in one sentence on the issue (and in `openboard/decisions` from phase A). It does not guess and does not build around it (armada: `AGENTS.md` non-negotiable 7).
