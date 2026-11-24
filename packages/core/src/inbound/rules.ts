import { BoardError, type InboundRules, isInboundRules } from "@openboard/contract";

export function parseInboundRules(input: unknown): InboundRules {
  if (!isInboundRules(input)) {
    throw new BoardError("invalid_rule", "expected body path conditions and supported inbound actions");
  }
  return input;
}
