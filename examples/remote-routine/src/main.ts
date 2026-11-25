import { parseArgs } from "node:util";
import { createClient } from "@the-vibe-company/openboard";
import { createLauncher, runnerCommand } from "./launch.ts";
import { captureTurn, createTurnReporter } from "./report.ts";
import { type DeliveryRequest, signingKey, verifyDelivery } from "./verify.ts";
import { createWakeLauncher, wakeReply } from "./wake.ts";

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
  wake?: { secret: string; launch: (thread: string, deliveryId: string, message: string) => Promise<void> },
) {
  const key = signingKey(secret);
  const wakeKey = wake && signingKey(wake.secret);
  const launched = new Map<string, Promise<void>>();
  return async (request: DeliveryRequest & Pick<Request, "url" | "method">) => {
    const path = new URL(request.url).pathname;
    const isWake = path === "/wake" && wakeKey !== undefined;
    if (path !== "/hook" && !isWake) return new Response(null, { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });

    const delivery = await verifyDelivery(request, isWake ? wakeKey : key, now());
    if (!delivery) return new Response(null, { status: 401 });
    const reply = isWake ? wakeReply(delivery.body) : undefined;
    if (reply && !reply.person) return new Response(null, { status: 204 });
    const thread = isWake ? reply?.thread : readyThread(delivery.body);
    if (!thread) return new Response(null, { status: 400 });

    const deliveryKey = `${path}:${delivery.id}`;
    let pending = launched.get(deliveryKey);
    if (!pending) {
      pending = Promise.resolve().then(() =>
        reply && wake ? wake.launch(thread, delivery.id, reply.id) : launch(thread, delivery.id),
      );
      launched.set(deliveryKey, pending);
    }
    try {
      await pending;
      return new Response(null, { status: 204 });
    } catch {
      if (launched.get(deliveryKey) === pending) launched.delete(deliveryKey);
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
  const [webhookSecret, connectionSecret, routineSecret, inboundSecret, wakeSecret] = await Promise.all([
    readSecret(process.env.WEBHOOK_SECRET_FILE),
    readSecret(process.env.OPENBOARD_SECRET_FILE),
    readSecret(process.env.ROUTINE_SECRET_FILE),
    readSecret(process.env.INBOUND_SECRET_FILE),
    readSecret(process.env.WAKE_WEBHOOK_SECRET_FILE),
  ]);
  const launch = createLauncher(boardUrl, connectionSecret, command, "pipe");
  const routine = createClient({ url: boardUrl, token: routineSecret, profile: "routine" });
  const report = createTurnReporter(routine, inboundUrl, inboundSecret, {
    now: Date.now,
    eventId: () => crypto.randomUUID(),
    send: globalThis.fetch,
    wait: (ms) => Bun.sleep(ms),
  });
  const start = createWakeLauncher(
    routine,
    async (thread, deliveryId, options) => {
      const { child, actor } = await launch(thread, deliveryId, options);
      const reportId = crypto.randomUUID();
      const reportTurn = captureTurn(
        child,
        (summary, event) => report(thread, deliveryId, summary, event, actor, options.claimKey, reportId),
        AbortSignal.timeout(timeout),
      );
      return {
        exited: child.exited,
        live: () => child.exitCode === null && child.signalCode === null,
        report: reportTurn,
      };
    },
    process.env.RUN_URL_TEMPLATE,
  );
  const fetch = createRoutine(webhookSecret, Date.now, start.ready, { secret: wakeSecret, launch: start.wake });
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
