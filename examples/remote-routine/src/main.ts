import { parseArgs } from "node:util";
import { createClient } from "@the-vibe-company/openboard";
import { createLauncher, runnerCommand } from "./launch.ts";
import { createLinkedLauncher } from "./link.ts";
import { captureTurn, createTurnReporter } from "./report.ts";
import { type DeliveryRequest, signingKey, verifyDelivery } from "./verify.ts";

function readyThread(body: ArrayBuffer): string | undefined {
  try {
    const delivery = JSON.parse(new TextDecoder().decode(body)) as {
      type?: string;
      version?: number;
      subject?: { thread?: string; channel?: string; task?: { state?: string } };
    } | null;
    const subject = delivery?.subject;
    if (
      delivery?.type === "board.event" &&
      delivery.version === 1 &&
      typeof subject?.channel === "string" &&
      subject.channel.startsWith("work/fix/") &&
      typeof subject.thread === "string" &&
      /^[1-9]\d{0,19}$/.test(subject.thread) &&
      subject.task?.state === "ready"
    ) {
      return subject.thread;
    }
  } catch {
    return;
  }
}

export function createRoutine(
  secret: string,
  now: () => number,
  launch: (thread: string, deliveryId: string) => Promise<void>,
) {
  const key = signingKey(secret);
  const launched = new Map<string, Promise<void>>();
  return async (request: DeliveryRequest & Pick<Request, "url" | "method">) => {
    if (new URL(request.url).pathname !== "/hook") return new Response(null, { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });

    const delivery = await verifyDelivery(request, key, now());
    if (!delivery) return new Response(null, { status: 401 });
    const thread = readyThread(delivery.body);
    if (!thread) return new Response(null, { status: 400 });

    let pending = launched.get(delivery.id);
    if (!pending) {
      pending = Promise.resolve().then(() => launch(thread, delivery.id));
      launched.set(delivery.id, pending);
    }
    try {
      await pending;
      return new Response(null, { status: 204 });
    } catch {
      if (launched.get(delivery.id) === pending) launched.delete(delivery.id);
      return new Response(null, { status: 503 });
    }
  };
}

async function readSecret(path: string | undefined) {
  if (!path) throw new Error("a secret file is required");
  const secret = (await Bun.file(path).text()).trim();
  if (!secret) throw new Error("empty secret file");
  return secret;
}

async function serve() {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { port: { type: "string", default: "9100" } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid port");
  const boardUrl = process.env.BOARD_URL;
  if (!boardUrl) throw new Error("BOARD_URL is required");
  const command = runnerCommand(process.env.RUNNER_COMMAND);
  const timeout = Number(process.env.RUN_TIMEOUT ?? 300_000);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
    throw new Error("RUN_TIMEOUT must be a positive millisecond count no greater than 2147483647");
  }
  const inboundUrl = process.env.INBOUND_URL;
  if (!inboundUrl) throw new Error("INBOUND_URL is required");
  const [webhookSecret, connectionSecret, routineSecret, inboundSecret] = await Promise.all([
    readSecret(process.env.WEBHOOK_SECRET_FILE),
    readSecret(process.env.OPENBOARD_SECRET_FILE),
    readSecret(process.env.ROUTINE_SECRET_FILE),
    readSecret(process.env.INBOUND_SECRET_FILE),
  ]);
  const launch = createLauncher(boardUrl, connectionSecret, command, "pipe");
  const routine = createClient({ url: boardUrl, token: routineSecret, profile: "routine" });
  const report = createTurnReporter(routine, inboundUrl, inboundSecret, {
    now: Date.now,
    eventId: () => crypto.randomUUID(),
    send: globalThis.fetch,
    wait: (ms) => Bun.sleep(ms),
  });
  const start = createLinkedLauncher(
    routine,
    async (thread, deliveryId) => {
      const { child, actor } = await launch(thread, deliveryId);
      return captureTurn(
        child,
        (summary, event) => report(thread, deliveryId, summary, event, actor),
        AbortSignal.timeout(timeout),
      );
    },
    process.env.RUN_URL_TEMPLATE,
  );
  const fetch = createRoutine(webhookSecret, Date.now, start);
  const server = Bun.serve({ hostname: "127.0.0.1", port, maxRequestBodySize: 256 * 1024, fetch });
  process.stdout.write(`Remote routine listening at ${server.url.origin}/hook\n`);
}

if (import.meta.main) {
  try {
    await serve();
  } catch {
    process.stderr.write(
      "error: routine_start_failed: check the port, board URL, runner command, timeout and secret files\n",
    );
    process.exitCode = 1;
  }
}
