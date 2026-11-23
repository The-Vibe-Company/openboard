import type { Rule } from "./types.ts";

/** The allow-list of a rule, as a sentence fragment for a violation message. */
export function describeAllowed(rule: Rule): string {
  const parts = [
    rule.may.length > 0 ? `workspaces ${rule.may.join(", ")}` : "no workspace",
    ...(rule.types && rule.types.length > 0 ? [`types from ${rule.types.join(", ")}`] : []),
    rule.external.length > 0 ? `external ${rule.external.join(", ")}` : "no external module",
  ];
  return parts.join("; ");
}
