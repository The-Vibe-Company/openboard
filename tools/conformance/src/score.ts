import type { CheckResult } from "@vercel/board/conformance";

export type Score = {
  local: readonly string[];
  hosted: readonly string[];
};

export function lostChecks(recorded: readonly string[], checks: readonly CheckResult[]): string[] {
  const passed = new Set(
    checks.filter((check) => check.status === "passed").map((check) => `${check.group}/${check.name}`),
  );
  return recorded.filter((name) => !passed.has(name));
}
