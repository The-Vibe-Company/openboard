import { BoardError, type WebhookSpec } from "@openboard/contract";
import { validateWebhookFilter } from "./filter.ts";
import { validateWebhookSigning } from "./signing.ts";

export function validateWebhook(spec: WebhookSpec) {
  const tail = validateWebhookFilter(spec.filter);
  const signing = validateWebhookSigning(spec);
  if (spec.body != null) throw new BoardError("invalid_request", "webhook body templates are not available yet");
  const headers = spec.headers ?? {};
  const publicHeaders = Object.fromEntries(Object.keys(headers).map((name) => [name, "…"]));
  return { tail, signing, headers, publicHeaders };
}
