// Same names, different bindings: parameters, locals, instance fields and plain-object methods.
import { codes } from "./constants.ts";

const cache = new Map<string, number>();
const math = { add: (a: number, b: number) => a + b };

export class Store {
  static readonly items = new Set<string>();
  static readonly #a = new Set<string>();
  static readonly #b = new Set<string>();

  static known(name: string): boolean {
    return Store.#a.has(name) || Store.#b.has(name);
  }

  readonly name = "store";
}

export class Session {
  readonly items = new Set<string>();

  static has(name: string): boolean {
    return Store.items.has(name);
  }

  open(name: string): void {
    this.items.add(name);
  }
}

export function fill(cache: Map<string, number>, codes: Map<string, number>): number {
  cache.set("a", 1);
  codes.set("b", 2);
  return math.add(cache.size, codes.size);
}

export function local(): number {
  const cache = new Map<string, number>();
  cache.set("a", 1);
  for (const codes of [new Map<string, number>()]) codes.clear();
  return cache.size;
}

export function read(): number {
  return cache.get("a") ?? codes.get("a") ?? 0;
}
