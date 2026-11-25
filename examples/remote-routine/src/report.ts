import { createHmac } from "node:crypto";
import { once } from "node:events";
import { BoardError, type createClient } from "@the-vibe-company/openboard";
import { signingKey } from "./verify.ts";

// Leave room for the note prefix within the board's 10,000-character message limit.
const summaryLimit = 9_900;

async function lastLine(
  stdout: ReadableStream<Uint8Array>,
  exited: Promise<unknown>,
  drainDeadline: () => AbortSignal,
) {
  const reader = stdout.getReader();
  const stopped = new AbortController();
  const stop = () => {
    stopped.abort();
    void reader.cancel().catch(() => {});
  };
  let draining: AbortSignal | undefined;
  let done = false;
  void exited.then(() => {
    if (done) return;
    draining = drainDeadline();
    if (draining.aborted) stop();
    else draining.addEventListener("abort", stop, { once: true });
  });
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
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      collect(decoder.decode(chunk.value, { stream: true }));
      if (!process.stdout.write(chunk.value)) await once(process.stdout, "drain", { signal: stopped.signal });
    }
  } catch (error) {
    if (!stopped.signal.aborted) throw error;
  } finally {
    done = true;
    draining?.removeEventListener("abort", stop);
    reader.releaseLock();
  }
  collect(decoder.decode());
  return endsWithNewline ? summary : line;
}

type RunEvent = "turn.finished" | "run.failed" | "run.expired";

type RunnerProcess = {
  pid: number;
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array> | undefined;
  kill(signal: "SIGKILL"): void;
};

function stopRunner(child: RunnerProcess) {
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    // The runner may have exited just as the deadline fired.
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

export function captureTurn(
  child: RunnerProcess,
  report: (summary: string, event: RunEvent) => Promise<void>,
  deadline?: AbortSignal,
  drainDeadline = () => AbortSignal.timeout(1_000),
) {
  function reportError() {
    process.stderr.write("error: turn_report_failed: could not report the runner outcome\n");
  }

  let expired = false;
  function expire() {
    try {
      stopRunner(child);
      expired = true;
    } catch {
      reportError();
    }
  }
  if (deadline?.aborted) expire();
  else deadline?.addEventListener("abort", expire, { once: true });

  const outcome = child.exited
    .then((status): RunEvent => (expired ? "run.expired" : status === 0 ? "turn.finished" : "run.failed"))
    .finally(() => deadline?.removeEventListener("abort", expire))
    .catch(() => {
      reportError();
      return undefined;
    });
  // Drain stdout immediately, but wait until the caller has written the run link.
  const summary = child.stdout
    ? lastLine(child.stdout, outcome, drainDeadline).catch(() => {
        reportError();
        return "";
      })
    : "";
  return () =>
    outcome.then(async (event) => {
      if (!event) return;
      if (event !== "turn.finished") await report("", event);
      else await report(await summary, event);
    });
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
  return async (
    thread: string,
    deliveryId: string,
    summary: string,
    event: RunEvent = "turn.finished",
    actor?: string,
    claimKey = deliveryId,
    id = deps.eventId(),
  ) => {
    const { message } = await retry(
      () => board.readThread({ id: thread }, { signal: AbortSignal.timeout(5_000) }),
      deps.wait,
    );
    const state = message.task?.state;
    if (!state || message.labels?.run !== deliveryId) return;
    const claimed = state === "claimed";
    const settled = state === "completed" || state === "failed";
    const profile = `run-${thread}`;
    const claimActor = claimed ? message.task?.claim?.actor : undefined;
    const ownsClaim = actor !== undefined && claimActor === actor;
    if (event === "turn.finished" && !settled && (!claimed || (actor !== undefined && !ownsClaim))) return;

    const timestamp = String(Math.floor(deps.now() / 1000));
    const body = JSON.stringify({
      event,
      ...(event === "turn.finished"
        ? {
            settled,
            claimKey,
            claimActor,
            summary: summary.slice(0, summaryLimit).toWellFormed().replaceAll("\0", "�"),
          }
        : { claimed: ownsClaim, profile }),
      externalRef: `ob:${thread}`,
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
