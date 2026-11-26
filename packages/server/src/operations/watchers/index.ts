import { createHash } from "node:crypto";
import {
  type ackWatcherMatch,
  BoardError,
  type listWatchers,
  type pullWatcherMatches,
  type Registration,
  type registerWatchers,
} from "@openboard/contract";
import { formatId, validateWatchers, type WatchFailed } from "@openboard/core";
import type { BoardWriter } from "@openboard/ports";
import { allowedEverywhere, canListMentionActors, canReadChannel, isNarrowedCaller } from "../../auth/access.ts";
import { callerCan, credentialKind } from "../../deps.ts";
import { withLiveWait } from "../../http/limits.ts";
import { longPoll } from "../../live/long-poll.ts";
import { projectEvent } from "../events.ts";
import type { BoardContext, Handler } from "../index.ts";

function requireUnnarrowedCaller(by: BoardContext["by"]): void {
  if (isNarrowedCaller(by))
    throw new BoardError("forbidden", "narrowed callers cannot register, pull, or ack watchers");
}

export const registerWatchersHandler: Handler<typeof registerWatchers> = async (
  { board, by, now, debitWrite },
  input,
) => {
  requireUnnarrowedCaller(by);
  validateWatchers(input);
  const watch = input.watch;
  const canonical = Object.entries(watch)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, { tail }]) => [id, tail]);
  const hash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
  const registration: Registration = { owner: by.actor, url: null, watch, sync: [], hash };
  await board.write(async (writer) => {
    if ((await writer.watcherRegistrationHash(by.actor)) === hash) return;
    debitWrite();
    await writer.append([
      {
        type: "ob.watchers.registered",
        id: writer.head + 1,
        at: now(),
        actor: by.actor,
        principal: by.principal,
        channel: null,
        thread: null,
        message: null,
        visibility: 2,
        payload: registration,
      },
    ]);
  });
  return registration;
};

export const listWatchersHandler: Handler<typeof listWatchers> = async ({ board, by }) => {
  const all = by[credentialKind] === "local" || allowedEverywhere(by[callerCan] ?? {}, "manage");
  return { watchers: await board.watcherRegistrations(all ? null : by.actor) };
};

type Failure = Pick<WatchFailed, "channel" | "thread" | "payload">;

function appendFailure(writer: BoardWriter, by: BoardContext["by"], at: number, failure: Failure) {
  return writer.append([
    {
      ...failure,
      id: writer.head + 1,
      type: "watch.failed",
      at,
      actor: by.actor,
      principal: by.principal,
      message: null,
      visibility: 0,
    },
  ]);
}

async function leaseMatches(ctx: BoardContext, limit: number, refresh: boolean) {
  const { board, now, randomBytes } = ctx;
  const by = refresh ? await ctx.reauthorize() : ctx.by;
  const revealMentions = canListMentionActors(by);
  return board.write(async (writer) => {
    const failures: Failure[] = [];
    const at = now();
    const matches = await writer.pullWatcherMatches({
      owner: by.actor,
      now: at,
      onFailure: (failure) => {
        failures.push(failure);
      },
      limit,
      mintLease: () => Buffer.from(randomBytes(24)).toString("base64url"),
      canRead: (channel) => canReadChannel(by, channel),
      canReadActorDirectory: revealMentions,
    });
    const [failure] = failures;
    if (failure) await appendFailure(writer, by, at, failure);
    const events = matches.map(({ event, ...match }) => {
      const [view] = projectEvent(event, revealMentions, false);
      if (!view) throw new Error("a watcher matched an event outside the feed");
      return { ...match, thread: formatId(event.thread), event: view };
    });
    return { head: writer.head, cursor: writer.head, events };
  });
}

export const pullWatcherMatchesHandler: Handler<typeof pullWatcherMatches> = async (ctx, { limit = 10, wait = 0 }) => {
  requireUnnarrowedCaller(ctx.by);
  ctx.debitWrite();
  const read = () => leaseMatches(ctx, limit, wait > 0);
  if (!wait) return { matches: (await read()).events };
  const signal = AbortSignal.any([ctx.signal, ctx.shutdown]);
  return withLiveWait(ctx.rateLimits, ctx.board, undefined, async (tail) => {
    const page = await longPoll(tail, undefined, wait, signal, ctx.schedule, read);
    // A lease can expire during the wait without anyone writing an event.
    if (page?.events.length || signal.aborted) return { matches: page?.events ?? [] };
    return { matches: (await read()).events };
  });
};

export const ackWatcherMatchHandler: Handler<typeof ackWatcherMatch> = async (
  { board, by, debitWrite, now },
  input,
) => {
  requireUnnarrowedCaller(by);
  debitWrite();
  await board.write(async (writer) => {
    const at = now();
    const failure = await writer.ackWatcherMatch({ ...input, owner: by.actor, now: at });
    if (!failure || !canReadChannel(by, failure.channel)) return;
    await appendFailure(writer, by, at, failure);
  });
  return { ok: true };
};
