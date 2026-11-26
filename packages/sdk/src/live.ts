import { BoardError, type InputOf, type OutputOf, readEvents } from "@openboard/contract";
import { answerOf, type ClientOptions, reach, requestOf, ResponseError } from "./client.ts";

/** One event of the board's feed, exactly as `GET /events` serves it. */
export type BoardEvent = OutputOf<typeof readEvents>["events"][number];

/** Where to connect and what to follow: the feed's filters (`channel`, `re`, `by`, ...) and an optional start cursor. */
export type TailOptions = ClientOptions &
  Omit<InputOf<typeof readEvents>, "wait"> & {
    /** Aborting it ends the iteration quietly. */
    readonly signal?: AbortSignal;
    /** Override the reconnect pause. Attempts count from 0 since progress or a sustained connection. */
    readonly retryDelay?: (signal?: AbortSignal, attempt?: number, retryAfterMs?: number) => Promise<void>;
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

// Limits are measured in decoded UTF-16 code units, including ignored fields and comments.
const MAX_LINE_LENGTH = 2 * 1024 * 1024;
const MAX_FRAME_LENGTH = 2 * MAX_LINE_LENGTH;

class EventStreamLimitError extends BoardError {
  constructor(limit: "line" | "frame") {
    super("remote_error", `the board sent an oversized event stream ${limit}`);
  }
}

function* linesIn(chunk: string, pending: { parts: string[]; length: number; skipLf: boolean }): Generator<string> {
  if (chunk.length === 0) return;
  let start = pending.skipLf && chunk.startsWith("\n") ? 1 : 0;
  pending.skipLf = false;
  const endings = /\r\n?|\n/g;
  endings.lastIndex = start;
  for (let ending = endings.exec(chunk); ending; ending = endings.exec(chunk)) {
    appendLinePart(pending, chunk.slice(start, ending.index));
    const line = pending.parts.join("");
    pending.parts.length = 0;
    pending.length = 0;
    start = endings.lastIndex;
    pending.skipLf = ending[0] === "\r" && start === chunk.length;
    yield line;
  }
  appendLinePart(pending, chunk.slice(start));
}

function appendLinePart(pending: { parts: string[]; length: number }, part: string): void {
  pending.length += part.length;
  if (pending.length > MAX_LINE_LENGTH) {
    throw new EventStreamLimitError("line");
  }
  if (part) pending.parts.push(part);
}

function readField(frame: { id?: string; event?: string; data?: string[] }, line: string): void {
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  const raw = colon === -1 ? "" : line.slice(colon + 1);
  const content = raw.startsWith(" ") ? raw.slice(1) : raw;
  if (field === "id" && !content.includes("\0")) frame.id = content;
  else if (field === "event") frame.event = content;
  else if (field === "data") {
    frame.data ??= [];
    frame.data.push(content);
  }
}

/** Splits an SSE body into frames; an incomplete frame at EOF is discarded. */
async function* framesOf(body: ReadableStream<Uint8Array>): AsyncGenerator<Frame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const pending = { parts: [] as string[], length: 0, skipLf: false };
  let frame: { id?: string; event?: string; data?: string[] } = {};
  let frameLength = 0;
  try {
    while (true) {
      const { value, done } = await reader.read().catch(broken);
      for (const line of linesIn(decoder.decode(value, { stream: !done }), pending)) {
        if (line === "") {
          if (frame.id !== undefined || frame.event !== undefined || frame.data !== undefined) {
            yield { id: frame.id, event: frame.event, data: frame.data?.join("\n") };
          }
          frame = {};
          frameLength = 0;
          continue;
        }
        frameLength += line.length + 1;
        if (frameLength > MAX_FRAME_LENGTH) {
          throw new EventStreamLimitError("frame");
        }
        if (!line.startsWith(":")) readField(frame, line);
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 10_000;
const SUSTAINED_CONNECTION_MS = 30_000;

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  if (Number.isNaN(delay)) return undefined;
  return Math.max(0, Math.min(RETRY_MAX_MS, delay));
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof BoardError)) return false;
  if (error.status === 401 || error.status === 403 || error.code === "invalid_cursor") return false;
  return (
    error.code === "unreachable" ||
    error.code === "unavailable" ||
    (error instanceof ResponseError && [502, 503, 504].includes(error.status))
  );
}

/**
 * How long to wait before reconnect `attempt`: doubling from 250 ms up to 10 s, with jitter (half to all of it) so
 * many tails waiting out one restart do not reconnect in step.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.min(attempt, 16));
  return Math.round(ceiling * (0.5 + random() / 2));
}

/** Wait while the board restarts, longer after each failed attempt, and wake immediately on cancellation. */
function retryDelay(signal?: AbortSignal, attempt = 0, retryAfter = 0): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(retryDelayMs(attempt), retryAfter));
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
    let openedAt: number | undefined;
    let retryAfter: number | undefined;
    try {
      const response = await reach(send, request);
      if (response.ok && response.headers.get("content-type")?.startsWith(EVENT_STREAM)) {
        connected = true;
        openedAt = performance.now();
        if (response.body) {
          for await (const frame of framesOf(response.body)) {
            if (signal?.aborted) return;
            const event = frame.event === "board" && frame.data !== undefined ? eventOf(frame.data) : undefined;
            const checkpoint = frame.id || (event === undefined ? undefined : event.cursor);
            if (checkpoint) {
              if (checkpoint !== (cursor ?? after)) failures = 0;
              cursor = checkpoint;
            }
            if (event !== undefined) yield event;
          }
        }
      } else {
        if (!response.ok) retryAfter = retryAfterMs(response.headers.get("retry-after"));
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
      if (error instanceof EventStreamLimitError && !polling) {
        polling = true;
        continue;
      }
      if (!connected || !isTransient(error)) throw error;
    }
    if (openedAt !== undefined && performance.now() - openedAt >= SUSTAINED_CONNECTION_MS) failures = 0;
    if (!signal?.aborted) {
      if (retryAfter === undefined) await pause(signal, failures++);
      else await pause(signal, failures++, retryAfter);
    }
  }
}
