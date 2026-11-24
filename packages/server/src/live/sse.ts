import { formatId } from "@openboard/core";
import type { OutputOf, readEvents } from "@openboard/contract";

type Page = { readonly cursor: number; readonly events: OutputOf<typeof readEvents>["events"] };

function pageFrames(page: Page): string {
  const events = page.events.map((event) => `id: ${event.cursor}\nevent: board\ndata: ${JSON.stringify(event)}\n\n`);
  const cursor = formatId(page.cursor);
  if (page.events.at(-1)?.cursor !== cursor) events.push(`id: ${cursor}\n\n`);
  return events.join("");
}

/** Keep at most one page queued. A disconnect wakes and unsubscribes any pending read. */
export function eventStream(
  first: Page,
  requestSignal: AbortSignal,
  read: (after: number, signal: AbortSignal) => Promise<Page>,
): Response {
  const abort = new AbortController();
  const signal = AbortSignal.any([requestSignal, abort.signal]);
  const encoder = new TextEncoder();
  let cursor = first.cursor;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      controller.enqueue(encoder.encode(pageFrames(first)));
    },
    async pull(controller) {
      if (signal.aborted) {
        controller.close();
        return;
      }
      const page = await read(cursor, signal);
      if (signal.aborted) {
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
