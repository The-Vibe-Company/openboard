import { BoardError, type Registration } from "@openboard/contract";
import {
  type BoardEvent,
  checkWatcherLease,
  decideWatcherAck,
  eventAuthors,
  eventMentions,
  formatId,
  isTailMessage,
  isTailMessageEvent,
  matchesTailEvent,
  mentionFilter,
  parseTail,
  WATCHER_LEASE_MS,
  WATCHER_MAX_TRIES,
  type WatchersRegistered,
} from "@openboard/core";
import type { BoardKeys, BoardView, BoardWriter } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";
import { messageEvent } from "../events.ts";
import type { AutomationEvent } from "../messages.ts";

const matchRows: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? "jsonb_array_elements(input.data::jsonb)" : "json_each(input.data)"),
};

export const watcherStatements = {
  registrations: sql`SELECT owner, watch, hash FROM watcher_registrations
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND (CAST(${"owner"} AS TEXT) IS NULL OR owner = ${"owner"}) ORDER BY owner`,
  watcherRegistrationHash: sql`SELECT hash FROM watcher_registrations WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND owner = ${"owner"}`,
  replaceRegistration: sql`INSERT INTO watcher_registrations (org_id, board_id, owner, watch, hash, at)
    VALUES (${"orgId"}, ${"boardId"}, ${"owner"}, ${"watch"}, ${"hash"}, ${"at"})
    ON CONFLICT (board_id, owner) DO UPDATE SET watch = excluded.watch, hash = excluded.hash, at = excluded.at
    WHERE watcher_registrations.org_id = ${"orgId"} AND watcher_registrations.board_id = ${"boardId"}`,
  addWatcherMatches: sql`WITH input AS (SELECT CAST(${"rows"} AS TEXT) AS data)
    INSERT INTO watcher_matches (org_id, board_id, id, owner, watcher, thread, event, state, next_at, needs_actor_directory)
    SELECT ${"orgId"}, ${"boardId"}, value ->> 0, value ->> 1, value ->> 2,
      ${"thread"}, ${"event"}, 'pending', ${"at"}, CAST(value ->> 3 AS INTEGER)
    FROM boards CROSS JOIN input CROSS JOIN ${matchRows}
    WHERE boards.org_id = ${"orgId"} AND boards.id = ${"boardId"}`,
  nextWatcherMatches: sql`SELECT m.id AS match_id, m.watcher, m.attempt, m.lease, e.id, e.type, e.at, e.thread,
      e.message, e.channel, e.actor, e.principal, e.payload
    FROM watcher_matches m JOIN events e ON e.org_id = m.org_id AND e.board_id = m.board_id AND e.id = m.event
    WHERE m.org_id = ${"orgId"} AND m.board_id = ${"boardId"} AND m.owner = ${"owner"}
      AND m.needs_actor_directory <= ${"canReadDirectory"}
      AND (${"canRetire"} = 1 OR m.attempt + (CASE WHEN m.lease IS NULL THEN 0 ELSE 1 END) < ${"maxTries"})
      AND (m.event, m.id) > (${"afterEvent"}, ${"afterId"})
      AND m.state = 'pending' AND m.next_at <= ${"now"} AND (m.lease_until IS NULL OR m.lease_until <= ${"now"})
      AND NOT EXISTS (SELECT 1 FROM watcher_matches older WHERE older.org_id = ${"orgId"} AND older.board_id = ${"boardId"}
        AND older.owner = m.owner AND older.thread = m.thread AND older.state = 'pending'
        AND (older.event, older.id) < (m.event, m.id))
    ORDER BY m.event, m.id LIMIT 50`,
  discardWatcherThread: sql`DELETE FROM watcher_matches
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND owner = ${"owner"} AND thread = ${"thread"}
      AND state = 'pending' AND (lease_until IS NULL OR lease_until <= ${"now"})`,
  discardDirectoryMatches: sql`DELETE FROM watcher_matches
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND owner = ${"owner"} AND needs_actor_directory = 1
      AND state = 'pending' AND (lease_until IS NULL OR lease_until <= ${"now"})`,
  leaseWatcherMatch: sql`UPDATE watcher_matches SET lease = ${"lease"}, lease_until = ${"until"}, attempt = ${"attempt"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND owner = ${"owner"} AND id = ${"id"}`,
  watcherLease: sql`SELECT m.lease, m.attempt, m.watcher, m.thread, e.channel
    FROM watcher_matches m JOIN events e ON e.org_id = m.org_id AND e.board_id = m.board_id AND e.id = m.event
    WHERE m.org_id = ${"orgId"} AND m.board_id = ${"boardId"} AND m.owner = ${"owner"} AND m.id = ${"id"}`,
  retryWatcherMatch: sql`UPDATE watcher_matches SET attempt = ${"attempt"}, next_at = ${"nextAt"}, lease = NULL, lease_until = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND owner = ${"owner"} AND id = ${"id"}`,
  removeWatcherMatch: sql`DELETE FROM watcher_matches
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND owner = ${"owner"} AND id = ${"id"}`,
};

