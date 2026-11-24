import { claimTask, completeTask, createTask } from "@openboard/contract";
import type { Instance, Server } from "../drivers";
import { type Cost, send, summarize, type WorkloadResult } from "./request";

const WARMUP = 50;

/** Runs complete task lifecycles through the board API, alternating requests across hosted instances. */
export async function runTaskWorkload(server: Server, cycles: number): Promise<WorkloadResult[]> {
  if (server.instances.length === 0) throw new Error("no instance to run the task workload on");
  if (!Number.isInteger(cycles) || cycles < 1) throw new RangeError("the task workload needs a positive cycle count");

  let turn = 0;
  const call = (op: typeof createTask | typeof claimTask | typeof completeTask, body: unknown, id?: string) => {
    const instance = server.instances[turn++ % server.instances.length] as Instance;
    return send(instance, server.board, {
      method: op.route.method,
      path: op.route.path.replace(":id", id ?? ""),
      expected: op === createTask ? 201 : 200,
      body,
    });
  };
  const creates: Cost[] = [];
  const claims: Cost[] = [];
  const completions: Cost[] = [];
  for (let i = 0; i < WARMUP + cycles; i++) {
    const created = await call(createTask, { channel: "bench-tasks", text: `Task ${i}` });
    const { task } = created.body as (typeof createTask.output)["static"];
    const claimed = await call(claimTask, {}, task.id);
    const { claim } = claimed.body as (typeof claimTask.output)["static"];
    const completed = await call(completeTask, { epoch: claim.epoch, token: claim.token, result: "Done" }, task.id);
    if (i >= WARMUP) {
      creates.push(created.cost);
      claims.push(claimed.cost);
      completions.push(completed.cost);
    }
  }
  return [
    summarize("taskCreate", createTask.name, creates),
    summarize("taskClaim", claimTask.name, claims),
    summarize("taskComplete", completeTask.name, completions),
  ];
}
