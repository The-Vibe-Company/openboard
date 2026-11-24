import { BoardError, MESSAGE_TEXT_MAX, type Message } from "@openboard/contract";
import type { LabelChange } from "../messages/labels.ts";
import { renderTemplateText } from "../webhooks/template.ts";
import type { parseInboundRules } from "./rules.ts";

type Plan = ReturnType<typeof parseInboundRules>;
type Action = Plan[number]["do"][number];
type Template = Extract<Action, { reply: unknown }>["reply"];
type MessageAction = Extract<Action, { reply: unknown } | { label: unknown } | { react: unknown }>;

function requireMessageAction(action: Action, at: string): asserts action is MessageAction {
  if (!("reply" in action || "label" in action || "react" in action)) {
    throw new BoardError("invalid_rule", `${at}.${Object.keys(action)[0]}: unsupported inbound action`);
  }
}

export function validateInboundActions(plan: Plan): void {
  for (const [ruleIndex, rule] of plan.entries()) {
    for (const [index, action] of rule.do.entries()) requireMessageAction(action, `rules[${ruleIndex}].do[${index}]`);
  }
}

export function inboundMessagePermission(action: Action) {
  requireMessageAction(action, "action");
  return "reply" in action ? "post" : "label" in action ? "label" : "react";
}

export function renderInboundMessageAction(action: Action, body: unknown, thread: Message) {
  requireMessageAction(action, "action");
  function render(parts: Template, field: string, limit: number): string {
    const rendered = renderTemplateText(parts, { body, thread }, limit);
    if (!rendered || rendered.truncated) throw new BoardError("invalid_request", `inbound ${field} is too large`);
    return rendered.text;
  }

  if ("reply" in action) {
    const text = render(action.reply, "reply", MESSAGE_TEXT_MAX * 2);
    if ([...text].length > MESSAGE_TEXT_MAX) throw new BoardError("invalid_request", "inbound reply is too large");
    return { permission: "post", input: { re: thread.id, text } } as const;
  }
  if ("react" in action) {
    return { permission: "react", input: { id: thread.id, emoji: render(action.react, "reaction", 64) } } as const;
  }

  const { set = {}, unset = [], if: conditions = {} } = action.label;
  const input: LabelChange = {
    id: thread.id,
    set: Object.fromEntries(Object.entries(set).map(([key, value]) => [key, render(value, "label value", 256)])),
    unset: unset.map((key) => render(key, "label key", 64)),
    if: Object.fromEntries(
      Object.entries(conditions).map(([key, value]) => [
        key,
        value === null ? null : render(value, "label condition", 256),
      ]),
    ),
  };
  return { permission: "label", input } as const;
}