function registration(row: Row): Registration {
  return {
    owner: String(row.owner),
    watch: JSON.parse(String(row.watch)) as Registration["watch"],
    hash: String(row.hash),
    url: null,
    sync: [],
  };
}

export function watcherReads(db: Db, dialect: Dialect, keys: BoardKeys): Pick<BoardView, "watcherRegistrations"> {
  return {
    async watcherRegistrations(owner) {
      const rows = await query(db, dialect, watcherStatements.registrations, { ...keys, owner });
      return rows.map(registration);
    },
  };
}

export async function foldWatchersRegistered(db: Db, dialect: Dialect, keys: BoardKeys, event: WatchersRegistered) {
  const { owner, watch, hash } = event.payload;
  await query(db, dialect, watcherStatements.replaceRegistration, {
    ...keys,
    owner,
    watch: JSON.stringify(watch),
    hash,
    at: event.at,
  });
}

async function loadWatchers(db: Db, dialect: Dialect, keys: BoardKeys) {
  const registrations = await watcherReads(db, dialect, keys).watcherRegistrations(null);
  return registrations.flatMap(({ owner, watch }) =>
    Object.entries(watch).map(([id, { tail }]) => ({ owner, id, filters: parseTail(tail) })),
  );
}

/** Read the snapshots before the fold, while the writing transaction still holds its board lock. */
export function watcherMatcher(db: Db, dialect: Dialect, keys: BoardKeys) {
  let watchers: Awaited<ReturnType<typeof loadWatchers>> | undefined;
  return {
    invalidate() {
      watchers = undefined;
    },
    async match(event: BoardEvent, { findFilterActors, readMessage }: AutomationEvent) {
      // Previous releases can lease any persisted match, so only match event kinds their readers decode.
      if (
        event.type === "task.expired" ||
        event.type === "task.released" ||
        event.type === "task.failed" ||
        event.type === "task.canceled" ||
        event.type === "task.reopened" ||
        event.type === "task.needs_changed" ||
        event.type === "task.blocked" ||
        event.type === "task.unblocked" ||
        event.type === "task.assigned" ||
        event.type === "task.ready" ||
        !isTailMessageEvent(event)
      )
        return;
      watchers ??= await loadWatchers(db, dialect, keys);
      if (!watchers.length) return;
      const previous = event.type === "message.posted" ? undefined : await readMessage(event.message);
      const root = event.thread === event.message ? undefined : await readMessage(event.thread);
      const rows: [id: string, owner: string, watcher: string, needsDirectory: number][] = [];
      for (const { owner, id: watcher, filters } of watchers) {
        if (!isTailMessage(event, filters.all)) continue;
        const { author, mention } = filters;
        const actors = await findFilterActors(
          author,
          mention === undefined ? undefined : mentionFilter(mention, owner, true),
        );
        const resolved = {
          ...filters,
          authors: author === undefined ? undefined : eventAuthors(author, owner, actors),
          mentions: mention === undefined ? undefined : eventMentions(mention, owner, actors),
        };
        if (!matchesTailEvent(event, resolved, previous, root)) continue;
        // A caller who cannot read the actor directory may still match a mention written literally.
        const direct =
          mention === undefined ||
          matchesTailEvent(event, { ...resolved, mentions: eventMentions(mention, owner, []) }, previous, root);
        const id = `${event.id}-${String(rows.length + 1).padStart(12, "0")}`;
        rows.push([id, owner, watcher, direct ? 0 : 1]);
      }
      if (rows.length) {
        await query(db, dialect, watcherStatements.addWatcherMatches, {
          ...keys,
          thread: event.thread,
          event: event.id,
          at: event.at,
          rows: JSON.stringify(rows),
        });
      }
    },
  };
}

