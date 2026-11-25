import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardError, type createClient } from "@the-vibe-company/openboard";
import type { LaunchOptions } from "./launch.ts";
import { createLinkedLauncher } from "./link.ts";

export function wakeReply(body: ArrayBuffer) {
  try {
    const delivery = JSON.parse(new TextDecoder().decode(body)) as {
      type?: string;
      version?: number;
      subject?: { channel?: string; thread?: string; message?: string };
      event?: { type?: string; message?: { id?: string; thread?: string; author?: { kind?: string } } };
    } | null;
    const { subject, event } = delivery ?? {};
    const { id, author } = event?.message ?? {};
    if (
      delivery?.type !== "board.event" ||
      delivery.version !== 1 ||
      event?.type !== "message.posted" ||
      typeof subject?.channel !== "string" ||
      !subject.channel.startsWith("work/fix/") ||
      typeof subject.thread !== "string" ||
      !/^[1-9]\d{0,19}$/.test(subject.thread) ||
      typeof id !== "string" ||
      !/^[1-9]\d{0,19}$/.test(id) ||
      id !== subject.message ||
      event.message?.thread !== subject.thread
    )
      return;
    return { thread: subject.thread, id, person: id !== subject.thread && author?.kind === "person" };
  } catch {
    return;
  }
}

type Board = Pick<ReturnType<typeof createClient>, "readThread" | "postMessage" | "labelMessage" | "readPost">;
type Spawn = (
  thread: string,
  run: string,
  options: LaunchOptions,
) => Promise<{
  exited: Promise<number>;
  live: () => boolean;
  report: () => Promise<void>;
}>;

async function wakeFile() {
  const dir = await mkdtemp(join(tmpdir(), "openboard-wake-"));
  const file = join(dir, "replies");
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    await writeFile(file, "", { mode: 0o600 });
    return { file, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function serializeThreads() {
  const pending = new Map<string, Promise<void>>();
  return async (thread: string, operation: () => Promise<void>) => {
    const work = (pending.get(thread) ?? Promise.resolve()).catch(() => {}).then(operation);
    pending.set(thread, work);
    try {
      await work;
    } finally {
      if (pending.get(thread) === work) pending.delete(thread);
    }
  };
}

type Wake = { id: string; claimKey: string; waiting: string; run: string; finished: string; actor: string };

async function startRunner(board: Board, spawn: Spawn, thread: string, run: string, wake?: Wake) {
  const { file, cleanup } = await wakeFile();
  const runner = await spawn(thread, run, {
    claimKey: wake?.claimKey ?? run,
    env: { OPENBOARD_WAKE_FILE: file, ...(wake ? { OPENBOARD_WAKE: wake.id } : {}) },
    async prepare(actor) {
      if (wake && wake.actor !== actor) throw new Error("the run no longer owns the task claim");
      // The board matches the wake filter when a reply is written.
      await board.labelMessage({
        id: thread,
        set: { run },
        ...(wake ? { if: { run: wake.run, "run-waiting": wake.waiting } } : {}),
      });
    },
  }).catch(async (error) => {
    await cleanup();
    if (wake) {
      // Restore the waiting turn if preparation committed but the new process never started.
      await board
        .labelMessage({ id: thread, set: { run: wake.finished }, if: { run, "run-waiting": wake.waiting } })
        .catch(() => {});
    }
    throw error;
  });
  return { runner, file, cleanup };
}

async function wasStarted(board: Board, run: string) {
  try {
    await board.readPost({ id: `routine-run:${run}` });
    return true;
  } catch (error) {
    if (error instanceof BoardError && error.code === "post_not_found") return false;
    throw error;
  }
}

export function createWakeLauncher(board: Board, spawn: Spawn, urlTemplate?: string) {
  type Run = { run: string; file: string; live: () => boolean; linked: boolean; report: () => void };
  const runs = new Map<string, Run>();
  // Serialize link retries, file writes and restarts for each thread.
  const inThread = serializeThreads();

  const link = createLinkedLauncher<Wake>(
    board,
    async (thread, run, wake) => {
      const { runner, file, cleanup } = await startRunner(board, spawn, thread, run, wake);
      let reporting = false;
      const active: Run = {
        run,
        file,
        live: runner.live,
        linked: false,
        report() {
          if (reporting) return;
          reporting = true;
          void runner.report().then(
            () => {
              if (runs.get(thread) === active) runs.delete(thread);
            },
            () => {
              reporting = false;
              process.stderr.write("error: turn_report_failed: could not report the runner outcome\n");
            },
          );
        },
      };
      runs.set(thread, active);
      const removeFile = () => inThread(thread, cleanup);
      void runner.exited.then(removeFile, removeFile).catch(() => {});
      return () => {
        active.linked = true;
        active.report();
      };
    },
    urlTemplate,
    (thread, run) => board.labelMessage({ id: thread, unset: ["run-waiting"], if: { run } }),
  );

  async function wake(thread: string, run: string, id: string) {
    const active = runs.get(thread);
    if (active?.run === run) {
      await link(thread, run);
      return;
    }

    const { message } = await board.readThread({ id: thread });
    const current = message.labels?.run;
    if (!current || (await wasStarted(board, run))) return;

    if (active?.run === current && active.live()) {
      await appendFile(active.file, `${id}\n`);
      if (active.live()) return;
    }

    if (active?.run === current && !active.linked) throw new Error("the runner link is pending");
    const claim = message.task?.state === "claimed" ? message.task.claim : undefined;
    if (!claim?.actor.endsWith(`+run-${thread}`)) return;
    // The exit report supplies the original connection claim key only for a successful, unfinished turn.
    const waiting = message.labels?.["run-waiting"];
    const [finished, claimKey, actor] = waiting?.split("|") ?? [];
    if (!waiting || !finished || !claimKey || (finished !== current && current !== run)) {
      active?.report();
      throw new Error("the runner exit report is pending");
    }
    if (actor !== claim.actor) return;
    await link(thread, run, { id, claimKey, waiting, run: current, finished, actor });
  }

  return {
    ready: (thread: string, run: string) => inThread(thread, () => link(thread, run)),
    wake: (thread: string, run: string, id: string) => inThread(thread, () => wake(thread, run, id)),
  };
}
