import { setTimeout as delay } from "node:timers/promises";
import { BoardError, createClient, type TailOptions, tail } from "../../packages/sdk/src/index.ts";

const channel = "rolling-check";
const cadence = 100;
const checkpointTimeout = 15_000;
const settleTime = 2_000;

type Fetch = (request: Request) => Promise<Response>;
type Runtime = {
  fetch: Fetch;
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  retryDelay?: TailOptions["retryDelay"];
};
const runtime: Runtime = {
  fetch: (request) => fetch(request),
  now: () => performance.now(),
  sleep: (ms, signal) => delay(ms, undefined, { signal }),
};

function deliveryProblems(posted: number, received: readonly number[]): string[] {
  const counts = new Map<number, number>();
  const unordered = new Set<number>();
  let highest = 0;
  for (const number of received) {
    counts.set(number, (counts.get(number) ?? 0) + 1);
    if (number < highest) unordered.add(number);
    highest = Math.max(highest, number);
  }
  let lowest = Infinity;
  for (const number of received.toReversed()) {
    if (number > lowest) unordered.add(number);
    lowest = Math.min(lowest, number);
  }
  const problems: string[] = [];
  for (let number = 1; number <= posted; number++) {
    const count = counts.get(number) ?? 0;
    if (!count) problems.push(`missing ${number}`);
    if (count > 1) problems.push(`repeated ${number} (${count} deliveries)`);
    if (unordered.has(number)) problems.push(`out-of-order ${number}`);
  }
  return problems;
}

function errorCode(error: unknown): string {
  if (error instanceof BoardError) return error.code;
  if (error instanceof TypeError || (error instanceof Error && "code" in error)) return "unreachable";
  return "unexpected error";
}

function watch(
  url: string,
  token: string,
  prefix: string,
  request: Fetch,
  signal: AbortSignal,
  retryDelay?: TailOptions["retryDelay"],
) {
  const opened = Promise.withResolvers<void>();
  const resumed = Promise.withResolvers<void>();
  const drained = Promise.withResolvers<void>();
  const received: number[] = [];
  let expectResume = false;
  const done = (async () => {
    for await (const event of tail({
      url,
      token,
      channel,
      signal,
      retryDelay,
      fetch: async (input) => {
        const response = await request(input);
        if (input.headers.get("accept")?.includes("text/event-stream") && response.ok) {
          if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
            await response.body?.cancel();
            throw new BoardError("remote_error", "SSE required for rolling check");
          }
          if (expectResume && input.headers.has("last-event-id")) resumed.resolve();
          opened.resolve();
        }
        return response;
      },
    })) {
      if (event.type !== "message.posted" || !event.payload.text.startsWith(prefix)) continue;
      const value = event.payload.text.slice(prefix.length);
      if (value === "end") drained.resolve();
      else if (/^[1-9][0-9]*$/.test(value)) received.push(Number(value));
    }
    return "tail closed";
  })().catch((error) => `tail failed (${errorCode(error)})`);
  return {
    opened: opened.promise,
    resumed: resumed.promise,
    drained: drained.promise,
    received,
    done,
    expectResume: () => {
      expectResume = true;
    },
  };
}

async function checkpoint(
  reached: Promise<void>,
  tailDone: Promise<string>,
  description: string,
  timeout?: number,
): Promise<void> {
  const timer = new AbortController();
  try {
    const result = await Promise.race([
      reached,
      tailDone,
      ...(timeout === undefined ? [] : [delay(timeout, description, { signal: timer.signal })]),
    ]);
    if (result !== undefined) throw new Error(result);
  } finally {
    timer.abort();
  }
}

function postTo(url: string, token: string, prefix: string, request: Fetch, pause: () => Promise<void>) {
  const client = createClient({ url, token, fetch: request });
  return async (number: number | "end") => {
    const text = `${prefix}${number}`;
    for (let attempt = 1; ; attempt++) {
      try {
        await client.postMessage({ channel, text, id: text, noSync: true }, { signal: AbortSignal.timeout(5_000) });
        return;
      } catch (error) {
        const code = errorCode(error);
        if (attempt === 3 || (code !== "unreachable" && code !== "unavailable")) {
          throw new Error(`post ${number} failed (${code})`);
        }
        await pause();
      }
    }
  };
}

