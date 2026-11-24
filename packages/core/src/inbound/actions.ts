import { BoardError, MESSAGE_TEXT_MAX, type Message } from "@openboard/contract";
import type { LabelChange } from "../messages/labels.ts";
import { renderTemplateText } from "../webhooks/template.ts";
import type { parseInboundRules } from "./rules.ts";

type Plan = ReturnType<typeof parseInboundRules>;
type Action = Plan[number]["do"][number];
type Template = Extract<Action, { reply: unknown }>["reply"];

type AgentRevoke = Extract<Action, { "agents.revoke": unknown }>;

export function inboundActionNeedsThread(action: Action): boolean {
  return (
    !("agents.revoke" in action) ||
    action["agents.revoke"].profile.some((part) => typeof part !== "string" && part.path[0] === "thread")
  );
}

export function renderInboundRevoke(action: AgentRevoke, body: unknown, thread?: Message) {
  const { connection, profile } = action["agents.revoke"];
  const actor = thread?.task?.claim?.actor;
  const claim = actor?.startsWith("ob:conn:") ? { profile: actor.split("+")[1] } : null;
  const rendered = renderTemplateText(profile, { body, thread: thread && { ...thread, claim } }, 32);
  return {
    connection,
    profile:
      rendered && !rendered.truncated && /^[A-Za-z][A-Za-z0-9-]{0,31}$/.test(rendered.text) ? rendered.text : null,
  };
}

export function inboundActionPermission(action: Action, at = "action") {
  if ("agents.revoke" in action) return null;
  if ("reply" in action) return "post";
  if ("label" in action) return "label";
  if ("react" in action) return "react";
  if ("task.block" in action || "task.unblock" in action || "task.cancel" in action || "task.expire" in action)
    return "manage";
  throw new BoardError("invalid_rule", `${at}.${Object.keys(action)[0]}: unsupported inbound action`);
}

export function validateInboundActions(plan: Plan): void {
  for (const [ruleIndex, rule] of plan.entries()) {
    for (const [index, action] of rule.do.entries())
      inboundActionPermission(action, `rules[${ruleIndex}].do[${index}]`);
  }
}

export function renderInboundAction(action: Action, body: unknown, thread: Message) {
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

  function taskReason(parts: Template): string {
    const reason = render(parts, "task reason", 2000);
    if ([...reason].length > 1000) throw new BoardError("invalid_request", "inbound task reason is too large");
    return reason;
  }

  const id = thread.id;
  if ("task.block" in action) {
    const { kind, reason } = action["task.block"];
    return { permission: "manage", action: "task.block", input: { id, kind, reason: taskReason(reason) } } as const;
  }
  if ("task.unblock" in action) {
    return { permission: "manage", action: "task.unblock", input: { id } } as const;
  }
  if ("task.expire" in action) {
    return { permission: "manage", action: "task.expire", input: { id } } as const;
  }
  if ("task.cancel" in action) {
    const { reason } = action["task.cancel"];
    return {
      permission: "manage",
      action: "task.cancel",
      input: { id, reason: reason ? taskReason(reason) : "Canceled by inbound rule" },
    } as const;
  }

  if (!("label" in action)) throw new BoardError("invalid_rule", "unsupported inbound action");
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
