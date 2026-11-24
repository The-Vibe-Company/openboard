import { BoardError, type InputOf, type OutputOf, readEvents } from "@openboard/contract";
import { answerOf, type ClientOptions, reach, requestOf } from "./client.ts";

/** One event of the board's feed, exactly as `GET /events` serves it. */
export type BoardEvent = OutputOf<typeof readEvents>["events"][number];

/** Where to connect and what to follow: the feed's filters (`channel`, `re`, `by`, ...) and an optional start cursor. */
export type TailOptions = ClientOptions &
  Omit<InputOf<typeof readEvents>, "wait"> & {
    /** Aborting it ends the iteration quietly. */
    readonly signal?: AbortSignal;
  };

const EVENT_STREAM = "text/event-stream";
/** Seconds each long-poll asks the board to wait; the board waits at most 120. */
const LONG_POLL_SECONDS = 30;

type Frame = { readonly id?: string; readonly event?: string; readonly data?: string };

/** A stream that breaks after it opened is as `unreachable` as a board that never answered. */
function broken(error: unknown): never {
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
  }
}

/** Events of an open SSE response, in order. */
async function* streamed(response: Response): AsyncGenerator<BoardEvent> {
  if (!response.body) return;
  for await (const frame of framesOf(response.body)) {
    if (frame.event === "board" && frame.data !== undefined) yield eventOf(frame.data);
  }
}

/** Long-polls `GET /events` from a first JSON page, carrying the cursor from page to page. */
async function* polled(
  first: OutputOf<typeof readEvents>,
  input: Omit<InputOf<typeof readEvents>, "wait">,
  options: TailOptions,
  send: (request: Request) => Promise<Response>,
): AsyncGenerator<BoardEvent> {
  let page = first;
  while (true) {
    yield* page.events;
    if (options.signal?.aborted) return;
    const next = { ...input, last: undefined, after: page.cursor, wait: LONG_POLL_SECONDS };
    page = (await answerOf(await reach(send, requestOf(readEvents, next, options)))) as OutputOf<typeof readEvents>;
  }
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
    ...input
  } = options;
  return input;
}

/**
 * Follows the board's feed from `after` (default: now), yielding each event as it lands.
 * Uses SSE, and long-polls when the board answers with JSON instead of a stream.
 * It ends when the stream ends or `signal` aborts; reconnecting is not done here.
 */
export async function* tail(options: TailOptions): AsyncGenerator<BoardEvent, void, undefined> {
  if (!URL.canParse(options.url)) throw new TypeError(`not a board URL: ${options.url}`);
  const { signal } = options;
  const base = options.fetch ?? ((request: Request) => fetch(request));
  const send = (request: Request) => base(signal ? new Request(request, { signal }) : request);
  const input = feedInput(options);
  const request = requestOf(readEvents, input, options);
  request.headers.set("accept", `${EVENT_STREAM}, application/json`);
  try {
    const response = await reach(send, request);
    if (response.ok && response.headers.get("content-type")?.startsWith(EVENT_STREAM)) {
      yield* streamed(response);
    } else {
      yield* polled((await answerOf(response)) as OutputOf<typeof readEvents>, input, options, send);
    }
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  }
}