export function watcherWriter(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
): Pick<BoardWriter, "watcherRegistrationHash" | "pullWatcherMatches" | "ackWatcherMatch"> {
  async function watcherRegistrationHash(owner: string) {
    const [row] = await query(db, dialect, watcherStatements.watcherRegistrationHash, { ...keys, owner });
    return row ? String(row.hash) : null;
  }
  return {
    watcherRegistrationHash,
    async pullWatcherMatches({ owner, now, limit, mintLease, onFailure, canRead, canReadActorDirectory }) {
      if ((await watcherRegistrationHash(owner)) === null) {
        throw new BoardError("no_registration", "this caller has no watchers registered here");
      }
      if (!canReadActorDirectory)
        await query(db, dialect, watcherStatements.discardDirectoryMatches, { ...keys, owner, now });
      const matches = [];
      let afterEvent = 0;
      let afterId = "";
      let canRetire = true;
      // Read a bounded page before applying caller-specific channel access.
      scan: while (matches.length < limit) {
        const rows = await query(db, dialect, watcherStatements.nextWatcherMatches, {
          ...keys,
          owner,
          now,
          afterEvent,
          afterId,
          canReadDirectory: canReadActorDirectory ? 1 : 0,
          canRetire: canRetire ? 1 : 0,
          maxTries: WATCHER_MAX_TRIES,
        });
        for (const row of rows) {
          if (!canRead(String(row.channel))) {
            // Every match in this thread belongs to the same channel. Preserve outstanding leases.
            await query(db, dialect, watcherStatements.discardWatcherThread, {
              ...keys,
              owner,
              now,
              thread: Number(row.thread),
            });
            continue;
          }
          const id = String(row.match_id);
          const attempt = Number(row.attempt) + Number(row.lease != null);
          if (attempt >= WATCHER_MAX_TRIES) {
            await query(db, dialect, watcherStatements.removeWatcherMatch, { ...keys, owner, id });
            onFailure(watchFailure(row, id, "watcher lease expired"));
            // Append at most one failure per pull even when many leases expire at once.
            canRetire = false;
            // Its successor may now be eligible ahead of the rest of the prefetched page.
            afterEvent = Number(row.id);
            afterId = id;
            continue scan;
          }
          const lease = mintLease();
          await query(db, dialect, watcherStatements.leaseWatcherMatch, {
            ...keys,
            owner,
            id,
            lease,
            attempt,
            until: now + WATCHER_LEASE_MS,
          });
          matches.push({ id, lease, watcher: String(row.watcher), attempt, event: messageEvent(row) });
          if (matches.length === limit) break;
        }
        const last = rows.at(-1);
        if (rows.length < 50 || !last) break;
        afterEvent = Number(last.id);
        afterId = String(last.match_id);
      }
      return matches;
    },
    ackWatcherMatch: (input) => ackMatch(db, dialect, keys, input),
  };
}

async function ackMatch(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  { owner, id, lease, error, skip, now }: Parameters<BoardWriter["ackWatcherMatch"]>[0],
) {
  const scope = { ...keys, owner, id };
  const [row] = await query(db, dialect, watcherStatements.watcherLease, scope);
  if (!row) throw new BoardError("no_match", "no match is waiting for this caller");
  checkWatcherLease({ lease: typeof row.lease === "string" ? row.lease : null }, lease);
  const decision = decideWatcherAck(Number(row.attempt), now ?? 0, { error, skip });
  if (decision.kind === "retry") {
    await query(db, dialect, watcherStatements.retryWatcherMatch, {
      ...scope,
      attempt: decision.attempt,
      nextAt: decision.nextAt,
    });
    return null;
  }
  await query(db, dialect, watcherStatements.removeWatcherMatch, scope);
  if (decision.kind === "drop") return null;
  return watchFailure(row, id, decision.error);
}

function watchFailure(row: Row, id: string, error: string) {
  const thread = Number(row.thread);
  return {
    channel: String(row.channel),
    thread,
    payload: { matched: id, thread: formatId(thread), error, watcher: String(row.watcher) },
  };
}
