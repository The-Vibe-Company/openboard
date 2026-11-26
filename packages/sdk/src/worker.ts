import { BoardError } from "@openboard/contract";
import type { Client } from "./client.ts";
import { isTransient } from "./live.ts";

type ClaimInput = Parameters<Client["claimNextTask"]>[0];
type ClaimedTask = Extract<Awaited<ReturnType<Client["claimNextTask"]>>, { claim: object }>;
type ErrorInfo = { phase: "claim" | "renew" | "handle" | "complete" | "fail"; taskId?: string };

export type WorkerOptions = Readonly<
  Pick<ClaimInput, "channel" | "lease" | "wait" | "label" | "from"> & {
    /** Alias for the queue's label filter. If both are set, label takes precedence. */
    labels?: ClaimInput["label"];
    concurrency?: number;
    signal?: AbortSignal;
    onError?: (error: unknown, info: ErrorInfo) => void;
    /** Maximum successful claims across all handlers, including tasks that fail or are released. */
    maxTasks?: number;
    backoffMs?: { readonly initial?: number; readonly max?: number };
    renewIntervalMs?: number;
    /** Override the one-shot timer. Return a function that cancels it. */
    schedule?: (callback: () => void, delayMs: number) => () => void;
    random?: () => number;
  }
>;

/** A successful handler may complete with or without result text. */
// biome-ignore lint/suspicious/noConfusingVoidType: Handlers may return void, including after explicit settlement.
export type WorkerResult = string | { readonly result?: string } | void;

export interface WorkerContext {
  readonly task: ClaimedTask["task"];
  readonly claimToken: string;
  readonly signal: AbortSignal;
  readonly renew: () => Promise<void>;
  readonly reply: (text: string) => ReturnType<Client["postMessage"]>;
  readonly complete: (result?: string) => Promise<void>;
  readonly fail: (reason: string) => Promise<void>;
}

/** Counts of acknowledged operations across all handlers. */
export interface WorkerStats {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
  readonly released: number;
}

type Handler = (context: WorkerContext) => WorkerResult | Promise<WorkerResult>;
type Counters = { -readonly [Key in keyof WorkerStats]: WorkerStats[Key] };

function scheduleTimer(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

function pause(schedule: NonNullable<WorkerOptions["schedule"]>, delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      cancel();
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const cancel = schedule(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, Math.floor(value)));
}

async function renewWhileActive(
  renew: WorkerContext["renew"],
  interval: number,
  schedule: NonNullable<WorkerOptions["schedule"]>,
  signal: AbortSignal,
): Promise<void> {
  let delay = interval;
  while (!signal.aborted) {
    await pause(schedule, delay, signal);
    if (!signal.aborted) {
      delay = await renew().then(
        () => interval,
        () => Math.min(interval, 1000),
      );
    }
  }
}

function reasonOf(error: unknown): string {
  try {
    const message = (error instanceof Error ? error.message : String(error)).replaceAll("\0", "").toWellFormed();
    if (message.trim()) return Array.from(message.trim()).slice(0, 1000).join("");
  } catch {
    // A thrown value can also fail string conversion.
  }
  return "handler failed";
}