async function postDuring(
  post: (number: number) => Promise<void>,
  stop: AbortSignal,
  deps: Runtime,
  started: number,
): Promise<void> {
  for (let number = 2; !stop.aborted; number++) {
    await deps.sleep(Math.max(0, cadence - (deps.now() - started)), stop).catch((error) => {
      if (!stop.aborted) throw error;
    });
    if (stop.aborted) return;
    started = deps.now();
    await post(number);
  }
}

/** Start the deployment only after the tail is open and the first write has succeeded. */
export async function rollingCheck(
  url: string,
  token: string,
  deploy: () => Promise<void>,
  deps: Runtime = runtime,
): Promise<number> {
  const prefix = `rolling-check ${crypto.randomUUID()} `;
  const request: Fetch = async (input) => {
    const response = await deps.fetch(new Request(input, { redirect: "error" }));
    if ([502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      throw new BoardError("unavailable", "Board or proxy temporarily unavailable");
    }
    return response;
  };
  const close = new AbortController();
  const stop = new AbortController();
  const feed = watch(url, token, prefix, request, close.signal, deps.retryDelay);
  const post = postTo(url, token, prefix, request, () => deps.sleep(cadence, close.signal));
  let posted = 0;
  let failure: string | undefined;
  try {
    await checkpoint(feed.opened, feed.done, "timed out opening SSE tail", checkpointTimeout);
    const started = deps.now();
    await post(1);
    posted = 1;
    feed.expectResume();
    const deployment = Promise.resolve()
      .then(deploy)
      .finally(() => stop.abort());
    const traffic = postDuring(
      async (number) => {
        await post(number);
        posted++;
      },
      stop.signal,
      deps,
      started,
    );
    void feed.done.then(() => stop.abort());
    const outcomes = await Promise.allSettled([deployment, traffic]);
    const errors = outcomes.flatMap((result) => (result.status === "rejected" ? [String(result.reason)] : []));
    failure = errors.length ? errors.join("; ") : undefined;
    if (!failure)
      await checkpoint(feed.resumed, feed.done, "timed out waiting for SSE cursor resume", checkpointTimeout);
    await post("end");
    await checkpoint(feed.drained, feed.done, "timed out waiting for end marker", checkpointTimeout);
    await checkpoint(deps.sleep(settleTime, close.signal), feed.done, "tail closed after end marker");
  } catch (error) {
    failure = [failure, error instanceof Error ? error.message : "check failed"].filter(Boolean).join("; ");
  } finally {
    close.abort();
    await feed.done;
  }
  const problems = deliveryProblems(posted, feed.received);
  if (failure) problems.unshift(failure);
  if (problems.length) throw new Error(problems.join("; "));
  return posted;
}

export function reportRollingCheck(posted: number): void {
  console.log(`Posted ${posted} numbered messages; each arrived once, in order.`);
}

export async function readRollingSecret(): Promise<string> {
  const token = process.stdin.isTTY ? "" : (await Bun.stdin.text()).trim();
  if (!token) throw new Error("Provide the board connection secret on stdin");
  return token;
}

async function manualCheck(args: string[]): Promise<void> {
  const [flag, url] = args;
  if (args.length !== 2 || flag !== "--url" || !url || !URL.canParse(url))
    throw new Error("Usage: bun scripts/release/rolling-check.ts --url <board-url> < secret-file");
  const target = new URL(url);
  if (target.protocol !== "https:" && !(target.protocol === "http:" && target.hostname === "127.0.0.1"))
    throw new Error("Use an HTTPS board URL or HTTP on 127.0.0.1");

  const token = await readRollingSecret();
  const finished = Promise.withResolvers<void>();
  const finish = () => finished.resolve();
  process.on("SIGINT", finish);
  process.on("SIGTERM", finish);
  const timeout = setTimeout(() => finished.reject(new Error("timed out waiting for deploy completion")), 360_000);
  void finished.promise.catch(() => {});
  try {
    reportRollingCheck(
      await rollingCheck(url, token, () => {
        console.log("SSE tail open. Send SIGINT or SIGTERM after the deploy finishes.");
        return finished.promise;
      }),
    );
  } finally {
    clearTimeout(timeout);
    process.off("SIGINT", finish);
    process.off("SIGTERM", finish);
  }
}

if (import.meta.main) {
  try {
    await manualCheck(process.argv.slice(2));
  } catch (error) {
    console.error(`error: rolling_check_failed: ${error instanceof Error ? error.message : "Rolling check failed"}`);
    process.exitCode = 1;
  }
}
