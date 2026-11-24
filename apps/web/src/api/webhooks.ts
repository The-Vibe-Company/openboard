import { BoardError, type Client } from "@the-vibe-company/openboard";

export function webhookRequest(data: FormData): Parameters<Client["createWebhook"]>[0] {
  const types = String(data.get("types") ?? "")
    .split(",")
    .map((type) => type.trim())
    .filter(Boolean);
  return {
    name: String(data.get("name") ?? "").trim(),
    url: String(data.get("url") ?? "").trim(),
    filter: {
      tail: String(data.get("tail") ?? "").trim(),
      ...(types.length && { types }),
    },
  };
}

export function webhookError(error: unknown, fallback: string) {
  if (!(error instanceof BoardError)) return fallback;
  if (error.code === "forbidden") return "Only board owners and organization admins manage webhooks";
  return error.hint ? `${error.message.replace(/\.$/, "")}. ${error.hint}` : error.message;
}
