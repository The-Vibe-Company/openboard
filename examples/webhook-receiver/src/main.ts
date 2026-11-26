import { parseArgs } from "node:util";
import { BoardError, parseWebhookEvent, type WebhookEvent } from "@the-vibe-company/openboard";

type EventDelivery = Extract<WebhookEvent, { type: "board.event" }>;
type BoardDelivery = Pick<EventDelivery["subject"], "thread" | "channel" | "labels"> & {
  event: EventDelivery["event"];
};

export function createReceiver(
  secret: string,
  now: () => number,
  onDelivery: (delivery: BoardDelivery, id: string) => void,
) {
  const seen = new Set<string>();
  return async (
    request: Pick<Request, "url" | "method" | "arrayBuffer"> & { headers: Iterable<[string, string]> },
  ): Promise<Response> => {
    if (new URL(request.url).pathname !== "/hook") return new Response(null, { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });

    const headers = Object.fromEntries(request.headers);
    const body = new Uint8Array(await request.arrayBuffer());
    let delivery: WebhookEvent;
    try {
      delivery = await parseWebhookEvent({ headers, body, secret, now });
    } catch (error) {
      if (!(error instanceof BoardError)) throw error;
      return new Response(null, { status: error.status });
    }
    const { id } = delivery.delivery;
    if (delivery.type === "board.ping" || seen.has(id)) return new Response(null, { status: 204 });

    const { thread, channel, labels } = delivery.subject;
    onDelivery({ thread, channel, labels, event: delivery.event }, id);
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
    if (!secret.trim()) throw new Error("missing signing secret");
    const fetch = createReceiver(secret.trim(), Date.now, ({ event, channel, thread, labels }, id) => {
      const pairs = Object.entries(labels).map(([key, value]) => `${key}=${value}`);
      console.log(["verified", id, event.type, channel, thread, ...pairs].join(" "));
    });
    const server = Bun.serve({ hostname: "127.0.0.1", port, fetch, maxRequestBodySize: 256 * 1024 });
    console.log(`listening on ${server.url}hook`);
  } catch {
    console.error(
      "error: startup_failed: check --port and the Standard Webhooks secret on stdin or in WEBHOOK_SECRET_FILE",
    );
    process.exitCode = 1;
  }
}
