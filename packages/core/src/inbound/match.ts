import { parseId } from "../ids.ts";
import { renderTemplateText, resolvePath } from "../webhooks/template.ts";
import { PATTERN_LIMIT } from "./pattern.ts";
import { matchInboundPattern } from "./pattern-match.ts";
import type { parseInboundRules, parseInboundThread } from "./rules.ts";

export function matchingInboundRules(
  rules: ReturnType<typeof parseInboundRules>,
  payload: { body: unknown; headers: Record<string, string> },
) {
  return rules.flatMap((rule, index) =>
    rule.when.every(({ path, values }) => {
      const [namespace, name, ...rest] = path;
      const actual = resolvePath(
        payload,
        namespace === "headers" && name !== undefined ? [namespace, name.toLowerCase(), ...rest] : path,
      );
      return values.some((value) => value === actual);
    })
      ? [{ index, actions: rule.do }]
      : [],
  );
}

export function inboundThreadPosition(thread: ReturnType<typeof parseInboundThread>, body: unknown) {
  const reference = renderTemplateText(thread.from, { body }, PATTERN_LIMIT);
  if (!reference?.text) return { kind: "empty" as const };
  const capture = matchInboundPattern(thread.pattern, reference.text)?.captures[1];
  if (capture === undefined) return { kind: "pattern" as const };
  const position = parseId(capture);
  return position === null ? { kind: "root" as const } : { kind: "position" as const, position };
}
