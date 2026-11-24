import { BoardError, type Inbound, type InboundRules, isInboundRules } from "@openboard/contract";
import { compileInboundPattern } from "./pattern.ts";

type Template = (string | { path: string[] })[];
type Parsed<T> = T extends string ? Template : T extends object ? { [K in keyof T]: Parsed<T[K]> } : T;

function invalidRule(field: string, reason: string): never {
  throw new BoardError("invalid_rule", `${field}: ${reason}`);
}

function template(text: string, field: string, namespace: "body" | "body|thread"): Template {
  const parts: Template = [];
  let cursor = 0;
  for (let open = text.indexOf("{{"); open !== -1; open = text.indexOf("{{", cursor)) {
    const end = text.indexOf("}}", open + 2);
    if (end === -1) invalidRule(field, "unclosed template");
    const path = text.slice(open + 2, end);
    const keys = path.split(".");
    if (
      !namespace.split("|").includes(keys[0] ?? "") ||
      keys.length < 2 ||
      !keys.every((key) => /^[\w-]+$/.test(key))
    ) {
      invalidRule(field, "unsupported template path");
    }
    if (open > cursor) parts.push(text.slice(cursor, open));
    parts.push({ path: keys });
    cursor = end + 2;
  }
  if (cursor < text.length || parts.length === 0) parts.push(text.slice(cursor));
  return parts;
}

function actionTemplates(value: unknown, field: string): unknown {
  if (typeof value === "string") return template(value, field, "body|thread");
  if (Array.isArray(value)) return value.map((item, index) => actionTemplates(item, `${field}[${index}]`));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, actionTemplates(item, `${field}.${key}`)]),
  );
}

type Action = InboundRules[number]["do"][number];
type ActionPlan =
  | Parsed<Exclude<Action, { "task.block": unknown } | { "agents.revoke": unknown }>>
  | { "agents.revoke": { connection: string; profile: Template } }
  | {
      "task.block": { kind: "agent" | "human"; reason: Template };
    };

export function parseInboundRules(input: unknown) {
  if (!isInboundRules(input)) invalidRule("rules", "expected path conditions and supported inbound actions");
  if (input.length > 32) invalidRule("rules", "maximum is 32 rules");
  return input.map((rule, index) => {
    const field = `rules[${index}]`;
    if (rule.do.length > 8) invalidRule(`${field}.do`, "maximum is 8 actions");
    return {
      when: Object.entries(rule.when).map(([path, value]) => {
        const keys = path.split(".");
        if (!keys.slice(1).every((key) => /^[\w-]+$/.test(key)))
          invalidRule(`${field}.when.${path}`, "invalid condition path");
        return { path: keys, values: Array.isArray(value) ? value : [value] };
      }),
      do: rule.do.map((action, index) => {
        const at = `${field}.do[${index}]`;
        if ("agents.revoke" in action) {
          const { connection, profile } = action["agents.revoke"];
          const field = `${at}.agents.revoke`;
          if (!/^cn_[a-z2-7]{16}$/.test(connection))
            invalidRule(`${field}.connection`, "expected a literal connection ID");
          return { "agents.revoke": { connection, profile: template(profile, `${field}.profile`, "body|thread") } };
        }
        if ("task.block" in action) {
          const { kind, reason } = action["task.block"];
          return { "task.block": { kind, reason: template(reason, `${at}.task.block.reason`, "body|thread") } };
        }
        return actionTemplates(action, at) as ActionPlan;
      }),
    };
  });
}

export function parseInboundThread(thread: Inbound["thread"]) {
  return {
    from: template(thread.from, "thread.from", "body"),
    pattern: compileInboundPattern(thread.pattern, thread.flags),
  };
}
