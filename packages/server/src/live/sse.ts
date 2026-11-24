import { formatId } from "@openboard/core";
import type { OutputOf, readEvents } from "@openboard/contract";
import type { Deps } from "../deps.ts";

/** Upstream pings a quiet stream every 15 s so proxies do not cut it for idleness (`03-http.md`, "SSE"). */
export const PING_INTERVAL_MS = 15_000;

/** Upstream closes a stream after about 280 s, before the platform's time limit; the client resumes from its last `id:`. */
export const STREAM_MAX_MS = 280_000;

type Page = { readonly cursor: number; readonly events: OutputOf<typeof readEvents>["events"] };

function pageFrames(page: Page): string {
  const events = page.events.map((event) => `id: ${event.cursor}\nevent: board\ndata: ${JSON.stringify(event)}\n\n`);
  const cursor = formatId(page.cursor);
  if (page.events.at(-1)?.cursor !== cursor) events.push(`id: ${cursor}\n\n`);
  return events.join("");
}

/**
 * Keep at most one page queued. A disconnect wakes any pending read, stops the timers and calls `close`. A ping is
 * skipped while a frame is still queued: the client has unread bytes, so the connection is not idle. At the deadline
 * the stream ends cleanly: a page read after it is dropped unsent, so the client's last `id:` misses nothing. A read
 * that resolves no page was stopped, and ends the stream the same way.
 */
export function eventStream(
  first: Page,
  requestSignal: AbortSignal,
  schedule: Deps["schedule"],
  read: (after: number, signal: AbortSignal) => Promise<Page | undefined>,
  close: () => void,
): Response {
  const abort = new AbortController();
  const deadline = new AbortController();
  const signal = AbortSignal.any([requestSignal, abort.signal, deadline.signal]);
  const encoder = new TextEncoder();
  let cursor = first.cursor;
  let cancelPing = () => {};
  let cancelDeadline = () => {};
  const stop = () => {
    cancelPing();
    cancelDeadline();
    close();
  };
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      controller.enqueue(encoder.encode(pageFrames(first)));
      const ping = () => {
        if (signal.aborted) return;
        if ((controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(": ping\n\n"));
        cancelPing = schedule(PING_INTERVAL_MS, ping);
      };
      if (signal.aborted) return;
      cancelPing = schedule(PING_INTERVAL_MS, ping);
      cancelDeadline = schedule(STREAM_MAX_MS, () => deadline.abort());
    },
    async pull(controller) {
      if (signal.aborted) {
        controller.close();
        return;
      }
      // A failed read errors the stream without calling `cancel`: abort so the pings stop with it.
      const page = await read(cursor, signal).catch((error: unknown) => {
        abort.abort();
        throw error;
      });
      if (signal.aborted || page === undefined) {
        if (!abort.signal.aborted) controller.close();
        return;
      }
      cursor = page.cursor;
      controller.enqueue(encoder.encode(pageFrames(page)));
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      vary: "Accept",
    },
  });
}
