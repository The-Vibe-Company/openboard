import { isAbsolute } from "node:path";
import { createClient } from "@the-vibe-company/openboard";

export function runnerCommand(value: string | undefined): [string, ...string[]] {
  const command: unknown = JSON.parse(value ?? "null");
  if (
    !Array.isArray(command) ||
    typeof command[0] !== "string" ||
    !isAbsolute(command[0]) ||
    !command.every((arg) => typeof arg === "string")
  ) {
    throw new Error("expected RUNNER_COMMAND to be a JSON argv array with an absolute executable");
  }
  return [command[0], ...command.slice(1)];
}

export type LaunchOptions = {
  claimKey: string;
  env: Record<string, string>;
  prepare: (actor: string) => Promise<void>;
};

export function createLauncher(
  boardUrl: string,
  secret: string,
  command: [string, ...string[]],
  stdout: "inherit" | "pipe" = "inherit",
) {
  const board = createClient({ url: boardUrl, token: secret });
  return async (thread: string, deliveryId: string, options?: LaunchOptions) => {
    const { agent, env } = await board.claimConnection({
      profile: `run-${thread}`,
      idempotencyKey: options?.claimKey ?? deliveryId,
    });
    await options?.prepare(agent.actor);
    const child = Bun.spawn(command, {
      env: { ...options?.env, ...env, OPENBOARD_TASK: thread, OPENBOARD_RUN: deliveryId },
      detached: process.platform !== "win32",
      stdin: "ignore",
      stdout,
      stderr: "inherit",
    });
    void child.exited.then(
      (status) => {
        if (status !== 0) process.stderr.write("error: runner_failed: task runner exited unsuccessfully\n");
      },
      () => process.stderr.write("error: runner_failed: could not wait for task runner\n"),
    );
    return { child, actor: agent.actor };
  };
}
