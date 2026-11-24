import { parseArgs } from "node:util";
import { type DeliveryRequest, signingKey, verifyDelivery } from "./verify.ts";

interface BoardDelivery {
  thread: string;
  channel: string;
  labels: Record<string, string>;
  event: Record<string, unknown> & { type: string };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boardDelivery(body: ArrayBuffer): BoardDelivery | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return;
  }
  if (!record(payload) || payload.type !== "board.event" || payload.version !== 1) return;
  const { subject, event } = payload;
  if (!record(subject) || !record(event) || typeof event.type !== "string") return;
  const { thread, channel, labels } = subject;
  if (typeof thread !== "string" || typeof channel !== "string" || !record(labels)) return;
  const entries = Object.entries(labels);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) return;
  return { thread, channel, labels: Object.fromEntries(entries), event: { ...event, type: event.type } };
}

export function createReceiver(
  secret: string,
  now: () => number,
  onDelivery: (delivery: BoardDelivery, id: string) => void,
) {
  const key = signingKey(secret);
  const seen = new Set<string>();
  return async (request: DeliveryRequest & Pick<Request, "url" | "method">): Promise<Response> => {
    if (new URL(request.url).pathname !== "/hook") return new Response(null, { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });

    const verified = await verifyDelivery(request, key, now());
    if (!verified) return new Response(null, { status: 401 });
    const { id, body } = verified;
    if (seen.has(id)) return new Response(null, { status: 204 });
    const delivery = boardDelivery(body);
    if (!delivery) return new Response(null, { status: 400 });

    onDelivery(delivery, id);
    seen.add(id);
    return new Response(null, { status: 204 });
  };
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: { port: { type: "string", default: "9000" } },
    });
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid port");
    const secretFile = Bun.env.WEBHOOK_SECRET_FILE;
    const secret = await (secretFile ? Bun.file(secretFile).text() : Bun.stdin.text());
    const fetch = createReceiver(secret.trim(), Date.now, ({ event, channel, thread, labels }, id) => {
      const pairs = Object.entries(labels).map(([key, value]) => `${key}=${value}`);
      console.log(["verified", id, event.type, channel, thread, ...pairs].join(" "));
    });
    const server = Bun.serve({ hostname: "127.0.0.1", port, fetch });
    console.log(`listening on ${server.url}hook`);
  } catch {
    console.error(
      "error: startup_failed: check --port and the Standard Webhooks secret on stdin or in WEBHOOK_SECRET_FILE",
    );
    process.exitCode = 1;
  }
}
