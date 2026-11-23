// Frozen data, readonly static values, and state created per call are allowed.
const codes = new Map([["a", 1]]);
const names = ["a", "b"] as const;
const limits = { max: 10 };

export class Settings {
  static readonly defaults = { max: 10 };
  readonly seen = new Set<string>();

  remember(name: string): void {
    this.seen.add(name);
  }
}

export function create(): Map<string, number> {
  const local = new Map<string, number>();
  let total = 0;
  for (const name of names) {
    local.set(name, codes.get(name) ?? limits.max);
    total += 1;
  }
  local.set("total", total);
  return local;
}
