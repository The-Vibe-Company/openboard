import { BoardError, MESSAGE_TEXT_MAX, type Message } from "@openboard/contract";
import type { PostCommand } from "../messages/post.ts";
import { renderTemplateText } from "../webhooks/template.ts";
import type { parseInboundRules } from "./rules.ts";

type Plan = ReturnType<typeof parseInboundRules>;
type Action = Plan[number]["do"][number];

function requireReply(action: Action, at: string): asserts action is Extract<Action, { reply: unknown }> {
  if (!("reply" in action)) {
    throw new BoardError("invalid_rule", `${at}.${Object.keys(action)[0]}: unsupported inbound action`);
  }
}

export function validateInboundActions(plan: Plan): void {
  for (const [ruleIndex, rule] of plan.entries()) {
    for (const [index, action] of rule.do.entries()) requireReply(action, `rules[${ruleIndex}].do[${index}]`);
  }
}

export function inboundReply(action: Action, body: unknown, thread: Message): PostCommand {
  requireReply(action, "action");
  const rendered = renderTemplateText(action.reply, { body, thread }, MESSAGE_TEXT_MAX * 2);
  if (!rendered || rendered.truncated || [...rendered.text].length > MESSAGE_TEXT_MAX) {
    throw new BoardError("invalid_request", "inbound reply is too large");
  }
  return { re: thread.id, text: rendered.text };
}
