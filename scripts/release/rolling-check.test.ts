import { expect, test } from "bun:test";
import { rollingCheck } from "./rolling-check.ts";

const url = "https://staging.example/api/conformance-ci/main";
const token = "test credential";

function fakeBoard(replay: number[], interruptWrite = false) {
  let now = 0;
  const attempts: string[] = [];
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const writes: string[] = [];
  const starts: number[] = [];
  const cursors: (string | null)[] = [];
  const finished = Promise.withResolvers<void>();
  const encode = new TextEncoder();
  function emit(text: string, cursor: number) {
    const event = { cursor: String(cursor), type: "message.posted", payload: { text } };
    stream?.enqueue(encode.encode(`id: ${cursor}\nevent: board\ndata: ${JSON.stringify(event)}\n\n`));
  }
  function open(request: Request) {
    const cursor = request.headers.get("last-event-id");
    cursors.push(cursor);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
        request.signal.addEventListener(
          "abort",
          () => {
            if (stream === controller) controller.close();
          },
          { once: true },
        );
        if (cursors.length > 1) {
          for (const number of replay) {
            const text = writes[number - 1];
            if (!text) throw new Error(`Cannot replay unwritten message ${number}`);
            emit(text, number + 1);
          }
        }
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }
  return {
    writes,
    attempts,
    starts,
    cursors,
    deploy: async () => {
      expect(cursors).toEqual(["1"]);
      expect(writes).toHaveLength(1);
      await finished.promise;
    },
    runtime: {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      retryDelay: () => finished.promise,
      fetch: async (request: Request) => {
        expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
        expect(request.redirect).toBe("error");
        if (request.method === "GET") {
          return request.headers.get("accept")?.includes("text/event-stream")
            ? open(request)
            : Response.json({ cursor: "1", events: [] });
        }
        const { text, channel, id } = await request.json();
        expect(channel).toBe("rolling-check");
        expect(id).toBe(text);
        attempts.push(text);
        if (writes.includes(text)) return Response.json({ message: {} }, { status: 201 });
        writes.push(text);
        if (text.endsWith(" end")) emit(text, 6);
        else starts.push(now);
        if (writes.length === 1) emit(text, 2);
        if (writes.length === 2) {
          stream?.close();
          stream = undefined;
          if (interruptWrite) {
            const truncated = new ReadableStream({
              pull(controller) {
                controller.error(new TypeError("response body was lost after committing"));
              },
            });
            return new Response(truncated, { status: 201 });
          }
        }
        if (writes.length === 4) finished.resolve();
        return Response.json({ message: {} }, { status: 201 });
      },
    },
  };
}

test("tails before deploying, writes every 100 ms and resumes by Last-Event-ID", async () => {
  const board = fakeBoard([2, 3, 4]);
  expect(await rollingCheck(url, token, board.deploy, board.runtime)).toBe(4);
  expect(board.cursors).toEqual(["1", "2"]);
  expect(board.starts).toEqual([0, 100, 200, 300]);
  expect(board.writes.map((text) => text.split(" ").at(-1))).toEqual(["1", "2", "3", "4", "end"]);
});

test("names missing, repeated and out-of-order numbers in the resumed stream", async () => {
  const board = fakeBoard([4, 2, 2]);
  await expect(rollingCheck(url, token, board.deploy, board.runtime)).rejects.toThrow(
    "repeated 2 (2 deliveries); out-of-order 2; missing 3; out-of-order 4",
  );
});

test("retries an interrupted write with the same id and counts its delivery once", async () => {
  const board = fakeBoard([2, 3, 4], true);
  expect(await rollingCheck(url, token, board.deploy, board.runtime)).toBe(4);
  expect(board.attempts.slice(1, 3)).toEqual([board.writes[1], board.writes[1]]);
  expect(board.writes).toHaveLength(5);
});
