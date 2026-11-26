import { openboardFromEnv, runWorker } from "@the-vibe-company/openboard";

const [requestId] = Bun.argv.slice(2);
if (!requestId) throw new Error("Usage: bun examples/webhook-receiver/src/product.ts <request-id>");

const board = await openboardFromEnv();
const channel = "product-demo";
const { task } = await board.tasks.create({
  channel,
  text: `Process product request ${requestId}`,
  id: `product-demo:${requestId}`,
  labels: { source: "product-demo", request: requestId },
});
console.log(`Submitted task ${task.id}`);

if (task.task.state === "completed") {
  console.log(`Task ${task.id} is already completed`);
  process.exit(0);
}
const stats = await runWorker(
  board,
  {
    channel,
    label: { source: "product-demo", request: requestId },
    maxTasks: 1,
    signal: AbortSignal.timeout(10_000),
  },
  async ({ reply }) => {
    await reply("The product worker started processing the request.");
    return "Product request processed.";
  },
);
const { message } = await board.tasks.get(task.id);
if (message.task?.state !== "completed") throw new Error(`Task ${message.id} did not complete in the demo run`);
console.log(`Task ${message.id}: ${message.task?.state} (${stats.completed} completed this run)`);
