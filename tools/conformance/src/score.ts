import type { CheckResult } from "@vercel/board/conformance";

export type Score = {
  local: readonly string[];
  hosted: readonly string[];
};

function passedNames(checks: readonly CheckResult[]): Set<string> {
  return new Set(checks.filter((check) => check.status === "passed").map((check) => `${check.group}/${check.name}`));
}

export function lostChecks(recorded: readonly string[], checks: readonly CheckResult[]): string[] {
  const passed = passedNames(checks);
  return recorded.filter((name) => !passed.has(name));
}

/** Checks that passed in this run but are not recorded yet, in the kit's order, each once. */
export function newChecks(recorded: readonly string[], checks: readonly CheckResult[]): string[] {
  const known = new Set(recorded);
  return [...passedNames(checks)].filter((name) => !known.has(name));
}

/**
 * Adds checks to one mode's list, sorted so the file reads the same whoever records. Never removes an entry: that is
 * the owner's call (AGENTS.md, non-negotiable 4).
 */
export function recordChecks(score: Score, mode: keyof Score, added: readonly string[]): Score {
  const names = [...new Set([...score[mode], ...added])].sort();
  return { ...score, [mode]: names };
}
