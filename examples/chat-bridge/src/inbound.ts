import { createHash } from "node:crypto";
import { BoardError, type Client } from "@the-vibe-company/openboard";
import { parseBody, record, type ThreadLinks } from "./outbound.ts";
import { type DeliveryRequest, signingKey, verifyDelivery } from "./verify.ts";

export function createInbound(
  secret: string,
  now: () => number,
  links: ThreadLinks,
  principal: string,
  client: (profile: string) => Client,
) {
  const key = signingKey(secret);
  return async (request: DeliveryRequest): Promise<number> => {
    const verified = await verifyDelivery(request, key, now());
    if (!verified) return 401;
    const reply = parseBody(verified.body);
    if (
      !record(reply) ||
      reply.type !== "chat.reply" ||
      typeof reply.thread !== "string" ||
      typeof reply.user !== "string" ||
      !/^[a-z0-9-]{1,27}$/.test(reply.user) ||
      typeof reply.text !== "string"
    )
      return 400;
    const link = (await links.read()).find(({ platform }) => platform === reply.thread);
    if (!link) return 409;
    const keyHash = createHash("sha256").update("chat-bridge:").update(verified.id).digest("hex").slice(0, 32);
    try {
      await client(`chat-${reply.user}`).postMessage(
        { re: link.board, text: reply.text, id: `key:${principal}:${keyHash}` },
        { signal: AbortSignal.timeout(5000) },
      );
    } catch (error) {
      if (error instanceof BoardError && error.code === "invalid_request") return 400;
      throw error;
    }
    return 204;
  };
}
