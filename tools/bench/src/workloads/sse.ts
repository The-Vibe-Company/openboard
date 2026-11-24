import type { createConnection, OutputOf } from "@openboard/contract";
import type { Server } from "../drivers";
import { type Board, percentile, send } from "./request";

const CHANNEL = "bench-sse";
const TAILS = 50;
const TAILS_PER_READER = 20;
const EVENTS = 1_000;

export interface SseResult {
  readonly tails: number;
  readonly events: number;
  readonly p50: number;
  readonly p99: number;
}

type Tail = Awaited<ReturnType<typeof openTail>>;

async function openTail(instance: Server["instances"][number], board: Board, after: string, signal: AbortSignal) {
  const query = new URLSearchParams({ after });
  const response = await instance.app.fetch(
    new Request(`${board.url}/events?${query}`, {
      headers: { accept: "text/event-stream", authorization: `Bearer ${board.token}` },
      signal,
    }),
  );
  if (response.status !== 200 || response.headers.get("content-type") !== "text/event-stream" || !response.body) {
    await response.body?.cancel();
    throw new Error(`opening bench SSE tail: expected an event stream, got HTTP ${response.status}`);
  }
  return response.body.getReader();
}

async function readEvent(tail: Tail, decoder: TextDecoder): Promise<string> {
  while (true) {
    const { value, done } = await tail.read();
    if (done) throw new Error("bench SSE tail closed before delivering all events");
    // The in-process stream enqueues whole pages. Each measured post is the only event in flight.
    const frames = [...decoder.decode(value).matchAll(/^id: (\d+)\nevent: board\ndata: (.+)\n\n/gm)];
    if (frames.length === 0) continue; // Connection comment or cursor-only page.
    const [frame] = frames;
    if (frames.length !== 1 || frame?.[1] === undefined || frame[2] === undefined)
      throw new Error("bench SSE tail received multiple events for one post");
    const [, id, data] = frame;
    const event = JSON.parse(data) as { cursor?: string; type?: string };
    if (event.type !== "message.posted" || event.cursor !== id)
      throw new Error("bench SSE tail received an invalid post event");
    return id;
  }
}

/** Measure each post through the last of the local tails, including in-process write and stream delivery. */
export async function runSseWorkload(server: Server): Promise<SseResult> {
  const [instance] = server.instances;
  if (!instance) throw new Error("no instance to run the SSE workload on");

  const post = async (text: string) => {
    const { body } = await send(instance, server.board, {
      method: "POST",
      path: "/messages",
      expected: 201,
      body: { channel: CHANNEL, text },
    });
    return (body as { message: { id: string } }).message.id;
  };

  // Keep all 50 tails on one instance while staying within the 20-per-principal cap.
  const readers = [server.board];
  for (const name of ["bench-reader-one", "bench-reader-two"]) {
    const { body } = await send(instance, server.board, {
      method: "POST",
      path: "/x/connections",
      expected: 201,
      body: { name, direct: true, can: { "*": ["read"] } },
    });
    readers.push({ ...server.board, token: (body as OutputOf<typeof createConnection>).secret });
  }
  const cursor = await post("warm-up");
  const tails: Tail[] = [];
  const signal = AbortSignal.timeout(30_000);
  const decoder = new TextDecoder();
  const times: number[] = [];
  try {
    for (const reader of readers) {
      const target = Math.min(tails.length + TAILS_PER_READER, TAILS);
      while (tails.length < target) tails.push(await openTail(instance, reader, cursor, signal));
    }

    for (let i = 0; i < EVENTS; i++) {
      const started = performance.now();
      const [expected, ...received] = await Promise.all([
        post(`SSE event ${i + 1}`),
        ...tails.map((tail) => readEvent(tail, decoder)),
      ]);
      times.push(performance.now() - started);
      if (received.some((id) => id !== expected)) {
        throw new Error(`bench SSE tails did not all receive cursor ${expected} in order`);
      }
    }
    return { tails: TAILS, events: EVENTS, p50: percentile(times, 50), p99: percentile(times, 99) };
  } finally {
    await Promise.all(tails.map((tail) => tail.cancel()));
  }
}