function taskRenewal(
  client: Client,
  input: Parameters<Client["renewTask"]>[0],
  signal: AbortSignal,
  lost: AbortController,
  report: (error: unknown) => void,
  schedule: NonNullable<WorkerOptions["schedule"]>,
  until: string,
) {
  let cancelExpiry: (() => void) | undefined;
  const expire = () => {
    const error = new BoardError("claim_lost", "the task lease expired before renewal was acknowledged");
    lost.abort(error);
    report(error);
  };
  const watchExpiry = (deadline: string) => {
    cancelExpiry?.();
    if (signal.aborted) return;
    const delay = bounded(Date.parse(deadline) - Date.now(), 0, 0, 2 ** 31 - 1);
    if (delay === 0) expire();
    else cancelExpiry = schedule(expire, delay);
  };
  watchExpiry(until);
  signal.addEventListener("abort", () => cancelExpiry?.(), { once: true });
  let pending: Promise<void> | undefined;
  return {
    pending: () => pending,
    renew(): Promise<void> {
      if (signal.aborted) return Promise.reject(signal.reason);
      pending ??= client
        .renewTask(input, { signal })
        .then(({ until }) => watchExpiry(until))
        .catch((error: unknown) => {
          if (signal.aborted) throw error;
          if (
            error instanceof BoardError &&
            (error.status === 401 ||
              ["claim_lost", "unauthorized", "not_a_task", "message_not_found"].includes(error.code))
          ) {
            lost.abort(error);
          }
          report(error);
          throw error;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}

async function releaseClaim(
  client: Client,
  credentials: Parameters<Client["releaseTask"]>[0],
  schedule: NonNullable<WorkerOptions["schedule"]>,
): Promise<boolean> {
  const release = new AbortController();
  const cancel = schedule(() => release.abort(), 5000);
  try {
    await client.releaseTask(credentials, { signal: release.signal });
    return true;
  } catch {
    return false;
  } finally {
    cancel();
  }
}

async function handleClaim(
  client: Client,
  options: WorkerOptions,
  handler: Handler,
  { task, claim }: ClaimedTask,
  lease: number,
  stats: Counters,
  shutdown: AbortSignal,
): Promise<void> {
  const lost = new AbortController();
  const stopRenewing = new AbortController();
  const signal = AbortSignal.any([shutdown, lost.signal]);
  const renewalSignal = AbortSignal.any([signal, stopRenewing.signal]);
  const credentials = { id: task.id, epoch: claim.epoch, token: claim.token };
  const report = (error: unknown, phase: ErrorInfo["phase"]) => options.onError?.(error, { phase, taskId: task.id });
  const schedule = options.schedule ?? scheduleTimer;
  const renewal = taskRenewal(
    client,
    { ...credentials, lease },
    renewalSignal,
    lost,
    (error) => report(error, "renew"),
    schedule,
    claim.until,
  );
  let settlement: Promise<void> | undefined;
  let settled = false;
  let settlementError: unknown;
  const settle = (phase: "complete" | "fail", write: () => Promise<unknown>): Promise<void> => {
    if (settlement) return settlement;
    if (signal.aborted) return Promise.reject(signal.reason);
    settlement = Promise.allSettled([renewal.pending()])
      .then(() => {
        signal.throwIfAborted();
        return write();
      })
      .then(
        () => {
          settled = true;
          stopRenewing.abort();
          if (phase === "complete") stats.completed++;
          else stats.failed++;
        },
        (error: unknown) => {
          settlementError = error;
          if (error instanceof BoardError && error.status === 400) settlement = undefined;
          if (!signal.aborted) report(error, phase);
          throw error;
        },
      );
    void settlement.catch(() => {});
    return settlement;
  };
  const context: WorkerContext = {
    task,
    claimToken: claim.token,
    signal,
    renew: () => settlement ?? renewal.renew(),
    reply: (text) => client.postMessage({ re: task.id, text }, { signal }),
    complete: (result) => settle("complete", () => client.completeTask({ ...credentials, result }, { signal })),
    fail: (reason) => settle("fail", () => client.failTask({ ...credentials, reason }, { signal })),
  };
  const interval = bounded(options.renewIntervalMs, Math.max(1000, Math.floor((lease * 1000) / 2)), 1, 2 ** 31 - 1);
  const renewing = renewWhileActive(context.renew, interval, schedule, renewalSignal);
  try {
    if (signal.aborted) return;
    const reportHandle = (error: unknown) => {
      if (settlementError !== error) report(error, "handle");
    };
    await handleResult(context, handler, () => settlement !== undefined, reportHandle);
  } finally {
    if (settlement) await settlement.catch(() => {});
    stopRenewing.abort();
    await Promise.allSettled([renewing, renewal.pending()]);
    if (shutdown.aborted && !settled && !lost.signal.aborted) {
      if (await releaseClaim(client, credentials, schedule)) stats.released++;
    }
  }
}

async function handleResult(
  context: WorkerContext,
  handler: Handler,
  settling: () => boolean,
  report: (error: unknown) => void,
): Promise<void> {
  let result: WorkerResult;
  try {
    result = await handler(context);
  } catch (error) {
    if (context.signal.aborted) return;
    report(error);
    if (!settling()) await context.fail(reasonOf(error)).catch(() => {});
    return;
  }
  if (!context.signal.aborted && !settling()) {
    await context.complete(typeof result === "string" ? result : result?.result).catch(() => {});
  }
}

/**
 * Long-polls for work and drains active handlers on shutdown. Handlers should stop when their signal aborts.
 * A permanent claim error stops the worker and is thrown after draining.
 */
export async function runWorker(client: Client, options: WorkerOptions, handler: Handler): Promise<WorkerStats> {
  const { channel, lease = 300, wait = 25, label = options.labels, from } = options;
  const stats: Counters = { claimed: 0, completed: 0, failed: 0, released: 0 };
  const limit = bounded(options.maxTasks, Infinity, 0, Number.MAX_SAFE_INTEGER);
  const concurrency = bounded(options.concurrency, 1, 1, 2 ** 31 - 1);
  const maxDelay = bounded(options.backoffMs?.max, 10_000, 1, 2 ** 31 - 1);
  const initialDelay = bounded(options.backoffMs?.initial, Math.min(250, maxDelay), 1, maxDelay);
  const schedule = options.schedule ?? scheduleTimer;
  const random = options.random ?? Math.random;
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([stop.signal, options.signal]) : stop.signal;
  let pending = 0;

  const claim = async () => {
    pending++;
    try {
      const answer = await client.claimNextTask({ channel, lease, wait, label, from }, { signal });
      if ("claim" in answer) {
        stats.claimed++;
        return answer;
      }
    } finally {
      pending--;
    }
  };

  const loop = async () => {
    let retry = initialDelay;
    while (!signal.aborted && stats.claimed + pending < limit) {
      let answer: ClaimedTask | undefined;
      try {
        answer = await claim();
      } catch (error) {
        if (signal.aborted) return;
        options.onError?.(error, { phase: "claim" });
        if (!isTransient(error) && !(error instanceof BoardError && error.code === "rate_limited")) throw error;
        await pause(schedule, Math.round(retry * (0.5 + random() / 2)), signal);
        retry = Math.min(maxDelay, retry * 2);
        continue;
      }
      retry = initialDelay;
      if (answer) await handleClaim(client, options, handler, answer, lease, stats, signal);
      else await pause(schedule, Math.min(initialDelay, 250), signal);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, limit) }, async () => {
      try {
        await loop();
      } catch (error) {
        if (!stop.signal.aborted) stop.abort(error);
      }
    }),
  );
  stop.signal.throwIfAborted();
  return stats;
}
