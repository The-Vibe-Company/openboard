const counters = { hits: 0 };
const flags: Record<string, boolean> = {};
const merged = {};
const nested = { list: [] as string[] };

export class Pool {
  static readonly #open = new Set<string>();

  static {
    // biome-ignore lint/complexity/noThisInStatic: the fixture checks `this` inside a static block
    this.#open.clear();
  }

  // Only `#open` is reported: a private name is not confused with another.
  static readonly #closed = new Set<string>();

  static closed(name: string): boolean {
    // biome-ignore lint/complexity/noThisInStatic: the fixture checks `this` inside a static method
    return this.#closed.has(name);
  }

  readonly name = "pool";
}

export function touch(name: string): void {
  counters.hits++;
  delete flags[name];
  Object.assign(merged, { name });
  nested.list.push(name);
}
