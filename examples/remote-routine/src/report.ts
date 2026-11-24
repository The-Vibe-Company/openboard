import { createHmac } from "node:crypto";
import { once } from "node:events";
import { BoardError, type createClient } from "@the-vibe-company/openboard";
import { signingKey } from "./verify.ts";

// Leave room for the note prefix within the board's 10,000-character message limit.
const summaryLimit = 9_900;

async function lastLine(stdout: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let line = "";
  let summary = "";
  let endsWithNewline = true;
  function collect(text: string) {
    if (!text) return;
    endsWithNewline = text.endsWith("\n");
    const lines = text.split("\n");
    for (const [index, part] of lines.entries()) {
      if (index > 0) {
        summary = line.replace(/\r$/, "");
        line = "";
      }
      line += part.slice(0, summaryLimit - line.length);
    }
  }
  for await (const chunk of stdout) {
    if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
    collect(decoder.decode(chunk, { stream: true }));
  }
  collect(decoder.decode());
  return endsWithNewline ? summary : line;
}

export function captureTurn(
  child: { exited: Promise<number>; stdout: ReadableStream<Uint8Array> | undefined },
  report: (summary: string) => Promise<void>,
) {
  function reportError() {
    process.stderr.write("error: turn_report_failed: could not report the finished turn\n");
  }
  const summary = Promise.all([child.exited, child.stdout ? lastLine(child.stdout) : ""]).catch(() => {
    reportError();
    return undefined;
  });
  // Drain stdout immediately, but wait until the caller has written the run link.
  return () => {
    return summary
      .then(async (result) => {
        if (result?.[0] === 0) await report(result[1]);
      })
      .catch(reportError);
  };
}

async function retry<T>(attempt: () => Promise<T>, wait: (ms: number) => Promise<void>): Promise<T> {
  for (const delay of [250, 1_000]) {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof BoardError && error.status < 500 && error.status !== 429) throw error;
      await wait(delay);
    }
  }
  return attempt();
}

interface ReportDeps {
  now: () => number;
  eventId: () => string;
  send: (request: Request) => Promise<Response>;
  wait: (ms: number) => Promise<void>;
}

export function createTurnReporter(
  board: Pick<ReturnType<typeof createClient>, "readThread">,
  url: string,
  secret: string,
  deps: ReportDeps,
) {
  const endpoint = new URL(url).href;
  const key = signingKey(secret);
  return async (thread: string, deliveryId: string, summary: string) => {
    const { message } = await retry(
      () => board.readThread({ id: thread }, { signal: AbortSignal.timeout(5_000) }),
      deps.wait,
    );
    const state = message.task?.state;
    const settled = state === "completed" || state === "failed";
    if (message.labels?.run !== deliveryId || (!settled && state !== "claimed")) return;

    const id = deps.eventId();
    const timestamp = String(Math.floor(deps.now() / 1000));
    const body = JSON.stringify({
      event: "turn.finished",
      settled,
      externalRef: `ob:${thread}`,
      summary: summary.slice(0, summaryLimit).toWellFormed().replaceAll("\0", "�"),
      run: deliveryId,
    });
    const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
    const status = await retry(async () => {
      const response = await deps.send(
        new Request(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            "webhook-id": id,
            "webhook-timestamp": timestamp,
            "webhook-signature": `v1,${signature}`,
          },
          signal: AbortSignal.timeout(5_000),
          body,
        }),
      );
      await response.body?.cancel();
      if (response.status === 429 || response.status >= 500) throw new Error("inbound endpoint is unavailable");
      return response.status;
    }, deps.wait);
    if (status < 200 || status >= 300) throw new Error(`inbound endpoint rejected turn report (${status})`);
  };
}
