import { type DeliveryRequest, signingKey, verifyDelivery } from "./verify.ts";

export interface ThreadLink {
  delivery: string;
  board: string;
  platform: string;
}

export interface ThreadLinks {
  read(): Promise<ThreadLink[]>;
  save(links: ThreadLink[]): Promise<void>;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBody(body: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return undefined;
  }
}

export function createOutbound(
  secret: string,
  now: () => number,
  links: ThreadLinks,
  incoming: (id: string, payload: { boardThread: string; text: string }) => Promise<string>,
) {
  const key = signingKey(secret);
  // Serialize snapshot updates within this recipe instance. The adapter owns
  // idempotency across a crash between accepting the post and saving its link.
  let pending = Promise.resolve();
  return async (request: DeliveryRequest): Promise<number> => {
    const verified = await verifyDelivery(request, key, now());
    if (!verified) return 401;
    const payload = parseBody(verified.body);
    if (!record(payload) || payload.version !== 1) return 400;
    if (payload.type === "board.ping") return 204;
    if (payload.type !== "board.event" || !record(payload.subject) || !record(payload.event)) return 400;
    const { subject, event } = payload;
    if (subject.channel !== "support" || event.type !== "message.posted") return 204;
    if (typeof subject.thread !== "string" || typeof subject.message !== "string") return 400;
    if (subject.thread !== subject.message) return 204;
    if (!record(event.message) || typeof event.message.text !== "string") return 400;
    const boardThread = subject.thread;
    const text = event.message.text;
    const deliver = pending.then(async () => {
      const saved = await links.read();
      if (saved.some((link) => link.delivery === verified.id || link.board === boardThread)) return;
      const platform = await incoming(verified.id, { boardThread, text });
      if (saved.some((link) => link.platform === platform)) throw new Error("platform reused a thread ID");
      await links.save([...saved, { delivery: verified.id, board: boardThread, platform }]);
    });
    pending = deliver.catch(() => {});
    await deliver;
    return 204;
  };
}
