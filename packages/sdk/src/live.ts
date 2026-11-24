import { BoardError, type InputOf, type OutputOf, readEvents } from "@openboard/contract";
import { answerOf, type ClientOptions, reach, requestOf } from "./client.ts";

/** One event of the board's feed, exactly as `GET /events` serves it. */
export type BoardEvent = OutputOf<typeof readEvents>["events"][number];

/** Where to connect and what to follow: the feed's filters (`channel`, `re`, `by`, ...) and an optional start cursor. */
export type TailOptions = ClientOptions &
  Omit<InputOf<typeof readEvents>, "wait"> & {
    /** Aborting it ends the iteration quietly. */
    readonly signal?: AbortSignal;
    /** Override the pause between reconnect attempts; `attempt` counts failures since the last good connection, from 0. */
    readonly retryDelay?: (signal?: AbortSignal, attempt?: number) => Promise<void>;
  };

const EVENT_STREAM = "text/event-stream";
/** Seconds each long-poll asks the board to wait; the board waits at most 120. */
const LONG_POLL_SECONDS = 30;

type Frame = { readonly id?: string; readonly event?: string; readonly data?: string };

/** A stream that breaks after it opened is as `unreachable` as a board that never answered. */
function broken(error: unknown): never {
  if (error instanceof BoardError) throw error;
  if (!(error instanceof TypeError || (error instanceof Error && "code" in error))) throw error;
  throw new BoardError("unreachable", `the board's event stream broke: ${error.message}`);
}

/** One `board` frame's event; a frame that is not JSON is the board's fault, as in `answerOf`. */
function eventOf(data: string): BoardEvent {
  try {
    return JSON.parse(data) as BoardEvent;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new BoardError("remote_error", "the board sent an event that is not JSON");
  }
}

/** Splits an SSE body into frames (WHATWG "event stream interpretation"); comments and `retry` are dropped. */
async function* framesOf(body: ReadableStream<Uint8Array>): AsyncGenerator<Frame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let frame: { id?: string; event?: string; data?: string[] } = {};
  try {
    while (true) {
      const { value, done } = await reader.read().catch(broken);
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      // A trailing `\r` may be the first half of `\r\n`: hold it until the next chunk.
      const held = buffer.endsWith("\r") ? "\r" : "";
      const lines = buffer.slice(0, buffer.length - held.length).split(/\r\n|\r|\n/);
      buffer = (lines.pop() ?? "") + held;
      for (const line of lines) {
        if (line === "") {
          if (frame.id !== undefined || frame.event !== undefined || frame.data !== undefined) {
            yield { id: frame.id, event: frame.event, data: frame.data?.join("\n") };
          }
          frame = {};
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const raw = colon === -1 ? "" : line.slice(colon + 1);
        const content = raw.startsWith(" ") ? raw.slice(1) : raw;
        if (field === "id") frame.id = content;
        else if (field === "event") frame.event = content;
        else if (field === "data") frame.data = [...(frame.data ?? []), content];
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 10_000;

/**
 * How long to wait before reconnect `attempt`: doubling from 250 ms up to 10 s, with jitter (half to all of it) so
 * many tails waiting out one restart do not reconnect in step.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.min(attempt, 16));
  return Math.round(ceiling * (0.5 + random() / 2));
}

/** Wait while the board restarts, longer after each failed attempt, and wake immediately on cancellation. */
function retryDelay(signal?: AbortSignal, attempt = 0): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, retryDelayMs(attempt));
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/** The caller's filters only: the connection options are not query fields. */
function feedInput(options: TailOptions): Omit<InputOf<typeof readEvents>, "wait"> {
  const {
    url: _url,
    token: _token,
    csrf: _csrf,
    profile: _profile,
    fetch: _fetch,
    signal: _signal,
    retryDelay: _retryDelay,
    ...input
  } = options;
  return input;
}

/**
 * Follows the board's feed from `after` (default: now), yielding each event as it lands.
 * Uses SSE, and long-polls when the board answers with JSON instead of a stream.
 * Reconnects by cursor after a disconnect. Aborting `signal` ends the iteration.
 */
export async function* tail(options: TailOptions): AsyncGenerator<BoardEvent, void, undefined> {
  if (!URL.canParse(options.url)) throw new TypeError(`not a board URL: ${options.url}`);
  const { signal } = options;
  const pause = options.retryDelay ?? retryDelay;
  const base = options.fetch ?? ((request: Request) => fetch(request));
  const send = (request: Request) => base(signal ? new Request(request, { signal }) : request);
  const { after, last, ...filters } = feedInput(options);
  let cursor: string | undefined;
  let connected = false;
  let polling = false;
  let failures = 0;

  while (!signal?.aborted) {
    // Capture the initial position before opening a stream that could break before its first frame.
    const bootstrapping = after === undefined && cursor === undefined;
    const input =
      cursor === undefined ? { ...filters, after, last } : { ...filters, after: polling ? cursor : undefined };
    const request = requestOf(readEvents, { ...input, wait: polling ? LONG_POLL_SECONDS : undefined }, options);
    if (!polling && !bootstrapping) {
      request.headers.set("accept", `${EVENT_STREAM}, application/json`);
      if (cursor !== undefined) request.headers.set("last-event-id", cursor);
    }
    try {
      const response = await reach(send, request);
      if (response.ok && response.headers.get("content-type")?.startsWith(EVENT_STREAM)) {
        connected = true;
        failures = 0;
        if (response.body) {
          for await (const frame of framesOf(response.body)) {
            if (signal?.aborted) return;
            if (frame.event === "board" && frame.data !== undefined) {
              const event = eventOf(frame.data);
              cursor = frame.id || event.cursor;
              yield event;
            } else if (frame.id) cursor = frame.id;
          }
        }
      } else {
        const page = (await answerOf(response).catch(broken)) as OutputOf<typeof readEvents>;
        const resumingSse = !polling && cursor !== undefined;
        connected = true;
        failures = 0;
        polling = !bootstrapping;
        // The JSON route ignores Last-Event-ID. Request the page again with `after`.
        if (resumingSse) continue;
        for (const event of page.events) {
          if (signal?.aborted) return;
          yield event;
        }
        cursor = page.cursor;
        continue;
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (!connected || !(error instanceof BoardError) || !["unreachable", "unavailable"].includes(error.code)) {
        throw error;
      }
    }
    if (!signal?.aborted) await pause(signal, failures++);
  }
}
