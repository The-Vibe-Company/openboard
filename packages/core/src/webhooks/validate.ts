import { BoardError, type WebhookSpec } from "@openboard/contract";
import { validateWebhookFilter } from "./filter.ts";
import { validateWebhookSigning } from "./signing.ts";
import { validateWebhookTemplate } from "./template.ts";

const templateLimit = 16 * 1024;
const encoder = new TextEncoder();

function validateBody(value: unknown): object | null {
  if (value == null) return null;
  if (typeof value !== "object") {
    throw new BoardError("invalid_request", "webhook body must be a JSON object or array");
  }
  if (encoder.encode(JSON.stringify(value)).length > templateLimit) {
    throw new BoardError("invalid_request", "webhook body template must be at most 16 KB");
  }
  validateWebhookTemplate(value);
  return value;
}

export function validateWebhookContent(spec: Pick<WebhookSpec, "body" | "filter">) {
  return { tail: validateWebhookFilter(spec.filter), body: validateBody(spec.body) };
}

export function validateWebhook(spec: WebhookSpec) {
  const { tail, body } = validateWebhookContent(spec);
  const signing = validateWebhookSigning(spec);
  const headers = spec.headers ?? {};
  const publicHeaders = Object.fromEntries(Object.keys(headers).map((name) => [name, "…"]));
  return { tail, signing, headers, publicHeaders, body };
}
